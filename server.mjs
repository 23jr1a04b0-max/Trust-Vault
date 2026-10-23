import http from 'node:http';
import { createReadStream, createWriteStream, mkdirSync, existsSync, unlinkSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, extname, basename, join } from 'node:path';
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { scanWithClamAV } from './clamav.mjs';

const scrypt = promisify(scryptCb);
const ROOT = process.cwd();
const PUBLIC = resolve(ROOT, 'public');
const DATA = resolve(ROOT, 'data');
const PRIVATE = resolve(ROOT, 'private-files');
for (const p of [DATA, PRIVATE]) mkdirSync(p, { recursive: true, mode: 0o700 });
const DB = new DatabaseSync(join(DATA, 'trustvault.sqlite'));
DB.exec(readFileSync(join(ROOT, 'db', 'schema.sql'), 'utf8'));
const q = (sql, ...args) => DB.prepare(sql).get(...args);
const all = (sql, ...args) => DB.prepare(sql).all(...args);
const run = (sql, ...args) => DB.prepare(sql).run(...args);
const now = () => new Date().toISOString();
const sha = s => createHash('sha256').update(s).digest('hex');
const safeEqual = (a,b) => { const aa=Buffer.from(a), bb=Buffer.from(b); return aa.length===bb.length && timingSafeEqual(aa,bb); };
const notificationDto = n => ({id:n.id,type:n.type,title:n.title,message:n.message,createdAt:n.created_at,readAt:n.read_at});
function createNotification(userId,type,title,message) {
  run('INSERT INTO notifications(id,user_id,type,title,message,created_at) VALUES(?,?,?,?,?,?)',randomUUID(),userId,type,title.slice(0,160),message.slice(0,1000),now());
  // Bound persistent notification growth from repeated account or access events.
  run('DELETE FROM notifications WHERE user_id=? AND id NOT IN (SELECT id FROM notifications WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 500)',userId,userId);
}
function notifyAdministrators(type,title,message) {
  for(const admin of all("SELECT id FROM users WHERE role='Administrator' AND disabled=0")) createNotification(admin.id,type,title,message);
}

if (!DB.prepare('PRAGMA table_info(users)').all().some(c => c.name === 'approval_status')) DB.exec("ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'Approved' CHECK (approval_status IN ('Pending','Approved','Rejected'))");
if (!DB.prepare('PRAGMA table_info(audit)').all().some(c => c.name === 'hash_version')) DB.exec('ALTER TABLE audit ADD COLUMN hash_version INTEGER NOT NULL DEFAULT 1');
if (!DB.prepare('PRAGMA table_info(documents)').all().some(c => c.name === 'visibility')) DB.exec("ALTER TABLE documents ADD COLUMN visibility TEXT NOT NULL DEFAULT 'Private' CHECK (visibility IN ('Private','Public'))");
if (!DB.prepare('PRAGMA table_info(grants)').all().some(c => c.name === 'expires_at')) DB.exec('ALTER TABLE grants ADD COLUMN expires_at TEXT');
DB.exec(`CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  permission TEXT NOT NULL CHECK(permission IN ('Read','Download')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES users(id),
  expires_at TEXT
)`);
DB.exec('CREATE INDEX IF NOT EXISTS idx_access_requests_owner_status ON access_requests(document_id,status,created_at)');
DB.exec(`CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,type TEXT NOT NULL,title TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL,read_at TEXT)`);
DB.exec('CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id,read_at,created_at)');
const accessRequestSql=q("SELECT sql FROM sqlite_master WHERE type='table' AND name='access_requests'")?.sql||'';
if(/UNIQUE\s*\(\s*document_id\s*,\s*requester_id\s*,\s*permission\s*,\s*status\s*\)/i.test(accessRequestSql)) {
  DB.exec(`BEGIN;
    CREATE TABLE access_requests_migration (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      requester_id TEXT NOT NULL REFERENCES users(id),
      permission TEXT NOT NULL CHECK(permission IN ('Read','Download')),
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled')),
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT REFERENCES users(id),
      expires_at TEXT
    );
    INSERT INTO access_requests_migration SELECT id,document_id,requester_id,permission,status,created_at,decided_at,decided_by,expires_at FROM access_requests;
    DROP TABLE access_requests;
    ALTER TABLE access_requests_migration RENAME TO access_requests;
    CREATE INDEX idx_access_requests_owner_status ON access_requests(document_id,status,created_at);
    COMMIT;`);
}
let auditKey;
if (process.env.NODE_ENV === 'production') {
  if (!process.env.AUDIT_HMAC_KEY || Buffer.byteLength(process.env.AUDIT_HMAC_KEY) < 32) throw new Error('Production requires AUDIT_HMAC_KEY with at least 32 bytes.');
  auditKey = Buffer.from(process.env.AUDIT_HMAC_KEY);
} else {
  const keyPath = join(DATA, 'audit-hmac.key');
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  auditKey = readFileSync(keyPath);
  if (auditKey.length < 32) throw new Error('Local audit HMAC key is invalid.');
}
const auditMac = value => createHmac('sha256', auditKey).update(value).digest('hex');
const AUDIT_CHECKPOINT = join(DATA, 'audit-checkpoint.json');
const AUDIT_CHECKPOINT_MARKER = join(DATA, 'audit-checkpoint.initialized');
function persistAuditCheckpoint() {
  const checkpointExists=existsSync(AUDIT_CHECKPOINT);
  const markerExists=existsSync(AUDIT_CHECKPOINT_MARKER);
  const latest=q('SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1');
  const existing=readAuditCheckpoint();
  // Once initialized, a missing/corrupt checkpoint must remain a verification failure.
  // Never silently re-anchor it to the current database tail after a restart.
  if(markerExists && (!checkpointExists || !existing)) return;
  if(checkpointExists && !existing) return;
  if(existing) {
    const anchored=existing.seq===0 ? existing.hash==='GENESIS' : q('SELECT hash FROM audit WHERE seq=?',existing.seq)?.hash===existing.hash;
    if(!anchored || existing.seq>(latest?.seq||0)) return;
  }
  const checkpoint={version:1,seq:latest?.seq||0,hash:latest?.hash||'GENESIS',updatedAt:now()};
  const temporary=AUDIT_CHECKPOINT+'.tmp';
  writeFileSync(temporary,JSON.stringify(checkpoint)+'\n',{mode:0o600});
  renameSync(temporary,AUDIT_CHECKPOINT);
  if(!markerExists) {
    try { writeFileSync(AUDIT_CHECKPOINT_MARKER,'initialized\n',{mode:0o600,flag:'wx'}); } catch(error) {
      if(error.code!=='EEXIST') throw error;
    }
  }
}
function readAuditCheckpoint() {
  try {
    const value=JSON.parse(readFileSync(AUDIT_CHECKPOINT,'utf8'));
    if(value?.version!==1 || !Number.isSafeInteger(value.seq) || value.seq<0 || typeof value.hash!=='string') return null;
    return value;
  } catch { return null; }
}
// Legacy databases without a marker are initialized once. After the marker exists,
// deleting the checkpoint cannot cause the next process to silently trust the database tail.
if(!existsSync(AUDIT_CHECKPOINT_MARKER) && !existsSync(AUDIT_CHECKPOINT)) persistAuditCheckpoint();
else if(existsSync(AUDIT_CHECKPOINT) && !existsSync(AUDIT_CHECKPOINT_MARKER)) persistAuditCheckpoint();
// Migrate existing local MVP databases without requiring users to delete demo data.
if (!DB.prepare('PRAGMA table_info(sessions)').all().some(c => c.name === 'last_seen_at')) {
  DB.exec('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0');
  DB.exec('UPDATE sessions SET last_seen_at=expires_at-28800000 WHERE last_seen_at=0');
}
// In-process defense-in-depth only. Public/multi-instance deployments need a shared limiter at the edge.
const loginAttempts = new Map();
const signupAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const IDLE_SESSION_MS = 30 * 60 * 1000;
const ABSOLUTE_SESSION_MS = 8 * 60 * 60 * 1000;
let requestCounter = 0;
const MAX_UPLOAD = Number(process.env.MAX_UPLOAD_BYTES || 10*1024*1024);
if (!Number.isSafeInteger(MAX_UPLOAD) || MAX_UPLOAD < 1 || MAX_UPLOAD > 100*1024*1024) {
  throw new Error('MAX_UPLOAD_BYTES must be an integer between 1 byte and 100 MiB.');
}
const allowed = new Map([['.pdf','application/pdf'],['.txt','text/plain'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg']]);

async function hashPassword(password, salt=randomBytes(16).toString('hex')) { return { salt, hash:(await scrypt(password,salt,64)).toString('hex') }; }
async function verifyPassword(password,user) { const derived=(await scrypt(password,user.salt,64)).toString('hex'); return safeEqual(derived,user.password_hash); }
const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
const dummyPasswordRecord = { salt: dummyHash.salt, password_hash: dummyHash.hash };
function loginRateLimit(req, email='') {
  const ip=req.socket.remoteAddress || 'unknown'; const current=Date.now();
  const keys=[`ip:${ip}`,`account-ip:${ip}:${sha(email).slice(0,24)}`];
  let retry=0;
  for(const key of keys){
    let entry=loginAttempts.get(key);
    if(!entry || current-entry.startedAt>=LOGIN_WINDOW_MS) entry={startedAt:current,count:0};
    if(entry.count>=LOGIN_MAX_ATTEMPTS) retry=Math.max(retry,Math.ceil((entry.startedAt+LOGIN_WINDOW_MS-current)/1000));
    else {entry.count++;loginAttempts.set(key,entry);}
  }
  // Bound memory if many distinct clients/accounts contact this process.
  if(loginAttempts.size>5000) for(const [k,v] of loginAttempts) if(current-v.startedAt>=LOGIN_WINDOW_MS) loginAttempts.delete(k);
  return retry ? Math.max(1,retry) : 0;
}
function audit(actor, action, targetType, targetId, outcome, reason, requestId) {
  const prev = q('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1')?.hash || 'GENESIS';
  const event={id:randomUUID(),at:now(),actor_id:actor||null,action,target_type:targetType||null,target_id:targetId||null,outcome,reason,request_id:requestId,prev_hash:prev};
  const hashVersion=2;
  const hash=auditMac(JSON.stringify({...event,hash_version:hashVersion}));
  run('INSERT INTO audit(id,at,actor_id,action,target_type,target_id,outcome,reason,request_id,prev_hash,hash,hash_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',event.id,event.at,event.actor_id,event.action,event.target_type,event.target_id,event.outcome,event.reason,event.request_id,event.prev_hash,hash,hashVersion);
  persistAuditCheckpoint();
}
function verifyAudit() {
  const checkpoint=readAuditCheckpoint();
  const latest=q('SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1');
  if(!checkpoint || checkpoint.seq!==(latest?.seq||0) || checkpoint.hash!==(latest?.hash||'GENESIS')) return {valid:false,checked:all('SELECT seq FROM audit').length,failedEvent:null,reason:'audit_checkpoint_mismatch'};
  const events=all('SELECT * FROM audit ORDER BY seq'); let prev='GENESIS';
  for(const e of events){
    const canonical={id:e.id,at:e.at,actor_id:e.actor_id,action:e.action,target_type:e.target_type,target_id:e.target_id,outcome:e.outcome,reason:e.reason,request_id:e.request_id,prev_hash:e.prev_hash};
    const expected=e.hash_version>=2 ? auditMac(JSON.stringify({...canonical,hash_version:e.hash_version})) : sha(JSON.stringify(canonical));
    if(e.prev_hash!==prev || expected!==e.hash) return {valid:false,checked:events.length,failedEvent:e.id};
    prev=e.hash;
  }
  return {valid:true,checked:events.length};
}
function json(res,status,obj,headers={}) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}); if(status===204) return res.end(); res.end(JSON.stringify(obj)); }
function cookies(req) {
  const out={}; for(const part of (req.headers.cookie||'').split(';')){const x=part.trim(),i=x.indexOf('=');if(i<1)continue;try{out[x.slice(0,i)]=decodeURIComponent(x.slice(i+1));}catch{ /* Ignore malformed cookie values. */ }} return out;
}
function currentUser(req) {
  const token=cookies(req).tv_session; if(!token || token.length>256) return null;
  const tokenHash=sha(token), current=Date.now();
  const s=q('SELECT * FROM sessions WHERE id_hash=? AND expires_at>? AND last_seen_at>?',tokenHash,current,current-IDLE_SESSION_MS);
  if(!s) { if(token) run('DELETE FROM sessions WHERE id_hash=? AND (expires_at<=? OR last_seen_at<=?)',tokenHash,current,current-IDLE_SESSION_MS); return null; }
  const u=q('SELECT id,email,display_name,role,disabled,approval_status FROM users WHERE id=?',s.user_id);
  if(!u || u.disabled || (u.role==='DocumentOwner' && u.approval_status!=='Approved')) {run('DELETE FROM sessions WHERE id_hash=?',tokenHash);return null;}
  run('UPDATE sessions SET last_seen_at=? WHERE id_hash=?',current,tokenHash);
  return {...u,csrf:s.csrf,sessionHash:tokenHash};
}
function configuredProductionOrigins() {
  if(process.env.NODE_ENV!=='production') return [];
  const values=(process.env.TRUSTED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
  if(!values.length) throw new Error('Production requires TRUSTED_ORIGINS containing one or more exact HTTPS origins.');
  for(const value of values) {
    let parsed;
    try { parsed=new URL(value); } catch { throw new Error('Each TRUSTED_ORIGINS entry must be a valid HTTPS origin without a path.'); }
    if(parsed.protocol!=='https:' || parsed.origin!==value || parsed.username || parsed.password || parsed.pathname!=='/' || parsed.search || parsed.hash) {
      throw new Error('Each TRUSTED_ORIGINS entry must be an exact HTTPS origin such as https://vault.example.com, without a path, query, or trailing slash.');
    }
  }
  return new Set(values);
}
const TRUSTED_ORIGINS=configuredProductionOrigins();
function productionOriginAllowed(req) {
  if(process.env.NODE_ENV!=='production') return true;
  const origin=req.headers.origin;
  return typeof origin==='string' && TRUSTED_ORIGINS.has(origin);
}
async function body(req, limit=1024*1024) {
  const chunks=[]; let size=0;
  for await(const chunk of req){ size+=chunk.length; if(size>limit) throw Object.assign(new Error('Request too large'),{status:413}); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
async function readJson(req) { const b=await body(req); try{return JSON.parse(b.toString('utf8'));}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});} }
function hasDocAccess(user, doc, capability='Read') {
  if(!user||!doc||doc.deleted_at) return false;
  if(doc.owner_id===user.id) return true;
  const g=q('SELECT permission,expires_at FROM grants WHERE document_id=? AND user_id=? AND revoked_at IS NULL',doc.id,user.id);
  if(!g || (g.expires_at && (!Number.isFinite(Date.parse(g.expires_at)) || Date.parse(g.expires_at)<=Date.now()))) return false;
  if(capability==='Download') return g.permission==='Download' || g.permission==='Edit';
  if(capability==='Edit') return g.permission==='Edit';
  return g.permission==='Read' || g.permission==='Download' || g.permission==='Edit';
}
function requireCsrf(req,user) { if(!user || !req.headers['x-csrf-token'] || !safeEqual(String(req.headers['x-csrf-token']),user.csrf)) throw Object.assign(new Error('CSRF validation failed'),{status:403}); }
function docDto(d) { const owner=q('SELECT display_name FROM users WHERE id=?',d.owner_id); return {id:d.id,name:d.name,category:d.category,visibility:d.visibility||'Private',size:d.size,mime:d.mime,createdAt:d.created_at,ownerId:d.owner_id,ownerName:owner?.display_name||'Unknown owner'}; }
function activeGrant(userId,documentId) {
  const grant=q('SELECT permission,expires_at FROM grants WHERE document_id=? AND user_id=? AND revoked_at IS NULL',documentId,userId);
  if(!grant || (grant.expires_at && (!Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at)<=Date.now()))) return null;
  return grant;
}
async function route(req,res) {
  let auditActor=null;
  const requestId=randomUUID(); const url=new URL(req.url,'http://localhost'); const path=url.pathname; const method=req.method||'GET';
  requestCounter++; if(requestCounter%100===0) { const t=Date.now(); run('DELETE FROM sessions WHERE expires_at<=? OR last_seen_at<=?',t,t-IDLE_SESSION_MS); }
  res.setHeader('x-request-id',requestId); res.setHeader('x-content-type-options','nosniff'); res.setHeader('referrer-policy','no-referrer'); res.setHeader('x-frame-options','DENY'); res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  try {
    if(path.startsWith('/api/')) {
      if(method!=='GET' && method!=='HEAD' && !productionOriginAllowed(req)) { audit(null,'request.origin_denied','route',path,'denied','origin_not_allowed',requestId); return json(res,403,{error:'Request origin is not allowed.'}); }
      const user=currentUser(req); auditActor=user?.id||null;
      if(path==='/api/health' && method==='GET') return json(res,200,{ok:true});
      if(path==='/api/auth/signup' && method==='POST') {
        const d=await readJson(req);
        const email=String(d.email||'').trim().toLowerCase();
        const name=String(d.name||'').trim();
        const password=String(d.password||'');
        const role=String(d.role||'');
        const ip=req.socket.remoteAddress||'unknown';
        const key='signup:'+ip;
        const current=Date.now();
        let attempts=signupAttempts.get(key);
        if(!attempts||current-attempts.startedAt>=LOGIN_WINDOW_MS) attempts={startedAt:current,count:0};
        if(attempts.count>=5) { signupAttempts.set(key,attempts); audit(null,'auth.signup.rate_limited','client',null,'denied','signup_rate_limit',requestId); return json(res,429,{error:'Too many sign-up attempts. Try again later.'},{'retry-after':String(Math.max(1,Math.ceil((attempts.startedAt+LOGIN_WINDOW_MS-current)/1000)))}); }
        attempts.count++; signupAttempts.set(key,attempts);
        if(signupAttempts.size>5000) for(const [attemptKey,value] of signupAttempts) if(current-value.startedAt>=LOGIN_WINDOW_MS) signupAttempts.delete(attemptKey);
        if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name||name.length>80||password.length<12||password.length>1024) { audit(null,'auth.signup','user',null,'denied','invalid_signup_input',requestId); return json(res,400,{error:'Enter a valid name and email, and a password between 12 and 1024 characters.'}); }
        if(!['DocumentOwner','Viewer'].includes(role)) { audit(null,'auth.signup','user',null,'denied','invalid_or_privileged_signup_role',requestId); return json(res,400,{error:'Choose Document Owner or Viewer. Administrator accounts are created by an existing trusted administrator.'}); }
        if(q('SELECT id FROM users WHERE email=?',email)) { audit(null,'auth.signup','user',null,'denied','email_already_registered',requestId); return json(res,409,{error:'An account with this email already exists. Sign in instead.'}); }
        const p=await hashPassword(password);
        const id=randomUUID();
        const approvalStatus=role==='DocumentOwner'?'Pending':'Approved';
        try { run('INSERT INTO users(id,email,display_name,role,password_hash,salt,created_at,approval_status) VALUES(?,?,?,?,?,?,?,?)',id,email,name,role,p.hash,p.salt,now(),approvalStatus); }
        catch(err) { if(String(err.message).includes('UNIQUE')) return json(res,409,{error:'An account with this email already exists. Sign in instead.'}); throw err; }
        audit(id,'auth.signup','user',id,'success','self_service_account_created:'+role+':'+approvalStatus,requestId);
        if(role==='DocumentOwner') notifyAdministrators('owner-registration','New owner registration request',name+' ('+email+') requested a Document Owner account.');
        return json(res,201,{ok:true,userId:id,approvalStatus,message:role==='DocumentOwner'?'Owner request submitted. An administrator must approve your account before you can sign in.':'Account created. You can now sign in.'});
      }
      if(path==='/api/auth/login' && method==='POST') {
        const d=await readJson(req); const email=String(d.email||'').trim().toLowerCase(); const password=String(d.password||''); const requestedRole=String(d.role||'');
        const retryAfter=loginRateLimit(req,email);
        if(retryAfter) { audit(null,'auth.login.rate_limited','client',null,'denied','login_rate_limit',requestId); return json(res,429,{error:'Too many login attempts. Try again later.'},{'retry-after':String(retryAfter)}); }
        if(email.length>254||password.length>1024) { audit(null,'auth.login','user',null,'denied','invalid_login_input',requestId); return json(res,400,{error:'Invalid login request'}); }
        const u=q('SELECT * FROM users WHERE email=?',email);
        // Perform a password-hash operation even when the account does not exist to reduce timing-based enumeration.
        const passwordMatches=u ? await verifyPassword(password,u) : await verifyPassword(password,dummyPasswordRecord);
        const ok=!!u && !u.disabled && passwordMatches;
        if(!ok) { audit(null,'auth.login','user',null,'denied','invalid_credentials_or_account_unavailable',requestId); return json(res,401,{error:'Email or password is incorrect.'}); }
        if(u.role==='DocumentOwner' && u.approval_status!=='Approved') { audit(u.id,'auth.login','user',u.id,'denied','owner_account_'+String(u.approval_status||'Pending').toLowerCase(),requestId); return json(res,403,{error:u.approval_status==='Rejected'?'Your owner account request was rejected. Contact the administrator.':'Your owner account is awaiting administrator approval.'}); }
        if(!['Administrator','DocumentOwner','Viewer'].includes(requestedRole) || requestedRole!==u.role) { audit(u.id,'auth.login','user',u.id,'denied','selected_role_mismatch',requestId); return json(res,403,{error:'This account does not match the selected role. Choose the role assigned to your account.'}); }
        audit(u.id,'auth.login','user',u.id,'success','credentials_and_role_valid',requestId);
        // Rotate the browser session at login and invalidate any prior session cookie.
        const priorToken=cookies(req).tv_session; if(priorToken) run('DELETE FROM sessions WHERE id_hash=?',sha(priorToken));
        const token=randomBytes(32).toString('base64url'), csrf=randomBytes(24).toString('base64url'), created=Date.now(), expires=created+ABSOLUTE_SESSION_MS;
        run('INSERT INTO sessions(id_hash,user_id,csrf,expires_at,last_seen_at) VALUES(?,?,?,?,?)',sha(token),u.id,csrf,expires,created);
        const secure=process.env.NODE_ENV==='production'?'; Secure':'';
        return json(res,200,{user:{id:u.id,email:u.email,name:u.display_name,role:u.role},csrfToken:csrf},{'set-cookie':`tv_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ABSOLUTE_SESSION_MS/1000)}${secure}`});
      }
      if(path==='/api/auth/me' && method==='GET') return user?json(res,200,{user:{id:user.id,email:user.email,name:user.display_name,role:user.role},csrfToken:user.csrf}):json(res,401,{error:'Authentication required'});
      if(path==='/api/auth/logout' && method==='POST') { if(!user) return json(res,204,{}); requireCsrf(req,user); run('DELETE FROM sessions WHERE id_hash=?',user.sessionHash); audit(user.id,'auth.logout','user',user.id,'success','session_ended',requestId); return json(res,204,{}, {'set-cookie':`tv_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`}); }
      if(!user) { audit(null,'auth.required', 'route', path,'denied','unauthenticated',requestId); return json(res,401,{error:'Authentication required'}); }
      if(method!=='GET') requireCsrf(req,user);
      if(path==='/api/notifications' && method==='GET') {
        const rows=all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100',user.id);
        const unreadCount=q('SELECT COUNT(*) AS count FROM notifications WHERE user_id=? AND read_at IS NULL',user.id).count;
        return json(res,200,{notifications:rows.map(notificationDto),unreadCount});
      }
      if(path==='/api/notifications/read-all' && method==='POST') {
        run('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL',now(),user.id);
        return json(res,200,{ok:true});
      }
      if(path==='/api/documents' && method==='GET') {
        const docs=all(`SELECT DISTINCT d.* FROM documents d LEFT JOIN grants g ON g.document_id=d.id AND g.user_id=? AND g.revoked_at IS NULL WHERE d.deleted_at IS NULL AND (d.owner_id=? OR g.user_id=? OR d.visibility='Public') ORDER BY d.created_at DESC`,user.id,user.id,user.id).filter(d=>d.visibility==='Public'||hasDocAccess(user,d));
        audit(user.id,'document.list','collection',null,'success',`visible_count:${docs.length}`,requestId);
        return json(res,200,{documents:docs.map(d=>({...docDto(d),accessPermission:d.owner_id===user.id?'Owner':(activeGrant(user.id,d.id)?.permission||(d.visibility==='Public'?'Public listing':'None'))}))});
      }
      if(path==='/api/documents' && method==='POST') {
        if(!['DocumentOwner'].includes(user.role)) { audit(user.id,'document.upload','collection',null,'denied','role_not_allowed',requestId); return json(res,403,{error:'Only document owners can upload files'}); }
        const contentType=req.headers['content-type']||''; if(!contentType.startsWith('multipart/form-data; boundary=')) { audit(user.id,'document.upload','collection',null,'denied','unsupported_upload_content_type',requestId); return json(res,415,{error:'Expected multipart form data'}); }
        const raw=await body(req,MAX_UPLOAD+128*1024); const boundary=contentType.split('boundary=')[1]; if(!boundary||boundary.length>200) { audit(user.id,'document.upload','collection',null,'denied','invalid_upload_boundary',requestId); return json(res,400,{error:'Invalid upload boundary'}); }
        const parsed=parseMultipart(raw,boundary); const file=parsed.file; if(!file) { audit(user.id,'document.upload','collection',null,'denied','missing_upload_file',requestId); return json(res,400,{error:'Choose a file to upload'}); }
        const original=basename(file.filename.replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f]/g,'').trim(); const ext=extname(original).toLowerCase();
        if(!original||file.filename.includes('/')||file.filename.includes(String.fromCharCode(92))||original.length>180||!allowed.has(ext)||file.data.length>MAX_UPLOAD||!validSignature(ext,file.data)||!file.contentType||file.contentType.toLowerCase()!==allowed.get(ext)) { audit(user.id,'document.upload','document',null,'denied','upload_validation_failed',requestId); return json(res,400,{error:'Unsupported, malformed, or oversized file. Allowed: PDF, TXT, PNG, JPG.'}); }
        // Production uploads must pass malware scanning before entering private storage.
        // Scanner outage, timeout, protocol error, or malware finding fails closed.
        if(process.env.NODE_ENV==='production') {
          try { await scanWithClamAV(file.data); }
          catch(scanError) {
            const infected=scanError.code==='MALWARE_DETECTED';
            audit(user.id,'document.upload.scan','document',null,'denied',infected?'malware_detected':'malware_scanner_unavailable',requestId);
            return json(res,infected?400:503,{error:infected?'The uploaded file was rejected by malware scanning.':'Malware scanning is temporarily unavailable. Please try again later.'});
          }
        }
        const key=randomBytes(32).toString('hex'); const id=randomUUID(); const category=String(parsed.fields.category||'General').slice(0,80); const visibility=['Public','Private'].includes(parsed.fields.visibility)?parsed.fields.visibility:'Private';
        await new Promise((resolvePromise,reject)=>{const s=createWriteStream(join(PRIVATE,key),{flags:'wx',mode:0o600});s.on('error',reject);s.end(file.data,resolvePromise)});
        try { run('INSERT INTO documents(id,owner_id,name,category,storage_key,size,mime,created_at,visibility) VALUES(?,?,?,?,?,?,?,?,?)',id,user.id,original,category,key,file.data.length,allowed.get(ext),now(),visibility); audit(user.id,'document.upload','document',id,'success','upload_complete',requestId); }
        catch(e){ if(existsSync(join(PRIVATE,key))) unlinkSync(join(PRIVATE,key)); throw e; }
        return json(res,201,{document:docDto(q('SELECT * FROM documents WHERE id=?',id))});
      }
      const docMatch=path.match(/^\/api\/documents\/([0-9a-f-]+)(?:\/(download|content|permissions|audit))?$/i);
      if(docMatch) {
        const id=docMatch[1], action=docMatch[2]||''; const d=q('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL',id);
        if(action==='download' && method==='GET') {
          if(!hasDocAccess(user,d,'Download')) {audit(user.id,'document.download','document',null,'denied','not_authorised_or_not_found',requestId);return json(res,404,{error:'Document not found'});}
          audit(user.id,'document.download','document',id,'success','authorised_download',requestId); res.writeHead(200,{'content-type':d.mime,'content-length':d.size,'content-disposition':`attachment; filename="download${extname(d.name).replace(/[^.a-zA-Z0-9]/g,'')}"`,'cache-control':'no-store','x-content-type-options':'nosniff'}); const streamAccessGuard=new Transform({transform(chunk,encoding,callback){const current=q('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL',id);if(!hasDocAccess(user,current,'Download')){try{audit(user.id,'document.download.stream','document',id,'denied','access_revoked_during_stream',requestId);}catch{} callback(Object.assign(new Error('Document access was revoked during download'),{code:'ERR_DOCUMENT_ACCESS_REVOKED'}));return;}callback(null,chunk);}}); return pipeline(createReadStream(join(PRIVATE,d.storage_key)),streamAccessGuard,res);
        }
        if(action==='content' && method==='GET') {
          if(!hasDocAccess(user,d,'Read')) {audit(user.id,'document.content.read','document',null,'denied','not_authorised_or_not_found',requestId);return json(res,404,{error:'Document not found'});}
          audit(user.id,'document.content.read','document',id,'success','authorised_inline_view',requestId);
          res.writeHead(200,{'content-type':d.mime,'content-length':d.size,'content-disposition':`inline; filename="view${extname(d.name).replace(/[^.a-zA-Z0-9]/g,'')}"`,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"});
          const inlineAccessGuard=new Transform({transform(chunk,encoding,callback){const current=q('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL',id);if(!hasDocAccess(user,current,'Read')){try{audit(user.id,'document.content.read.stream','document',id,'denied','access_revoked_during_stream',requestId);}catch{} callback(Object.assign(new Error('Document access was revoked during inline viewing'),{code:'ERR_DOCUMENT_ACCESS_REVOKED'}));return;}callback(null,chunk);}});
          return pipeline(createReadStream(join(PRIVATE,d.storage_key)),inlineAccessGuard,res);
        }
        if(action==='permissions' && method==='GET') {
          if(!d || d.owner_id!==user.id) {audit(user.id,'permission.list','document',null,'denied','not_owner_or_not_found',requestId);return json(res,404,{error:'Document not found'});}
          return json(res,200,{permissions:all('SELECT g.user_id,u.email,u.display_name,g.permission,g.created_at,g.revoked_at,g.expires_at FROM grants g JOIN users u ON u.id=g.user_id WHERE g.document_id=?',id)});
        }
        if(action==='permissions' && method==='POST') {
          if(!d || d.owner_id!==user.id) {audit(user.id,'permission.grant','document',null,'denied','not_owner_or_not_found',requestId);return json(res,404,{error:'Document not found'});}
          const input=await readJson(req), target=q('SELECT id,role FROM users WHERE email=? AND disabled=0',String(input.email||'').trim().toLowerCase()); const permission=input.permission;
          const expiresAt=input.expiresAt ? String(input.expiresAt) : null;
          if(expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())) { audit(user.id,'permission.grant','document',id,'denied','invalid_grant_expiry',requestId); return json(res,400,{error:'Expiry must be a future date and time.'}); }
          if(!target||target.id===user.id||!['Read','Download','Edit'].includes(permission)) { audit(user.id,'permission.grant','document',id,'denied','invalid_target_or_permission',requestId); return json(res,400,{error:'Choose an existing user and Read, Download, or Edit permission.'}); }
          const prior=q('SELECT * FROM grants WHERE document_id=? AND user_id=?',id,target.id);
          if(prior) run('UPDATE grants SET permission=?,granted_by=?,created_at=?,revoked_at=NULL,expires_at=? WHERE document_id=? AND user_id=?',permission,user.id,now(),expiresAt,id,target.id);
          else run('INSERT INTO grants(document_id,user_id,permission,granted_by,created_at,expires_at) VALUES(?,?,?,?,?,?)',id,target.id,permission,user.id,now(),expiresAt);
          audit(user.id,'permission.grant','document',id,'success',permission+(expiresAt?':expires:'+expiresAt:':no_expiry'),requestId); return json(res,201,{ok:true,expiresAt});
        }
        if(action==='permissions' && method==='DELETE') {
          if(!d || d.owner_id!==user.id) {audit(user.id,'permission.revoke','document',null,'denied','not_owner_or_not_found',requestId);return json(res,404,{error:'Document not found'});}
          const targetId=url.searchParams.get('userId'); const result=run('UPDATE grants SET revoked_at=? WHERE document_id=? AND user_id=? AND revoked_at IS NULL',now(),id,targetId);
          audit(user.id,'permission.revoke','document',id,'success',result.changes?'grant_revoked':'grant_not_active',requestId); return json(res,200,{ok:true});
        }
        if(action==='audit' && method==='GET') {
          if(!d || d.owner_id!==user.id) {audit(user.id,'document.audit.read','document',null,'denied','not_owner_or_not_found',requestId);return json(res,404,{error:'Document not found'});}
          audit(user.id,'document.audit.read','document',id,'success','owner_audit_read',requestId);
          return json(res,200,{events:all('SELECT id,at,actor_id,action,outcome,reason FROM audit WHERE target_id=? ORDER BY seq DESC LIMIT 100',id)});
        }
        if(!action && method==='GET') { if(!hasDocAccess(user,d)) {audit(user.id,'document.read','document',null,'denied','not_authorised_or_not_found',requestId);return json(res,404,{error:'Document not found'});} audit(user.id,'document.read','document',id,'success','authorised_metadata_read',requestId); return json(res,200,{document:docDto(d)}); }
        if(!action && method==='PATCH') { if(!hasDocAccess(user,d,'Edit')) {audit(user.id,'document.update','document',null,'denied','not_authorised_or_not_found',requestId);return json(res,404,{error:'Document not found'});} const input=await readJson(req); const name=String(input.name||'').trim(), category=String(input.category||'').trim(); if(!name||name.length>180||/[\x00-\x1f\x7f]/.test(name)||!category||category.length>80) { audit(user.id,'document.update','document',id,'denied','invalid_metadata',requestId); return json(res,400,{error:'Provide a valid document name and category.'}); } run('UPDATE documents SET name=?,category=? WHERE id=?',name,category,id); audit(user.id,'document.update','document',id,'success','metadata_updated',requestId); return json(res,200,{document:docDto(q('SELECT * FROM documents WHERE id=?',id))}); }
        if(!action && method==='DELETE') { if(!d||d.owner_id!==user.id) {audit(user.id,'document.delete','document',null,'denied','not_owner_or_not_found',requestId);return json(res,404,{error:'Document not found'});} run('UPDATE documents SET deleted_at=? WHERE id=?',now(),id); audit(user.id,'document.delete','document',id,'success','soft_deleted',requestId); return json(res,200,{ok:true}); }
      }
      const requestMatch=path.match(/^\/api\/documents\/([0-9a-f-]+)\/requests$/i);
      if(requestMatch && method==='POST') {
        const d=q('SELECT * FROM documents WHERE id=? AND deleted_at IS NULL',requestMatch[1]);
        const input=await readJson(req), permission=input.permission;
        if(user.role!=='Viewer') { audit(user.id,'access_request.create','document',null,'denied','viewer_role_required',requestId); return json(res,403,{error:'Only Viewer accounts can request document access.'}); }
        if(!d || d.visibility!=='Public' || d.owner_id===user.id) { audit(user.id,'access_request.create','document',null,'denied','not_requestable_or_self_request',requestId); return json(res,404,{error:'Public document not found'}); }
        if(!['Read','Download'].includes(permission)) { audit(user.id,'access_request.create','document',d.id,'denied','invalid_requested_permission',requestId); return json(res,400,{error:'Permission must be Read or Download.'}); }
        const existing=q("SELECT id FROM access_requests WHERE document_id=? AND requester_id=? AND permission=? AND status='Pending'",d.id,user.id,permission);
        if(existing) { audit(user.id,'access_request.create','document',d.id,'denied','duplicate_pending_request',requestId); return json(res,409,{error:'You already have a pending request for this permission.'}); }
        const requestIdValue=randomUUID();
        run("INSERT INTO access_requests(id,document_id,requester_id,permission,status,created_at) VALUES(?,?,?,?,'Pending',?)",requestIdValue,d.id,user.id,permission,now());
        audit(user.id,'access_request.create','document',d.id,'success',permission,requestId);
        createNotification(d.owner_id,'document-access-request','New document access request',user.display_name+' requested '+permission+' access to '+d.name+'.');
        return json(res,201,{ok:true,requestId:requestIdValue});
      }
      if(path==='/api/access-requests' && method==='GET') {
        const rows=all("SELECT r.id,r.document_id,r.requester_id,r.permission,r.status,r.created_at,r.expires_at,d.name AS document_name,u.email AS requester_email,u.display_name AS requester_name FROM access_requests r JOIN documents d ON d.id=r.document_id JOIN users u ON u.id=r.requester_id WHERE d.owner_id=? AND r.status='Pending' AND d.deleted_at IS NULL ORDER BY r.created_at",user.id);
        return json(res,200,{requests:rows});
      }
      const accessRequestMatch=path.match(/^\/api\/access-requests\/([0-9a-f-]+)$/i);
      if(accessRequestMatch && method==='PATCH') {
        const input=await readJson(req), status=input.status, expiresAt=input.expiresAt ? String(input.expiresAt) : null;
        if(!['Approved','Rejected'].includes(status)) { audit(user.id,'access_request.decide','request',null,'denied','invalid_decision_status',requestId); return json(res,400,{error:'Status must be Approved or Rejected.'}); }
        if(expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt)<=Date.now())) { audit(user.id,'access_request.decide','request',accessRequestMatch[1],'denied','invalid_grant_expiry',requestId); return json(res,400,{error:'Expiry must be a future date and time.'}); }
        const request= q("SELECT r.*,d.owner_id,d.deleted_at FROM access_requests r JOIN documents d ON d.id=r.document_id WHERE r.id=?",accessRequestMatch[1]);
        if(!request || request.owner_id!==user.id || request.deleted_at || request.status!=='Pending') { audit(user.id,'access_request.decide','request',null,'denied','not_owner_or_not_pending',requestId); return json(res,404,{error:'Pending request not found'}); }
        if(status==='Approved') {
          const old=q('SELECT * FROM grants WHERE document_id=? AND user_id=?',request.document_id,request.requester_id);
          if(old) run('UPDATE grants SET permission=?,granted_by=?,created_at=?,revoked_at=NULL,expires_at=? WHERE document_id=? AND user_id=?',request.permission,user.id,now(),expiresAt,request.document_id,request.requester_id);
          else run('INSERT INTO grants(document_id,user_id,permission,granted_by,created_at,expires_at) VALUES(?,?,?,?,?,?)',request.document_id,request.requester_id,request.permission,user.id,now(),expiresAt);
        }
        run('UPDATE access_requests SET status=?,decided_at=?,decided_by=?,expires_at=? WHERE id=?',status,now(),user.id,expiresAt,request.id);
        audit(user.id,'access_request.decide','document',request.document_id,'success',status+':'+request.permission,requestId);
        const decidedDocName=q('SELECT name FROM documents WHERE id=?',request.document_id)?.name||'the document';
        createNotification(request.requester_id,'document-access-decision','Document access request '+status.toLowerCase(),'Your '+request.permission+' request for '+decidedDocName+' was '+status.toLowerCase()+'.');
        return json(res,200,{ok:true,status});
      }
      if(path==='/api/users' && method==='GET') { if(user.role!=='Administrator') { audit(user.id,'admin.users.read','collection',null,'denied','administrator_role_required',requestId); return json(res,403,{error:'Administrator role required'}); } audit(user.id,'admin.users.read','collection',null,'success','account_metadata_read',requestId); return json(res,200,{users:all("SELECT id,email,display_name,role,disabled,approval_status,created_at FROM users ORDER BY CASE WHEN role='DocumentOwner' AND approval_status='Pending' THEN 0 ELSE 1 END,created_at DESC")}); }
      const userMatch=path.match(/^\/api\/users\/([0-9a-f-]+)$/i);
      if(userMatch && method==='PATCH') {
        if(user.role!=='Administrator') { audit(user.id,'user.account.update','user',userMatch[1],'denied','administrator_role_required',requestId); return json(res,403,{error:'Administrator role required'}); }
        const targetId=userMatch[1], input=await readJson(req);
        const target=q('SELECT id,email,role,disabled,approval_status FROM users WHERE id=?',targetId);
        if(!target) { audit(user.id,'user.account.update','user',targetId,'denied','target_user_not_found',requestId); return json(res,404,{error:'User not found'}); }
        if(input.approvalStatus!==undefined) {
          if(target.role!=='DocumentOwner') { audit(user.id,'owner.account.review','user',targetId,'denied','target_is_not_document_owner',requestId); return json(res,400,{error:'Only Document Owner accounts require approval.'}); }
          if(!['Approved','Rejected'].includes(input.approvalStatus)) { audit(user.id,'owner.account.review','user',targetId,'denied','invalid_approval_status',requestId); return json(res,400,{error:'Approval status must be Approved or Rejected.'}); }
          run('UPDATE users SET approval_status=? WHERE id=?',input.approvalStatus,targetId);
          if(input.approvalStatus!=='Approved') run('DELETE FROM sessions WHERE user_id=?',targetId);
          audit(user.id,'owner.account.review','user',targetId,'success',input.approvalStatus.toLowerCase(),requestId);
          if(target.approval_status!==input.approvalStatus) createNotification(targetId,'owner-account-status','Document Owner account '+input.approvalStatus.toLowerCase(),input.approvalStatus==='Approved'?'Your Document Owner account has been approved. You can now sign in.':'Your Document Owner account request was rejected.');
          return json(res,200,{ok:true,approvalStatus:input.approvalStatus});
        }
        if(typeof input.disabled!=='boolean') { audit(user.id,'user.account.update','user',targetId,'denied','invalid_account_update',requestId); return json(res,400,{error:'Provide a disabled boolean or an owner approvalStatus.'}); }
        if(targetId===user.id && input.disabled) { audit(user.id,'user.disable','user',targetId,'denied','self_disable_rejected',requestId); return json(res,400,{error:'You cannot disable your own account.'}); }
        run('UPDATE users SET disabled=? WHERE id=?',input.disabled?1:0,targetId);
        if(input.disabled) run('DELETE FROM sessions WHERE user_id=?',targetId);
        audit(user.id,input.disabled?'user.disable':'user.enable','user',targetId,'success',input.disabled?'account_disabled_and_sessions_revoked':'account_enabled',requestId);
        return json(res,200,{ok:true,disabled:input.disabled});
      }
      if(path==='/api/audit/verify' && method==='POST') { if(user.role!=='Administrator') { audit(user.id,'audit.verify','audit',null,'denied','administrator_role_required',requestId); return json(res,403,{error:'Administrator role required'}); } const result=verifyAudit(); audit(user.id,'audit.verify','audit',null,result.valid?'success':'failure',`checked:${result.checked}`,requestId); return json(res,result.valid?200:500,result); }
      if(path==='/api/audit' && method==='GET') { if(user.role!=='Administrator') { audit(user.id,'audit.read','audit',null,'denied','administrator_role_required',requestId); return json(res,403,{error:'Administrator role required'}); } audit(user.id,'audit.read','audit',null,'success','recent_audit_read',requestId); return json(res,200,{events:all('SELECT id,at,actor_id,action,target_type,target_id,outcome,reason,request_id FROM audit ORDER BY seq DESC LIMIT 200')}); }
      audit(user.id,'api.route.denied','route',path,'denied','unknown_endpoint_or_method',requestId); return json(res,404,{error:'API endpoint not found'});
    }
    if(method!=='GET' && method!=='HEAD') return json(res,405,{error:'Method not allowed'});
    let file=path==='/'?'index.html':decodeURIComponent(path.slice(1)); if(file.includes('..')||file.includes('\\')) return json(res,400,{error:'Invalid path'});
    let full=resolve(PUBLIC,file); if(!full.startsWith(PUBLIC+pathSep())) return json(res,400,{error:'Invalid path'});
    if(!existsSync(full)) full=resolve(PUBLIC,'404.html');
    const ext=extname(full); const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(full.endsWith('404.html')?404:200,{'content-type':types[ext]||'application/octet-stream','cache-control':ext==='.html'?'no-cache':'public, max-age=86400','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",'permissions-policy':'camera=(), microphone=(), geolocation=()'});
    if(method==='HEAD') return res.end(); return createReadStream(full).pipe(res);
  } catch(err) { const status=err.status||500; if(status>=500) console.error('request_failed',requestId,err.message); else if(path.startsWith('/api/')) { try { audit(auditActor,'request.rejected','route',path,'denied',status===403?'csrf_or_origin_validation':status===413?'request_too_large':'client_request_rejected',requestId); } catch(auditError) { console.error('audit_write_failed',requestId,auditError.message); } } if(!res.headersSent) json(res,status,{error:status>=500?'Unexpected server error':err.message}); else res.destroy(); }
}
function pathSep(){return process.platform==='win32'?'\\':'/';}
function validSignature(ext,b){
  if(ext==='.txt') {
    if(b.includes(0)) return false;
    try { new TextDecoder('utf-8',{fatal:true}).decode(b); return true; } catch { return false; }
  }
  if(ext==='.pdf') {
    if(b.length<12||b.subarray(0,5).toString()!=='%PDF-') return false;
    return b.subarray(Math.max(0,b.length-2048)).toString('latin1').includes('%%EOF');
  }
  if(ext==='.png') {
    return b.length>=24 &&
      b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) &&
      b.subarray(12,16).toString('ascii')==='IHDR' &&
      b.readUInt32BE(16)>0 && b.readUInt32BE(20)>0;
  }
  if(ext==='.jpg'||ext==='.jpeg') return b.length>=4&&b[0]===0xff&&b[1]===0xd8&&b[b.length-2]===0xff&&b[b.length-1]===0xd9;
  return false;
}
function parseMultipart(buffer,boundary){
  if (!/^[0-9A-Za-z'()+_,.\/:=?-]{1,200}$/.test(boundary)) throw Object.assign(new Error('Invalid upload boundary'),{status:400});
  const delimiter=Buffer.from('--'+boundary);
  const separator=Buffer.from('\r\n\r\n');
  const fields=Object.create(null);
  let file=null, cursor=0, parts=0;
  const first=buffer.indexOf(delimiter);
  if(first<0) throw Object.assign(new Error('Malformed multipart body'),{status:400});
  cursor=first+delimiter.length;
  if(buffer.subarray(cursor,cursor+2).equals(Buffer.from('--'))) return {fields,file};
  if(!buffer.subarray(cursor,cursor+2).equals(Buffer.from('\r\n'))) throw Object.assign(new Error('Malformed multipart delimiter'),{status:400});
  cursor+=2;
  while(cursor<buffer.length){
    if(++parts>20) throw Object.assign(new Error('Too many upload fields'),{status:400});
    const headerEnd=buffer.indexOf(separator,cursor);
    if(headerEnd<0||headerEnd-cursor>8192) throw Object.assign(new Error('Malformed multipart headers'),{status:400});
    const headerText=buffer.subarray(cursor,headerEnd).toString('latin1');
    if(/\r(?!\n)|(?<!\r)\n/.test(headerText)) throw Object.assign(new Error('Malformed multipart headers'),{status:400});
    const disposition=headerText.match(/^content-disposition:\s*form-data;\s*name="([^"\r\n]{1,100})"(?:;\s*filename="([^"\r\n]{0,255})")?\s*$/im);
    if(!disposition) throw Object.assign(new Error('Malformed multipart disposition'),{status:400});
    const contentStart=headerEnd+separator.length;
    let next=buffer.indexOf(Buffer.concat([Buffer.from('\r\n'),delimiter]),contentStart);
    if(next<0) throw Object.assign(new Error('Multipart closing boundary missing'),{status:400});
    const data=buffer.subarray(contentStart,next);
    const name=disposition[1];
    if(disposition[2]!==undefined){
      if(file) throw Object.assign(new Error('Only one file may be uploaded at a time'),{status:400});
      const type=headerText.match(/^content-type:\s*([^\r\n]+)$/im)?.[1]?.trim().toLowerCase()||'';
      file={filename:disposition[2],contentType:type,data:Buffer.from(data)};
    }else{
      if(Object.hasOwn(fields,name)) throw Object.assign(new Error('Duplicate multipart field'),{status:400});
      fields[name]=data.toString('utf8').slice(0,200);
    }
    cursor=next+2+delimiter.length;
    if(buffer.subarray(cursor,cursor+2).equals(Buffer.from('--'))){
      cursor+=2;
      if(cursor<buffer.length && !buffer.subarray(cursor,cursor+2).equals(Buffer.from('\r\n'))) throw Object.assign(new Error('Malformed closing boundary'),{status:400});
      return {fields,file};
    }
    if(!buffer.subarray(cursor,cursor+2).equals(Buffer.from('\r\n'))) throw Object.assign(new Error('Malformed multipart delimiter'),{status:400});
    cursor+=2;
  }
  throw Object.assign(new Error('Multipart closing boundary missing'),{status:400});
}
async function seed(){ if(process.env.NODE_ENV!=='development'||process.env.SEED_DEMO_USERS!=='true') return; const password=process.env.DEMO_SEED_PASSWORD; if(!password||password.length<14) {console.warn('Demo seeding skipped: set DEMO_SEED_PASSWORD to at least 14 characters.');return;} for(const [email,name,role] of [['admin@trustvault.test','Demo Administrator','Administrator'],['owner@trustvault.test','Demo Owner','DocumentOwner'],['viewer@trustvault.test','Demo Viewer','Viewer']]) { if(q('SELECT id FROM users WHERE email=?',email)) continue; const p=await hashPassword(password); run('INSERT INTO users(id,email,display_name,role,password_hash,salt,created_at) VALUES(?,?,?,?,?,?,?)',randomUUID(),email,name,role,p.hash,p.salt,now()); } }
await seed();
const server=http.createServer(route);
// Bound slow-header/body and keep-alive resource use for public deployments.
server.requestTimeout=120_000;
server.headersTimeout=30_000;
server.keepAliveTimeout=5_000;
server.maxHeadersCount=100;
server.maxRequestsPerSocket=1000;
const port=Number(process.env.PORT||3000);
server.listen(port,()=>console.log(`TrustVault listening on http://localhost:${port}`));
export {server,DB,verifyAudit,hashPassword};

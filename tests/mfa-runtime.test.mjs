import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { generateTotpCode } from '../mfa.mjs';

const root=process.cwd();
const trustedOrigin='https://vault.example.test';
async function freePort(){return await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
async function waitReady(base,child,readOutput){for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error('Server exited: '+readOutput());try{const r=await fetch(base+'/api/health');if(r.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Server did not start: '+readOutput());}

test('production administrators must enroll TOTP and use non-replayed codes',async t=>{
  const temp=mkdtempSync(join(tmpdir(),'trustvault-mfa-runtime-'));
  for(const path of ['server.mjs','clamav.mjs','audit-sink.mjs','mfa.mjs','db/schema.sql']){
    const dest=join(temp,path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,path),dest);
  }
  mkdirSync(join(temp,'data'),{recursive:true});
  const db=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  db.exec(await import('node:fs').then(m=>m.readFileSync(join(root,'db/schema.sql'),'utf8')));
  const password='Very-Strong-Administrator-Test-2026!';
  const salt=randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(id,email,display_name,role,password_hash,salt,created_at) VALUES(?,?,?,?,?,?,?)')
    .run('test-admin-id','admin@trustvault.test','MFA Test Admin','Administrator',scryptSync(password,salt,64).toString('hex'),salt,new Date().toISOString());
  db.close();
  const port=await freePort(),base=`http://127.0.0.1:${port}`;
  const env={...process.env,NODE_ENV:'production',PORT:String(port),AUDIT_HMAC_KEY:'test-only-audit-key-with-at-least-32-bytes',AUDIT_SINK_URL:'https://audit.example.test/ingest',AUDIT_SINK_TOKEN:'test-only-audit-sink-token-with-at-least-32-bytes',MFA_ENCRYPTION_KEY:'ab'.repeat(32),TRUSTED_ORIGINS:trustedOrigin};
  let child=spawn(process.execPath,['server.mjs'],{cwd:temp,env,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',c=>output+=c.toString());child.stderr.on('data',c=>output+=c.toString());
  t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}rmSync(temp,{recursive:true,force:true});});
  await waitReady(base,child,()=>output);
  async function login(mfaCode){
    return fetch(base+'/api/auth/login',{method:'POST',headers:{origin:trustedOrigin,'content-type':'application/json'},body:JSON.stringify({email:'admin@trustvault.test',password,role:'Administrator',mfaCode})});
  }
  let response=await login();
  let responseText=await response.text();
  assert.equal(response.status,200,responseText+' initial admin can sign in only to complete MFA setup');
  let loginData=JSON.parse(responseText);
  let cookie=response.headers.get('set-cookie').split(';')[0];
  async function api(path,body){
    return fetch(base+path,{method:'POST',headers:{origin:trustedOrigin,cookie,'x-csrf-token':loginData.csrfToken,'content-type':'application/json'},body:JSON.stringify(body)});
  }
  response=await api('/api/users',{});
  assert.equal(response.status,403,'production admin tools must be blocked before MFA enrollment');
  response=await api('/api/admin/mfa/enroll',{password});
  responseText=await response.text();
  assert.equal(response.status,200,responseText);
  const enrollment=JSON.parse(responseText);
  const currentCode=generateTotpCode(enrollment.secret);
  response=await api('/api/admin/mfa/verify',{code:currentCode});
  responseText=await response.text();
  assert.equal(response.status,200,responseText);
  response=await api('/api/users',{});
  assert.equal(response.status,200,'admin tools become available after MFA is enabled');
  response=await fetch(base+'/api/auth/logout',{method:'POST',headers:{origin:trustedOrigin,cookie,'x-csrf-token':loginData.csrfToken,'content-type':'application/json'},body:'{}'});
  assert.equal(response.status,204);
  response=await login();
  assert.equal(response.status,401,'enabled MFA must be required at login');
  const futureCode=generateTotpCode(enrollment.secret,Date.now()+30_000);
  response=await login(futureCode);
  responseText=await response.text();
  assert.equal(response.status,200,responseText,'a valid unused TOTP code must allow login');
  response=await login(futureCode);
  assert.equal(response.status,401,'a TOTP time step must not be replayable');
});

import { DatabaseSync } from 'node:sqlite';
import { createHmac, randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateAuditSinkConfig } from '../audit-sink.mjs';

const scrypt = promisify(scryptCallback);
const fail = message => { console.error('Admin bootstrap failed: ' + message); process.exitCode = 1; };
if (process.env.NODE_ENV !== 'production') {
  fail('Run only inside the production-configured TrustVault container.');
} else {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = String(process.env.ADMIN_NAME || '').trim();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const auditKeyText = process.env.AUDIT_HMAC_KEY || '';
  let sinkUrl;
  try { sinkUrl = validateAuditSinkConfig(process.env.AUDIT_SINK_URL || '', process.env.AUDIT_SINK_TOKEN || ''); }
  catch (error) { fail(error.message); }
  const demoMode = process.env.TRUSTVAULT_DEMO_MODE === 'true';
const hasSinkUrl = Boolean(process.env.AUDIT_SINK_URL);
const hasSinkToken = Boolean(process.env.AUDIT_SINK_TOKEN);

if (hasSinkUrl !== hasSinkToken) {
  fail('Configure both AUDIT_SINK_URL and AUDIT_SINK_TOKEN, or leave both unset for demo mode.');
}

if (!hasSinkUrl && !demoMode) {
  fail('Without an external audit sink, TRUSTVAULT_DEMO_MODE=true is required.');
}

if (hasSinkUrl && hasSinkToken) {
  try {
    validateAuditSinkConfig(process.env.AUDIT_SINK_URL, process.env.AUDIT_SINK_TOKEN);
  } catch (error) {
    fail(error.message);
  }
}
  if (Buffer.byteLength(auditKeyText) < 32) fail('AUDIT_HMAC_KEY must be at least 32 bytes.');
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Provide a valid ADMIN_EMAIL.');
  if (!name || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) fail('Provide an ADMIN_NAME of 1-80 printable characters.');
  if (password.length < 16 || password.length > 1024) fail('ADMIN_PASSWORD must be between 16 and 1024 characters.');
  if (!process.exitCode) {
    const root = process.cwd();
    const data = resolve(process.env.DATA_DIR || join(root, 'data'));
    mkdirSync(data, { recursive: true, mode: 0o700 });
    const checkpointPath = join(data, 'audit-checkpoint.json');
    const markerPath = join(data, 'audit-checkpoint.initialized');
    const checkpointExists = existsSync(checkpointPath);
    const markerExists = existsSync(markerPath);
    if (markerExists && !checkpointExists) fail('Audit checkpoint is missing after initialization; refusing to re-anchor it.');
    if (!process.exitCode) {
      const db = new DatabaseSync(join(data, 'trustvault.sqlite'));
      try {
        db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
        db.exec('CREATE TABLE IF NOT EXISTS audit_outbox (id TEXT PRIMARY KEY,seq INTEGER NOT NULL UNIQUE,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,last_error TEXT)');
        const q = (sql, ...args) => db.prepare(sql).get(...args);
        const run = (sql, ...args) => db.prepare(sql).run(...args);
        const adminCount = q("SELECT COUNT(*) AS count FROM users WHERE role='Administrator'").count;
        if (adminCount > 0) {
  console.log('Administrator already exists; bootstrap skipped.');
  process.exit(0);
}
        const checkpoint = checkpointExists ? JSON.parse(readFileSync(checkpointPath, 'utf8')) : null;
        const latest = q('SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1');
        if (checkpointExists && (!checkpoint || checkpoint.version !== 1 || checkpoint.seq !== (latest?.seq || 0) || checkpoint.hash !== (latest?.hash || 'GENESIS'))) {
          throw new Error('Existing audit checkpoint does not match the current audit tail; resolve audit integrity before bootstrapping.');
        }
        const salt = randomBytes(16).toString('hex');
        const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
        const id = randomUUID();
        const event = {
          id: randomUUID(), at: new Date().toISOString(), actor_id: null,
          action: 'admin.bootstrap', target_type: 'user', target_id: id,
          outcome: 'success', reason: 'initial_admin_created', request_id: randomUUID(),
          prev_hash: latest?.hash || 'GENESIS'
        };
        const hashVersion = 2;
        const hash = createHmac('sha256', Buffer.from(auditKeyText)).update(JSON.stringify({ ...event, hash_version: hashVersion })).digest('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          run('INSERT INTO users(id,email,display_name,role,password_hash,salt,created_at,approval_status) VALUES(?,?,?,\'Administrator\',?,?,?,\'Approved\')',
            id, email, name, passwordHash, salt, event.at);
          run('INSERT INTO audit(id,at,actor_id,action,target_type,target_id,outcome,reason,request_id,prev_hash,hash,hash_version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            event.id,event.at,event.actor_id,event.action,event.target_type,event.target_id,event.outcome,event.reason,event.request_id,event.prev_hash,hash,hashVersion);
          const seq = q('SELECT seq FROM audit WHERE id=?', event.id).seq;
          const payload = { seq, event, hash, hash_version: hashVersion };
          run('INSERT INTO audit_outbox(id,seq,payload,created_at) VALUES(?,?,?,?)',event.id,seq,JSON.stringify(payload),event.at);
          db.exec('COMMIT');
          const nextCheckpoint = { version: 1, seq, hash, updatedAt: event.at };
          const tempPath = checkpointPath + '.tmp';
          writeFileSync(tempPath, JSON.stringify(nextCheckpoint) + '\n', { mode: 0o600 });
          renameSync(tempPath, checkpointPath);
          if (!markerExists) writeFileSync(markerPath, 'initialized\n', { mode: 0o600, flag: 'wx' });
          console.log('Created the initial Administrator account and recorded the bootstrap event.');
          console.log('Start/restart TrustVault and sign in with the supplied email and password. The password was not written to disk.');
        } catch (error) {
          try { db.exec('ROLLBACK'); } catch {}
          throw error;
        }
      } catch (error) {
        fail(error.message || String(error));
      } finally {
        db.close();
      }
    }
  }
}

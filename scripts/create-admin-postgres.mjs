import { randomBytes, scrypt as scryptCb, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const { Pool } = pg;
const scrypt = promisify(scryptCb);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for PostgreSQL administrator bootstrap.`);
  return value;
}

async function main() {
  const connectionString = requireEnv('DATABASE_URL');
  const email = requireEnv('ADMIN_EMAIL').trim().toLowerCase();
  const name = requireEnv('ADMIN_NAME').trim();
  const password = requireEnv('ADMIN_PASSWORD');
  const demoMode = process.env.TRUSTVAULT_DEMO_MODE === 'true';
  const auditSinkUrl = process.env.AUDIT_SINK_URL || '';
  const auditSinkToken = process.env.AUDIT_SINK_TOKEN || '';
  const auditKey = requireEnv('AUDIT_HMAC_KEY');
  const mfaKey = requireEnv('MFA_ENCRYPTION_KEY');

  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email address.');
  if (!name || name.length > 120) throw new Error('ADMIN_NAME must be between 1 and 120 characters.');
  if (password.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
  if (Buffer.byteLength(auditKey, 'utf8') < 32) throw new Error('AUDIT_HMAC_KEY must be at least 32 bytes.');
  if (!/^[a-f0-9]{64}$/i.test(mfaKey)) throw new Error('MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.');
  if ((!auditSinkUrl || !auditSinkToken) && (!demoMode || auditSinkUrl || auditSinkToken)) {
    throw new Error('Configure both AUDIT_SINK_URL and AUDIT_SINK_TOKEN, or leave both unset only in demo mode.');
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: true },
    max: 2,
    connectionTimeoutMillis: 10_000,
    application_name: 'trustvault-admin-bootstrap',
  });

  try {
    const schemaPath = resolve(process.cwd(), 'db', 'schema.postgres.sql');
    await pool.query(readFileSync(schemaPath, 'utf8'));
    const existing = await pool.query("SELECT id FROM users WHERE role='Administrator' ORDER BY created_at LIMIT 1");
    if (existing.rowCount) {
      console.log('Administrator already exists; PostgreSQL bootstrap skipped.');
      return;
    }

    const salt = randomBytes(16).toString('hex');
    const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
    const id = randomBytes(16).toString('hex');
    const at = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO users(id,email,display_name,role,password_hash,salt,created_at,approval_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, email, name, 'Administrator', passwordHash, salt, at, 'Approved'],
      );
      const event = {
        id: randomBytes(16).toString('hex'),
        at,
        actor_id: id,
        action: 'admin.bootstrap',
        target_type: 'user',
        target_id: id,
        outcome: 'success',
        reason: 'initial_administrator_created',
        request_id: null,
        prev_hash: 'GENESIS',
      };
      const hash = createHash('sha256').update(JSON.stringify(event)).digest('hex');
      const audit = await client.query(
        'INSERT INTO audit(at,id,actor_id,action,target_type,target_id,outcome,reason,request_id,prev_hash,hash,hash_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING seq',
        [event.at,event.id,event.actor_id,event.action,event.target_type,event.target_id,event.outcome,event.reason,event.request_id,event.prev_hash,hash,1],
      );
      const checkpoint = { seq: Number(audit.rows[0].seq), hash };
      await client.query(
        'INSERT INTO audit_outbox(id,seq,payload,created_at) VALUES($1,$2,$3,$4)',
        [event.id, checkpoint.seq, JSON.stringify(event), at],
      );
      await client.query('COMMIT');
      console.log('PostgreSQL administrator bootstrap completed.');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`PostgreSQL administrator bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});

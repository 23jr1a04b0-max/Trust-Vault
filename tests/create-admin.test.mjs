import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

test('production admin bootstrap creates one audited admin and refuses a second', () => {
  const root = process.cwd();
  const temp = mkdtempSync(join(tmpdir(), 'trustvault-admin-bootstrap-'));
  try {
    for (const path of ['scripts/create-admin.mjs','audit-sink.mjs','db/schema.sql']) {
      const dest = join(temp,path);
      mkdirSync(dirname(dest),{recursive:true});
      copyFileSync(join(root,path),dest);
    }
    const env = {
      ...process.env,
      NODE_ENV:'production',
      ADMIN_EMAIL:'security-admin@example.test',
      ADMIN_NAME:'Initial Administrator',
      ADMIN_PASSWORD:'Very-Strong-Test-Password-2026!',
      AUDIT_HMAC_KEY:'test-only-audit-hmac-key-with-more-than-32-bytes',
      AUDIT_SINK_URL:'https://audit.example.test/ingest',
      AUDIT_SINK_TOKEN:'test-only-audit-sink-token-with-more-than-32-bytes'
    };
    const first = spawnSync(process.execPath,['scripts/create-admin.mjs'],{cwd:temp,env,encoding:'utf8'});
    assert.equal(first.status,0,first.stdout+'\n'+first.stderr);
    assert.match(first.stdout,/Created the initial Administrator account/);
    const db = new DatabaseSync(join(temp,'data','trustvault.sqlite'));
    try {
      const user = db.prepare("SELECT email,display_name,role,password_hash FROM users WHERE email=?").get(env.ADMIN_EMAIL);
      assert.equal(user.role,'Administrator');
      assert.equal(user.display_name,env.ADMIN_NAME);
      assert.notEqual(user.password_hash,env.ADMIN_PASSWORD);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit WHERE action='admin.bootstrap' AND outcome='success'").get().count,1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_outbox').get().count,1);
      const checkpoint=JSON.parse(readFileSync(join(temp,'data','audit-checkpoint.json'),'utf8'));
      const latest=db.prepare('SELECT seq,hash FROM audit ORDER BY seq DESC LIMIT 1').get();
      assert.equal(checkpoint.seq,latest.seq);
      assert.equal(checkpoint.hash,latest.hash);
    } finally { db.close(); }
    const second = spawnSync(process.execPath,['scripts/create-admin.mjs'],{cwd:temp,env,encoding:'utf8'});
assert.equal(second.status,0,second.stdout+'\n'+second.stderr);
assert.match(second.stdout,/Administrator already exists; bootstrap skipped/);
  } finally {
    rmSync(temp,{recursive:true,force:true});
  }
});

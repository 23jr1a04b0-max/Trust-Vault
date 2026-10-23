import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'trustvault-mutation-'));
try {
  const paths = [
    'server.mjs', 'clamav.mjs', 'audit-sink.mjs', 'db/schema.sql', 'public/index.html', 'public/app.css',
    'public/app.js', 'public/404.html', 'tests/integration.test.mjs'
  ];
  for (const path of paths) {
    const dest = join(temp, path);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(root, path), dest);
  }
  const serverPath = join(temp, 'server.mjs');
  const source = readFileSync(serverPath, 'utf8');
  const guard = "if(!hasDocAccess(user,d,'Download'))";
  const streamGuard = "if(!liveUser||liveUser.id!==user.id||!hasDocAccess(liveUser,current,'Download'))";
  assert.ok(source.includes(guard), 'Expected initial download authorization guard was not found');
  assert.ok(source.includes(streamGuard), 'Expected streaming download authorization guard was not found');
  const mutated = source.replace(guard, 'if(false)').replace(streamGuard, 'if(false)');
  writeFileSync(serverPath, mutated, 'utf8');

  const result = spawnSync(process.execPath, ['--test', 'tests/integration.test.mjs'], {
    cwd: temp,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test' }
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0,
    'Security integration test unexpectedly passed after both initial and streaming download authorization checks were removed');
  assert.match(result.stdout + result.stderr, /Read permission must not allow downloading|one owner must not download another owner's private document without a grant/,
    'Mutation must be detected by a download-authorization assertion, not an unrelated failure');
  console.log('PASS: HTTP integration test fails on a download-authorization assertion after both authorization checks are removed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

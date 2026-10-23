import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), 'trustvault-mutation-'));
try {
  const paths = [
    'server.mjs', 'db/schema.sql', 'public/index.html', 'public/app.css',
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
  assert.ok(source.includes(guard), 'Expected download authorization guard was not found');
  writeFileSync(serverPath, source.replace(guard, 'if(false)'), 'utf8');

  const result = spawnSync(process.execPath, ['--test', 'tests/integration.test.mjs'], {
    cwd: temp,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, NODE_ENV: 'test' }
  });
  if (result.error) throw result.error;
  assert.notEqual(result.status, 0,
    'Security integration test unexpectedly passed after the download authorization check was removed');
  console.log('PASS: HTTP integration test fails when the download authorization check is removed.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}

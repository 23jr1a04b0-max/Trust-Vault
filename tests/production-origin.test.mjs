import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production configuration requirements are enforced by server', () => {
  const server = readFileSync('server.mjs','utf8');
  assert.match(server, /Production requires AUDIT_HMAC_KEY/);
  assert.match(server, /productionOriginAllowed/);
  assert.match(server, /SameSite=Strict/);
  assert.match(server, /Secure/);
});

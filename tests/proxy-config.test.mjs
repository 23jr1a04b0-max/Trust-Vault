import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Nginx proxy configuration does not trust client-controlled Host forwarding', () => {
  const site = readFileSync('deploy/nginx/trustvault.conf', 'utf8');
  const headers = readFileSync('deploy/nginx/trustvault-proxy-headers.conf', 'utf8');
  assert.match(site, /return 301 https:\/\/\$server_name\$request_uri;/);
  assert.doesNotMatch(site, /return 301 https:\/\/\$host/);
  assert.match(headers, /proxy_set_header Host \$server_name;/);
  assert.match(headers, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(headers, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
});

test('Compose keeps ClamAV private and publishes TrustVault only to loopback', () => {
  const compose = readFileSync('compose.yaml', 'utf8');
  assert.match(compose, /127\.0\.0\.1:\$\{TRUSTVAULT_PORT:-3000\}:3000/);
  const clamav = compose.split('\n  clamav:\n')[1] || '';
  assert.doesNotMatch(clamav, /^\s{4}ports:/m);
});

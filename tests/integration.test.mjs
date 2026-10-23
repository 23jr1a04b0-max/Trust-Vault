import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const root = process.cwd();
const password = 'TrustVault-Demo-2026!';
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function waitForServer(base, child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error('TrustVault server exited before becoming ready');
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('TrustVault server did not become ready');
}

test('HTTP authorization: private isolation, Read versus Download, approval and revocation', async t => {
  const temp = mkdtempSync(join(tmpdir(), 'trustvault-test-'));
  for (const path of ['server.mjs','db/schema.sql','public/index.html','public/app.css','public/app.js','public/404.html']) {
    const dest = join(temp, path); mkdirSync(dirname(dest), { recursive: true }); copyFileSync(join(root, path), dest);
  }
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: temp,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', SEED_DEMO_USERS: 'true', DEMO_SEED_PASSWORD: password },
    stdio: ['ignore','pipe','pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
    rmSync(temp, { recursive: true, force: true });
  });
  await waitForServer(base, child);
  async function login(email) {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.equal(response.status, 200, output);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const data = await response.json();
    return { cookie, csrf: data.csrfToken, user: data.user };
  }
  async function request(session, path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (session) headers.set('cookie', session.cookie);
    if (session && options.method && !['GET','HEAD'].includes(options.method)) headers.set('x-csrf-token', session.csrf);
    return fetch(base + path, { ...options, headers });
  }
  async function upload(owner, visibility, name) {
    const form = new FormData();
    form.append('file', new Blob(['TrustVault test document'], { type: 'text/plain' }), name);
    form.append('category', 'Tests');
    form.append('visibility', visibility);
    const response = await request(owner, '/api/documents', { method: 'POST', body: form });
    const responseText = await response.text();
    assert.equal(response.status, 201, responseText);
    return JSON.parse(responseText).document;
  }
  const owner = await login('owner@trustvault.test');
  const viewer = await login('viewer@trustvault.test');
  assert.equal((await fetch(base + '/api/documents')).status, 401);

  const privateDoc = await upload(owner, 'Private', 'private.txt');
  let listing = await (await request(viewer, '/api/documents')).json();
  assert.ok(!listing.documents.some(doc => doc.id === privateDoc.id), 'private document metadata must not be discoverable');

  let share = await request(owner, `/api/documents/${privateDoc.id}/permissions`, {
    method: 'POST', body: JSON.stringify({ email: 'viewer@trustvault.test', permission: 'Read' })
  });
  assert.equal(share.status, 201, await share.text());
  listing = await (await request(viewer, '/api/documents')).json();
  assert.equal(listing.documents.find(doc => doc.id === privateDoc.id)?.accessPermission, 'Read');
  let content = await request(viewer, `/api/documents/${privateDoc.id}/content`);
  assert.equal(content.status, 200);
  assert.match(await content.text(), /TrustVault test document/);
  let download = await request(viewer, `/api/documents/${privateDoc.id}/download`);
  assert.equal(download.status, 404, 'Read permission must not allow downloading');

  const grants = await (await request(owner, `/api/documents/${privateDoc.id}/permissions`)).json();
  const grant = grants.permissions.find(p => p.email === 'viewer@trustvault.test' && !p.revoked_at);
  assert.ok(grant);
  const revoke = await request(owner, `/api/documents/${privateDoc.id}/permissions?userId=${encodeURIComponent(grant.user_id)}`, { method: 'DELETE' });
  assert.equal(revoke.status, 200);
  assert.equal((await request(viewer, `/api/documents/${privateDoc.id}/content`)).status, 404, 'revocation must block the next content request');

  const publicDoc = await upload(owner, 'Public', 'public.txt');
  listing = await (await request(viewer, '/api/documents')).json();
  assert.equal(listing.documents.find(doc => doc.id === publicDoc.id)?.accessPermission, 'Public listing');
  const requestAccess = await request(viewer, `/api/documents/${publicDoc.id}/requests`, { method: 'POST', body: JSON.stringify({ permission: 'Read' }) });
  assert.equal(requestAccess.status, 201, await requestAccess.text());
  const duplicate = await request(viewer, `/api/documents/${publicDoc.id}/requests`, { method: 'POST', body: JSON.stringify({ permission: 'Read' }) });
  assert.equal(duplicate.status, 409, 'duplicate pending requests must be blocked');
  const pending = await (await request(owner, '/api/access-requests')).json();
  const accessRequest = pending.requests.find(item => item.document_id === publicDoc.id && item.requester_id === viewer.user.id);
  assert.ok(accessRequest, 'owner should see the pending request');
  const approve = await request(owner, `/api/access-requests/${accessRequest.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Approved' })
  });
  assert.equal(approve.status, 200, await approve.text());
  content = await request(viewer, `/api/documents/${publicDoc.id}/content`);
  assert.equal(content.status, 200, 'approved Read request should grant inline viewing');
  assert.equal((await request(viewer, `/api/documents/${publicDoc.id}/download`)).status, 404);
});

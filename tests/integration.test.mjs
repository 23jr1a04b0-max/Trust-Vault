import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';

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
  // Simulate the earlier branch schema, which had an overly restrictive UNIQUE constraint.
  mkdirSync(join(temp, 'data'), { recursive: true });
  const legacyDb = new DatabaseSync(join(temp, 'data', 'trustvault.sqlite'));
  legacyDb.exec(readFileSync(join(root, 'db/schema.sql'), 'utf8'));
  legacyDb.exec(`DROP TABLE access_requests;
    CREATE TABLE access_requests (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      requester_id TEXT NOT NULL REFERENCES users(id),
      permission TEXT NOT NULL CHECK(permission IN ('Read','Download')),
      status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled')),
      created_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by TEXT REFERENCES users(id),
      expires_at TEXT,
      UNIQUE(document_id,requester_id,permission,status)
    );
    CREATE INDEX idx_access_requests_owner_status ON access_requests(document_id,status,created_at);`);
  legacyDb.close();
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
  async function upload(owner, visibility, name, bytes = 'TrustVault test document') {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'text/plain' }), name);
    form.append('category', 'Tests');
    form.append('visibility', visibility);
    const response = await request(owner, '/api/documents', { method: 'POST', body: form });
    const responseText = await response.text();
    assert.equal(response.status, 201, responseText);
    return JSON.parse(responseText).document;
  }
  const owner = await login('owner@trustvault.test');
  const viewer = await login('viewer@trustvault.test');
  const admin = await login('admin@trustvault.test');
  assert.equal((await fetch(base + '/api/documents')).status, 401);

  const privateDoc = await upload(owner, 'Private', 'private.txt');
  const binaryBytes = Buffer.from([0x54,0x56,0x00,0x01,0xff,0x80,0x0d,0x0a,0x41]);
  const binaryForm = new FormData();
  binaryForm.append('file', new Blob([binaryBytes], { type: 'text/plain' }), 'binary.txt');
  binaryForm.append('category','Tests');
  binaryForm.append('visibility','Private');
  const binaryUpload = await request(owner, '/api/documents', { method:'POST', body:binaryForm });
  const binaryText = await binaryUpload.text();
  assert.equal(binaryUpload.status,400,'NUL bytes must be rejected in TXT files');
  const boundary = '----trustvault-malformed-test';
  const malformed = await request(owner,'/api/documents',{method:'POST',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},body:`--${boundary}\\r\\nContent-Disposition: form-data; name="file"; filename="x.txt"\\r\\nContent-Type: text/plain\\r\\n\\r\\nmissing closing boundary`});
  assert.equal(malformed.status,400,'malformed multipart must be rejected cleanly');
  let listing = await (await request(viewer, '/api/documents')).json();
  assert.ok(!listing.documents.some(doc => doc.id === privateDoc.id), 'private document metadata must not be discoverable');

  const invalidExpiry = await request(owner, `/api/documents/${privateDoc.id}/permissions`, {
    method:'POST', body:JSON.stringify({email:'viewer@trustvault.test',permission:'Read',expiresAt:new Date(Date.now()-1000).toISOString()})
  });
  assert.equal(invalidExpiry.status,400,'owner grants must reject an expiry in the past');
  let share = await request(owner, `/api/documents/${privateDoc.id}/permissions`, {
    method: 'POST', body: JSON.stringify({ email: 'viewer@trustvault.test', permission: 'Read', expiresAt:new Date(Date.now()+60_000).toISOString() })
  });
  assert.equal(share.status, 201, await share.text());
  listing = await (await request(viewer, '/api/documents')).json();
  assert.equal(listing.documents.find(doc => doc.id === privateDoc.id)?.accessPermission, 'Read');
  const readEdit = await request(viewer, `/api/documents/${privateDoc.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'blocked.txt', category: 'Tests' }) });
  assert.equal(readEdit.status, 404, 'Read permission must not allow metadata editing');
  const noCsrf = await fetch(base + `/api/documents/${privateDoc.id}/permissions`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'viewer@trustvault.test', permission: 'Read' }) });
  assert.equal(noCsrf.status, 403, 'state-changing requests must require a CSRF token');
  let content = await request(viewer, `/api/documents/${privateDoc.id}/content`);
  assert.equal(content.status, 200);
  assert.match(await content.text(), /TrustVault test document/);
  let download = await request(viewer, `/api/documents/${privateDoc.id}/download`);
  assert.equal(download.status, 404, 'Read permission must not allow downloading');
  share = await request(owner, `/api/documents/${privateDoc.id}/permissions`, {
    method: 'POST', body: JSON.stringify({ email: 'viewer@trustvault.test', permission: 'Edit' })
  });
  assert.equal(share.status, 201, await share.text());
  const edit = await request(viewer, `/api/documents/${privateDoc.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'edited.txt', category: 'Reviewed' }) });
  assert.equal(edit.status, 200, await edit.text(), 'Edit permission should allow metadata updates');

  const grants = await (await request(owner, `/api/documents/${privateDoc.id}/permissions`)).json();
  const grant = grants.permissions.find(p => p.email === 'viewer@trustvault.test' && !p.revoked_at);
  assert.ok(grant);
  const revoke = await request(owner, `/api/documents/${privateDoc.id}/permissions?userId=${encodeURIComponent(grant.user_id)}`, { method: 'DELETE' });
  assert.equal(revoke.status, 200);
  assert.equal((await request(viewer, `/api/documents/${privateDoc.id}/content`)).status, 404, 'revocation must block the next content request');
  const auditCheck = await request(admin, '/api/audit/verify', { method: 'POST', body: '{}' });
  const auditText = await auditCheck.text();
  assert.equal(auditCheck.status, 200, auditText);
  assert.equal(JSON.parse(auditText).valid, true, 'audit chain should verify after tested operations');

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
  const secondRequest = await request(viewer, `/api/documents/${publicDoc.id}/requests`, { method: 'POST', body: JSON.stringify({ permission: 'Read' }) });
  assert.equal(secondRequest.status, 201, 'a new request must be possible after a prior decision');
  const secondPending = await (await request(owner, '/api/access-requests')).json();
  const secondAccessRequest = secondPending.requests.find(item => item.document_id === publicDoc.id && item.requester_id === viewer.user.id);
  assert.ok(secondAccessRequest);
  const secondApprove = await request(owner, `/api/access-requests/${secondAccessRequest.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Approved', expiresAt: new Date(Date.now()+60_000).toISOString() })
  });
  assert.equal(secondApprove.status, 200, await secondApprove.text(), 'repeated approval must work after migration from the legacy constraint');
  const thirdRequest = await request(viewer, `/api/documents/${publicDoc.id}/requests`, { method:'POST', body:JSON.stringify({permission:'Download'}) });
  assert.equal(thirdRequest.status,201,await thirdRequest.text());
  const thirdPending = await (await request(owner,'/api/access-requests')).json();
  const thirdAccessRequest = thirdPending.requests.find(item=>item.document_id===publicDoc.id&&item.requester_id===viewer.user.id&&item.permission==='Download');
  assert.ok(thirdAccessRequest);
  const expiredApproval = await request(owner,`/api/access-requests/${thirdAccessRequest.id}`,{method:'PATCH',body:JSON.stringify({status:'Approved',expiresAt:new Date(Date.now()-1000).toISOString()})});
  assert.equal(expiredApproval.status,400,'past-dated grant expiry must be rejected');
  const downloadApproval = await request(owner,`/api/access-requests/${thirdAccessRequest.id}`,{method:'PATCH',body:JSON.stringify({status:'Approved'})});
  assert.equal(downloadApproval.status,200,await downloadApproval.text());
  assert.equal((await request(viewer,`/api/documents/${publicDoc.id}/download`)).status,200,'Download approval should enable the download endpoint');
  const deniedLogins=[];
  for(let i=0;i<8;i++){
    const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'bad-login@trustvault.test',password:'wrong-password'})});
    deniedLogins.push(response.status);
  }
  assert.equal(deniedLogins.at(-1),429,'login rate limit should return 429 after repeated attempts');
  const verifyAfterAttempts=await request(admin,'/api/audit/verify',{method:'POST',body:'{}'});
  const verifyAfterText=await verifyAfterAttempts.text();
  assert.equal(verifyAfterAttempts.status,200,verifyAfterText);
  assert.equal(JSON.parse(verifyAfterText).valid,true,'denied login attempts should be recorded without breaking audit integrity');
  const disable=await request(admin,`/api/users/${viewer.user.id}`,{method:'PATCH',body:JSON.stringify({disabled:true})});
  assert.equal(disable.status,200,await disable.text());
  assert.equal((await request(viewer,'/api/documents')).status,401,'disabling an account must invalidate its existing session');
  const logout=await request(owner,'/api/auth/logout',{method:'POST',body:'{}'});
  assert.equal(logout.status,204);
  assert.equal((await request(owner,'/api/auth/me')).status,401,'logout must invalidate the session immediately');
  const finalAudit=await request(admin,'/api/audit/verify',{method:'POST',body:'{}'});
  const finalAuditText=await finalAudit.text();
  assert.equal(finalAudit.status,200,finalAuditText);
  assert.equal(JSON.parse(finalAuditText).valid,true,'audit chain should remain valid after account disable and logout');
});

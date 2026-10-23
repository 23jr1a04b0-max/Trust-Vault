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
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', SEED_DEMO_USERS: 'true', DEMO_SEED_PASSWORD: password, MAX_UPLOAD_BYTES:'1024' },
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
  const staticResponse=await fetch(base+'/');
  assert.equal(staticResponse.status,200);
  assert.match(staticResponse.headers.get('content-security-policy')||'',/frame-ancestors 'none'/,'static pages should receive a restrictive CSP');
  assert.equal(staticResponse.headers.get('x-frame-options'),'DENY');
  assert.equal(staticResponse.headers.get('referrer-policy'),'no-referrer');
  async function login(email, role = email.startsWith('admin@') ? 'Administrator' : email.startsWith('owner@') ? 'DocumentOwner' : 'Viewer') {
    const response = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, role })
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
  const sqlInjectionLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:"' OR 1=1 --",password,role:'Viewer'})});
  assert.equal(sqlInjectionLogin.status,401,'SQL-like login input must not bypass authentication or break the query');
  const viewer = await login('viewer@trustvault.test');
  const signupResponse=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'New Owner',email:'new-owner@trustvault.test',password:'Long-Enough-Test-Pass-123',role:'DocumentOwner'})});
  const signupOwnerData=await signupResponse.json();
  assert.equal(signupResponse.status,201,JSON.stringify(signupOwnerData));
  assert.equal(signupOwnerData.approvalStatus,'Pending','new owner accounts must require administrator approval');
  const signupViewer=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'New Viewer',email:'new-viewer@trustvault.test',password:'Long-Enough-Test-Pass-456',role:'Viewer'})});
  const signupViewerData=await signupViewer.json();
  assert.equal(signupViewer.status,201,JSON.stringify(signupViewerData));
  assert.equal(signupViewerData.approvalStatus,'Approved','viewer accounts should be registered immediately');
  const signupAdmin=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Fake Admin',email:'fake-admin@trustvault.test',password:'Long-Enough-Test-Pass-789',role:'Administrator'})});
  assert.equal(signupAdmin.status,400,'public sign-up must never create administrator accounts');
  const wrongRoleLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@trustvault.test',password,role:'Viewer'})});
  assert.equal(wrongRoleLogin.status,403,'login must enforce the selected role against the stored account role');
  const duplicateSignup=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Duplicate',email:'new-owner@trustvault.test',password:'Long-Enough-Test-Pass-123',role:'DocumentOwner'})});
  assert.equal(duplicateSignup.status,409,'duplicate email sign-up must be rejected');
  const admin = await login('admin@trustvault.test');
  const adminNotifications=await (await request(admin,'/api/notifications')).json();
  assert.ok(adminNotifications.notifications.some(n=>n.type==='owner-registration'),'administrators should receive owner-registration notifications');
  const viewerApprovalAttempt=await request(viewer,'/api/users/'+signupOwnerData.userId,{method:'PATCH',body:JSON.stringify({approvalStatus:'Approved'})});
  assert.equal(viewerApprovalAttempt.status,403,'viewers must not approve owner registrations');
  const pendingOwnerLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'new-owner@trustvault.test',password:'Long-Enough-Test-Pass-123',role:'DocumentOwner'})});
  assert.equal(pendingOwnerLogin.status,403,'pending owner must not sign in before approval');
  assert.match((await pendingOwnerLogin.json()).error,/awaiting administrator approval/i);
  const adminApprovesOwner=await request(admin,'/api/users/'+signupOwnerData.userId,{method:'PATCH',body:JSON.stringify({approvalStatus:'Approved'})});
  assert.equal(adminApprovesOwner.status,200,await adminApprovesOwner.text());
  const approvedOwnerLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'new-owner@trustvault.test',password:'Long-Enough-Test-Pass-123',role:'DocumentOwner'})});
  assert.equal(approvedOwnerLogin.status,200,'approved owner should be allowed to sign in');
  const approvedOwnerCookie=approvedOwnerLogin.headers.get('set-cookie');
  assert.ok(approvedOwnerCookie,'approved owner should receive a session');
  const approvedOwnerLoginData=await approvedOwnerLogin.json();
  const approvedOwnerSession={cookie:approvedOwnerCookie.split(';')[0],csrf:approvedOwnerLoginData.csrfToken,user:approvedOwnerLoginData.user};
  const ownerNotifications=await (await request(approvedOwnerSession,'/api/notifications')).json();
  assert.ok(ownerNotifications.notifications.some(n=>n.type==='owner-account-status' && /approved/i.test(n.title)),'owner should receive in-app approval notification');
  const ownerSessionDb=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  ownerSessionDb.prepare("UPDATE users SET approval_status='Rejected' WHERE id=?").run(signupOwnerData.userId);
  const revokedApprovalSession=await fetch(base+'/api/documents',{headers:{cookie:approvedOwnerCookie.split(';')[0]}});
  assert.equal(revokedApprovalSession.status,401,'a previously approved owner session must be blocked if administrator approval is revoked');
  ownerSessionDb.prepare("UPDATE users SET approval_status='Approved' WHERE id=?").run(signupOwnerData.userId);
  ownerSessionDb.close();
  const rejectOwner=await fetch(base+'/api/auth/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Rejected Owner',email:'rejected-owner@trustvault.test',password:'Long-Enough-Test-Pass-987',role:'DocumentOwner'})});
  const rejectOwnerData=await rejectOwner.json();
  assert.equal(rejectOwner.status,201);
  const adminRejectsOwner=await request(admin,'/api/users/'+rejectOwnerData.userId,{method:'PATCH',body:JSON.stringify({approvalStatus:'Rejected'})});
  assert.equal(adminRejectsOwner.status,200,await adminRejectsOwner.text());
  const rejectedOwnerLogin=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'rejected-owner@trustvault.test',password:'Long-Enough-Test-Pass-987',role:'DocumentOwner'})});
  assert.equal(rejectedOwnerLogin.status,403,'rejected owner must not sign in');
  assert.equal((await fetch(base + '/api/documents')).status, 401);

  const privateDoc = await upload(owner, 'Private', 'private.txt');
  assert.equal((await request(viewer, '/api/documents/'+privateDoc.id+'/permissions')).status,404,'non-owners must not inspect a document grant list');
  assert.equal((await request(viewer, '/api/documents/'+privateDoc.id+'/audit')).status,404,'non-owners must not inspect a document audit trail');
  const unauthorizedGrant=await request(viewer,'/api/documents/'+privateDoc.id+'/permissions',{method:'POST',body:JSON.stringify({email:'admin@trustvault.test',permission:'Download'})});
  assert.equal(unauthorizedGrant.status,404,'non-owners must not grant document access');
  const unauthorizedRevoke=await request(viewer,'/api/documents/'+privateDoc.id+'/permissions?userId='+encodeURIComponent(admin.user.id),{method:'DELETE',body:'{}'});
  assert.equal(unauthorizedRevoke.status,404,'non-owners must not revoke document access');
  assert.equal((await request(owner,'/api/audit')).status,403,'document owners must not access the global administrator audit feed');
  assert.equal((await request(viewer,'/api/audit/verify',{method:'POST',body:'{}'})).status,403,'viewers must not verify the global audit chain');
  const binaryBytes = Buffer.from([0x54,0x56,0x00,0x01,0xff,0x80,0x0d,0x0a,0x41]);
  const binaryForm = new FormData();
  binaryForm.append('file', new Blob([binaryBytes], { type: 'text/plain' }), 'binary.txt');
  binaryForm.append('category','Tests');
  binaryForm.append('visibility','Private');
  const binaryUpload = await request(owner, '/api/documents', { method:'POST', body:binaryForm });
  const binaryText = await binaryUpload.text();
  assert.equal(binaryUpload.status,400,'NUL bytes must be rejected in TXT files');
  const boundary = '----trustvault-malformed-test';
  const malformed = await request(owner,'/api/documents',{method:'POST',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},body:`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.txt"\r\nContent-Type: text/plain\r\n\r\nmissing closing boundary`});
  assert.equal(malformed.status,400,'malformed multipart must be rejected cleanly');
  const traversalBoundary='----trustvault-path-traversal';
  const traversalUpload=await request(owner,'/api/documents',{method:'POST',headers:{'content-type':`multipart/form-data; boundary=${traversalBoundary}`},body:`--${traversalBoundary}\r\nContent-Disposition: form-data; name="file"; filename="../outside.txt"\r\nContent-Type: text/plain\r\n\r\nsafe text\r\n--${traversalBoundary}--\r\n`});
  assert.equal(traversalUpload.status,400,'path-bearing upload filenames must be rejected');
  const duplicateBoundary='----trustvault-duplicate-field';
  const duplicateFields=await request(owner,'/api/documents',{method:'POST',headers:{'content-type':`multipart/form-data; boundary=${duplicateBoundary}`},body:`--${duplicateBoundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\none\r\n--${duplicateBoundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\ntwo\r\n--${duplicateBoundary}--\r\n`});
  assert.equal(duplicateFields.status,400,'duplicate multipart fields must be rejected');
  const multiBoundary='----trustvault-multiple-files';
  const multipleFiles=await request(owner,'/api/documents',{method:'POST',headers:{'content-type':`multipart/form-data; boundary=${multiBoundary}`},body:`--${multiBoundary}\r\nContent-Disposition: form-data; name="file"; filename="one.txt"\r\nContent-Type: text/plain\r\n\r\none\r\n--${multiBoundary}\r\nContent-Disposition: form-data; name="file"; filename="two.txt"\r\nContent-Type: text/plain\r\n\r\ntwo\r\n--${multiBoundary}--\r\n`});
  assert.equal(multipleFiles.status,400,'multiple-file uploads must be rejected');
  const wrongMimeForm = new FormData();
  wrongMimeForm.append('file',new Blob(['not a trusted text upload'],{type:'application/octet-stream'}),'spoof.txt');
  wrongMimeForm.append('category','Tests');wrongMimeForm.append('visibility','Private');
  const wrongMime = await request(owner,'/api/documents',{method:'POST',body:wrongMimeForm});
  assert.equal(wrongMime.status,400,'declared MIME type must match the allowed extension');
  const invalidUtf8Form=new FormData();
  invalidUtf8Form.append('file',new Blob([new Uint8Array([0xff,0xfe,0x41])],{type:'text/plain'}),'invalid-utf8.txt');
  invalidUtf8Form.append('category','Tests');invalidUtf8Form.append('visibility','Private');
  const invalidUtf8=await request(owner,'/api/documents',{method:'POST',body:invalidUtf8Form});
  assert.equal(invalidUtf8.status,400,'TXT uploads must contain valid UTF-8 text');
  const incompletePdfForm=new FormData();
  incompletePdfForm.append('file',new Blob(['%PDF-1.7\\nthis is not a complete PDF'],{type:'application/pdf'}),'incomplete.pdf');
  incompletePdfForm.append('category','Tests');incompletePdfForm.append('visibility','Private');
  const incompletePdf=await request(owner,'/api/documents',{method:'POST',body:incompletePdfForm});
  assert.equal(incompletePdf.status,400,'PDF uploads without an end-of-file marker must be rejected');
  const oversizedForm = new FormData();
  oversizedForm.append('file',new Blob(['x'.repeat(2048)],{type:'text/plain'}),'large.txt');
  oversizedForm.append('category','Tests');oversizedForm.append('visibility','Private');
  const oversized = await request(owner,'/api/documents',{method:'POST',body:oversizedForm});
  assert.equal(oversized.status,400,'files above configured size limit must be rejected');
  let listing = await (await request(viewer, '/api/documents')).json();
  assert.ok(!listing.documents.some(doc => doc.id === privateDoc.id), 'private document metadata must not be discoverable');
  const adminListing=await (await request(admin,'/api/documents')).json();
  assert.ok(!adminListing.documents.some(doc=>doc.id===privateDoc.id),'administrator role alone must not reveal private document metadata');
  const nonAdminDisable=await request(viewer,'/api/users/'+admin.user.id,{method:'PATCH',body:JSON.stringify({disabled:true})});
  assert.equal(nonAdminDisable.status,403,'non-administrators must not change account state');

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
  const readDelete = await request(viewer, `/api/documents/${privateDoc.id}`, { method:'DELETE', body:'{}' });
  assert.equal(readDelete.status,404,'a non-owner cannot delete a document even when it has a Read grant');
  assert.equal((await request(viewer,'/api/users')).status,403,'non-administrators cannot list accounts');
  const noCsrf = await fetch(base + `/api/documents/${privateDoc.id}/permissions`, { method: 'POST', headers: { cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'viewer@trustvault.test', permission: 'Read' }) });
  assert.equal(noCsrf.status, 403, 'state-changing requests must require a CSRF token');
  let content = await request(viewer, `/api/documents/${privateDoc.id}/content`);
  assert.equal(content.status, 200);
  assert.match(await content.text(), /TrustVault test document/);
  let download = await request(viewer, `/api/documents/${privateDoc.id}/download`);
  assert.equal(download.status, 404, 'Read permission must not allow downloading');
  const expiryDb = new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  expiryDb.prepare('UPDATE grants SET expires_at=? WHERE document_id=? AND user_id=?').run('2000-01-01T00:00:00.000Z',privateDoc.id,viewer.user.id);
  expiryDb.close();
  listing = await (await request(viewer,'/api/documents')).json();
  assert.ok(!listing.documents.some(doc=>doc.id===privateDoc.id),'expired grants must not appear as active document access');
  assert.equal((await request(viewer,`/api/documents/${privateDoc.id}/content`)).status,404,'expired grants must immediately deny content access');
  share = await request(owner, `/api/documents/${privateDoc.id}/permissions`, {
    method: 'POST', body: JSON.stringify({ email: 'viewer@trustvault.test', permission: 'Read' })
  });
  assert.equal(share.status,201,await share.text(),'owner should be able to restore access after expiry');
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
  const deleteDoc = await request(owner,`/api/documents/${privateDoc.id}`,{method:'DELETE',body:'{}'});
  assert.equal(deleteDoc.status,200,await deleteDoc.text(),'owner can soft-delete owned document');
  assert.equal((await request(owner,`/api/documents/${privateDoc.id}/content`)).status,404,'soft-deleted documents must not serve content');
  const auditCheck = await request(admin, '/api/audit/verify', { method: 'POST', body: '{}' });
  const auditText = await auditCheck.text();
  assert.equal(auditCheck.status, 200, auditText);
  assert.equal(JSON.parse(auditText).valid, true, 'audit chain should verify after tested operations');

  const publicDoc = await upload(owner, 'Public', 'public.txt');
  const adminAccessRequest=await request(admin,`/api/documents/${publicDoc.id}/requests`,{method:'POST',body:JSON.stringify({permission:'Read'})});
  assert.equal(adminAccessRequest.status,403,'only Viewer accounts may request document access');
  const selfRequest = await request(owner, `/api/documents/${publicDoc.id}/requests`, {method:'POST',body:JSON.stringify({permission:'Read'})});
  assert.equal(selfRequest.status,403,'document owners cannot request document access');
  const privateRequest = await request(viewer, `/api/documents/${privateDoc.id}/requests`, {method:'POST',body:JSON.stringify({permission:'Read'})});
  assert.equal(privateRequest.status,404,'private documents must not accept public access requests');
  listing = await (await request(viewer, '/api/documents')).json();
  assert.equal(listing.documents.find(doc => doc.id === publicDoc.id)?.accessPermission, 'Public listing');
  const requestAccess = await request(viewer, `/api/documents/${publicDoc.id}/requests`, { method: 'POST', body: JSON.stringify({ permission: 'Read' }) });
  assert.equal(requestAccess.status, 201, await requestAccess.text());
  const ownerRequestNotifications=await (await request(owner,'/api/notifications')).json();
  assert.ok(ownerRequestNotifications.notifications.some(n=>n.type==='document-access-request' && /public\.txt/.test(n.message)),'owner should receive document request notification');
  const viewerBeforeDecision=await (await request(viewer,'/api/notifications')).json();
  assert.ok(!viewerBeforeDecision.notifications.some(n=>n.type==='document-access-request'),'notifications must be scoped to their recipient');
  const duplicate = await request(viewer, `/api/documents/${publicDoc.id}/requests`, { method: 'POST', body: JSON.stringify({ permission: 'Read' }) });
  assert.equal(duplicate.status, 409, 'duplicate pending requests must be blocked');
  const pending = await (await request(owner, '/api/access-requests')).json();
  const accessRequest = pending.requests.find(item => item.document_id === publicDoc.id && item.requester_id === viewer.user.id);
  assert.ok(accessRequest, 'owner should see the pending request');
  const approve = await request(owner, `/api/access-requests/${accessRequest.id}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'Approved' })
  });
  assert.equal(approve.status, 200, await approve.text());
  const viewerDecisionNotifications=await (await request(viewer,'/api/notifications')).json();
  assert.ok(viewerDecisionNotifications.notifications.some(n=>n.type==='document-access-decision' && /approved/i.test(n.title)),'viewer should be notified when the owner approves access');
  const markViewed=await request(viewer,'/api/notifications/read-all',{method:'POST',body:'{}'});
  assert.equal(markViewed.status,200,await markViewed.text());
  const afterViewed=await (await request(viewer,'/api/notifications')).json();
  assert.equal(afterViewed.unreadCount,0,'opening notifications should clear the unread count');
  assert.ok(afterViewed.notifications.filter(n=>n.type==='document-access-decision').every(n=>n.readAt),'viewed notifications should be marked read');
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
  const rejectedDoc=await upload(owner,'Public','rejected-request.txt');
  const rejectedRequest=await request(viewer,'/api/documents/'+rejectedDoc.id+'/requests',{method:'POST',body:JSON.stringify({permission:'Read'})});
  assert.equal(rejectedRequest.status,201,await rejectedRequest.text());
  const rejectedQueue=await (await request(owner,'/api/access-requests')).json();
  const rejection=rejectedQueue.requests.find(item=>item.document_id===rejectedDoc.id&&item.requester_id===viewer.user.id);
  assert.ok(rejection,'owner should see the request before rejecting it');
  const rejectResult=await request(owner,'/api/access-requests/'+rejection.id,{method:'PATCH',body:JSON.stringify({status:'Rejected'})});
  assert.equal(rejectResult.status,200,await rejectResult.text());
  assert.equal((await request(viewer,'/api/documents/'+rejectedDoc.id+'/content')).status,404,'rejected request must not grant content access');
  const sessionDb=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  sessionDb.prepare('UPDATE sessions SET last_seen_at=? WHERE user_id=?').run(Date.now()-31*60*1000,viewer.user.id);
  sessionDb.close();
  assert.equal((await request(viewer,'/api/documents')).status,401,'idle sessions must expire after the configured inactivity window');
  const viewerFresh=await login('viewer@trustvault.test');
  const absoluteDb=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  absoluteDb.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?').run(Date.now()-1000,owner.user.id);
  absoluteDb.close();
  assert.equal((await request(owner,'/api/auth/me')).status,401,'absolute session expiry must be enforced even when a session was recently active');
  const ownerFresh=await login('owner@trustvault.test');
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
  const selfDisable=await request(admin,`/api/users/${admin.user.id}`,{method:'PATCH',body:JSON.stringify({disabled:true})});
  assert.equal(selfDisable.status,400,'administrator must not disable its own account');
  const disable=await request(admin,`/api/users/${viewer.user.id}`,{method:'PATCH',body:JSON.stringify({disabled:true})});
  assert.equal(disable.status,200,await disable.text());
  assert.equal((await request(viewerFresh,'/api/documents')).status,401,'disabling an account must invalidate its existing session');
  const logout=await request(ownerFresh,'/api/auth/logout',{method:'POST',body:'{}'});
  assert.equal(logout.status,204);
  assert.equal((await request(ownerFresh,'/api/auth/me')).status,401,'logout must invalidate the session immediately');
  const finalAudit=await request(admin,'/api/audit/verify',{method:'POST',body:'{}'});
  const finalAuditText=await finalAudit.text();
  assert.equal(finalAudit.status,200,finalAuditText);
  assert.equal(JSON.parse(finalAuditText).valid,true,'audit chain should remain valid after account disable and logout');
  const auditFeedResponse=await request(admin,'/api/audit');
  assert.equal(auditFeedResponse.status,200);
  const auditFeed=(await auditFeedResponse.json()).events;
  assert.ok(auditFeed.some(e=>e.action==='permission.grant'&&e.reason==='invalid_grant_expiry'&&e.outcome==='denied'),'invalid grant expiry must be audited');
  assert.ok(auditFeed.some(e=>e.action==='access_request.create'&&e.reason==='duplicate_pending_request'&&e.outcome==='denied'),'duplicate access request must be audited');
  assert.ok(auditFeed.some(e=>e.action==='access_request.decide'&&e.reason==='invalid_grant_expiry'&&e.outcome==='denied'),'invalid access-request expiry decision must be audited');
  assert.ok(auditFeed.some(e=>e.action==='user.disable'&&e.reason==='self_disable_rejected'&&e.outcome==='denied'),'rejected self-disable must be audited');
  const tamperDb=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  tamperDb.prepare("UPDATE audit SET reason='tampered-after-write' WHERE seq=(SELECT MAX(seq) FROM audit)").run();
  tamperDb.close();
  const tamperedAudit=await request(admin,'/api/audit/verify',{method:'POST',body:'{}'});
  const tamperedText=await tamperedAudit.text();
  assert.equal(tamperedAudit.status,500,tamperedText);
  assert.equal(JSON.parse(tamperedText).valid,false,'audit verification must detect database-only event tampering');
  const truncationDb=new DatabaseSync(join(temp,'data','trustvault.sqlite'));
  truncationDb.prepare('DELETE FROM audit WHERE seq=(SELECT MAX(seq) FROM audit)').run();
  truncationDb.close();
  const truncatedAudit=await request(admin,'/api/audit/verify',{method:'POST',body:'{}'});
  const truncatedText=await truncatedAudit.text();
  assert.equal(truncatedAudit.status,500,truncatedText);
  assert.equal(JSON.parse(truncatedText).reason,'audit_checkpoint_mismatch','audit verification must detect tail deletion against the local checkpoint');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('required application files exist', () => {
  for (const path of ['db/schema.sql','public/index.html','public/app.js','public/app.css','public/404.html','public/favicon.svg']) {
    assert.ok(existsSync(path), `Missing required application file: ${path}`);
  }
});

test('database schema declares authorization and audit tables', () => {
  const schema = readFileSync('db/schema.sql','utf8');
  for (const table of ['users','sessions','documents','grants','audit']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /CHECK\s*\(permission IN \('Read','Download','Edit'\)\)/);
  assert.match(schema, /hash_version/);
});

test('static entry point does not expose private storage paths', () => {
  const html = readFileSync('public/index.html','utf8');
  assert.match(html, /name="description"/);
  assert.match(html, /\/app\.js/);
  assert.match(html, /\/favicon\.svg/);
  assert.doesNotMatch(html, /private-files|audit-hmac\.key/);
});

test('initial dashboard offers role selection and owner/viewer sign-up only', () => {
  const html = readFileSync('public/index.html','utf8');
  const js = readFileSync('public/app.js','utf8');
  for (const role of ['DocumentOwner','Viewer','Administrator']) assert.match(html,new RegExp('data-role="'+role+'"'));
  assert.match(html,/id="signup-form"/);
  assert.match(html,/id="show-signup"/);
  assert.match(js,/api\('\/api\/auth\/signup'/);
  assert.match(js,/\['DocumentOwner','Viewer'\]\.includes\(selectedRole\)/);
  assert.match(js,/role: selectedRole/);
});

test('owner registration requires administrator approval while viewer registration is immediate', () => {
  const server = readFileSync('server.mjs','utf8');
  const schema = readFileSync('db/schema.sql','utf8');
  const ui = readFileSync('public/app.js','utf8');
  assert.match(schema,/approval_status TEXT NOT NULL DEFAULT 'Approved'/);
  assert.match(server,/role==='DocumentOwner'\?'Pending':'Approved'/);
  assert.match(server,/owner account is awaiting administrator approval/i);
  assert.match(server,/input\.approvalStatus/);
  assert.match(ui,/Approve owner request/);
  assert.match(ui,/Reject owner request/);
  assert.match(ui,/data\.approvalStatus === 'Pending'/);
});

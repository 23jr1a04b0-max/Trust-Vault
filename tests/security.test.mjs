import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('required application files exist', () => {
  for (const path of ['db/schema.sql','public/index.html','public/app.js','public/app.css','public/404.html']) {
    assert.ok(existsSync(path), `Missing required application file: ${path}`);
  }
});

test('database schema declares authorization and audit tables', () => {
  const schema = readFileSync('db/schema.sql','utf8');
  for (const table of ['users','sessions','documents','grants','audit']) {
    assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(schema, /CHECK\s*\(permission IN \('Read','Edit'\)\)/);
  assert.match(schema, /hash_version/);
});

test('static entry point does not expose private storage paths', () => {
  const html = readFileSync('public/index.html','utf8');
  assert.match(html, /name="description"/);
  assert.match(html, /\/app\.js/);
  assert.doesNotMatch(html, /private-files|audit-hmac\.key/);
});

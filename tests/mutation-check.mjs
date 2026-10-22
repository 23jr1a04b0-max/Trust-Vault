import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This check ensures the protected download route still contains an authorization gate.
// A full HTTP mutation test must be added before this repository is considered production-ready.
const source = readFileSync('server.mjs','utf8');
const route = source.match(/if\(action==='download' && method==='GET'\)\s*\{([\s\S]*?)\n\s*\}/);
assert.ok(route, 'Download route must exist');
assert.match(route[1], /hasDocAccess\(user,d,'Download'\)/, 'Download route must authorize access');
console.log('PASS: download route includes a server-side authorization check.');

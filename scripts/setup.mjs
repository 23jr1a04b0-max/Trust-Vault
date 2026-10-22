import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = process.cwd();
const data = resolve(root, 'data');
mkdirSync(data, { recursive: true, mode: 0o700 });
mkdirSync(resolve(root, 'private-files'), { recursive: true, mode: 0o700 });
const keyPath = join(data, 'audit-hmac.key');
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
const db = new DatabaseSync(join(data, 'trustvault.sqlite'));
db.exec(readFileSync(join(root, 'db', 'schema.sql'), 'utf8'));
db.close();
console.log('TrustVault database schema is ready. No demo users were created.');

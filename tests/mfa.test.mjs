import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Encode, base32Decode, generateTotpSecret, generateTotpCode, encryptTotpSecret, decryptTotpSecret, verifyTotp } from '../mfa.mjs';

test('base32 round-trips generated authenticator secrets', () => {
  const secret = generateTotpSecret();
  assert.equal(base32Encode(base32Decode(secret)),secret);
  assert.equal(secret.length,32);
  const code=generateTotpCode(secret,59_000);
  assert.equal(verifyTotp(secret,code,{now:59_000,window:0}),1);
});

test('TOTP matches the RFC 6238 SHA-1 test vector at 59 seconds', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(verifyTotp(secret,'287082',{now:59_000,window:0}),1);
  assert.equal(verifyTotp(secret,'000000',{now:59_000,window:0}),null);
  assert.equal(verifyTotp(secret,'12x456',{now:59_000,window:0}),null);
});

test('TOTP secrets are encrypted with authenticated AES-256-GCM', () => {
  const secret=generateTotpSecret();
  const key='ab'.repeat(32);
  const encrypted=encryptTotpSecret(secret,key);
  assert.notEqual(encrypted,secret);
  assert.equal(decryptTotpSecret(encrypted,key),secret);
  assert.throws(()=>decryptTotpSecret(encrypted,'cd'.repeat(32)));
  assert.throws(()=>encryptTotpSecret(secret,'too-short'));
});

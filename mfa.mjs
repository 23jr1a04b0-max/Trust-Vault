import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0, value = 0, output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input) {
  const normalized = String(input).toUpperCase().replace(/=+$/,'').replace(/\s+/g,'');
  let bits = 0, value = 0;
  const out = [];
  for (const char of normalized) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

function encryptionKey(value) {
  const text = String(value || '');
  if (!/^[a-fA-F0-9]{64}$/.test(text)) throw new Error('MFA_ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  return Buffer.from(text,'hex');
}

export function encryptTotpSecret(secret, keyText) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(keyText), iv);
  const encrypted = Buffer.concat([cipher.update(String(secret),'utf8'),cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv,tag,encrypted].map(part=>part.toString('base64url')).join('.');
}

export function decryptTotpSecret(value, keyText) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted MFA secret');
  const [iv,tag,ciphertext] = parts.map(part=>Buffer.from(part,'base64url'));
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 256) throw new Error('Invalid encrypted MFA secret');
  const decipher = createDecipheriv('aes-256-gcm',encryptionKey(keyText),iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
}

function codeForStep(secret, step) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1',key).update(counter).digest();
  const offset = digest[digest.length-1] & 0x0f;
  const binary = ((digest[offset]&0x7f)<<24)|((digest[offset+1]&0xff)<<16)|((digest[offset+2]&0xff)<<8)|(digest[offset+3]&0xff);
  return String(binary % 1_000_000).padStart(6,'0');
}

export function generateTotpCode(secret, now = Date.now()) {
  return codeForStep(secret, Math.floor(now / 30_000));
}

export function verifyTotp(secret, code, { now = Date.now(), window = 1 } = {}) {
  const supplied = String(code || '').trim();
  if (!/^\d{6}$/.test(supplied)) return null;
  const currentStep = Math.floor(now / 30_000);
  for (let delta = -window; delta <= window; delta++) {
    const step = currentStep + delta;
    if (step >= 0 && codeForStep(secret,step) === supplied) return step;
  }
  return null;
}

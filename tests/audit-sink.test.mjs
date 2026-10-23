import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateAuditSinkConfig, sendAuditEvent } from '../audit-sink.mjs';

test('audit sink requires HTTPS URL and a strong token together', () => {
  assert.equal(validateAuditSinkConfig('', ''), null);
  assert.throws(() => validateAuditSinkConfig('https://audit.example.test/ingest', ''), /configured together/);
  assert.throws(() => validateAuditSinkConfig('http://audit.example.test/ingest', 'x'.repeat(32)), /HTTPS/);
  assert.throws(() => validateAuditSinkConfig('https://audit.example.test/ingest', 'short'), /32 bytes/);
  assert.equal(validateAuditSinkConfig('https://audit.example.test/ingest', 't'.repeat(32)), 'https://audit.example.test/ingest');
});

test('audit sink signs the exact payload and uses idempotency key', async () => {
  let request;
  const payload = {seq:42, hash:'event-hash', action:'document.download'};
  await sendAuditEvent(payload, {
    url:'https://audit.example.test/ingest',
    token:'t'.repeat(32),
    hmacKey:Buffer.from('h'.repeat(32)),
    fetchImpl:async (url, init) => {
      request={url,init};
      return {ok:true,status:202};
    }
  });
  assert.equal(request.url,'https://audit.example.test/ingest');
  assert.equal(request.init.headers.authorization,'Bearer '+'t'.repeat(32));
  assert.equal(request.init.headers['idempotency-key'],'42');
  assert.equal(request.init.headers['x-trustvault-signature'],'sha256='+createHmac('sha256',Buffer.from('h'.repeat(32))).update(JSON.stringify(payload)).digest('hex'));
});

test('audit sink treats non-success responses as delivery failures', async () => {
  await assert.rejects(sendAuditEvent({seq:1},{url:'https://audit.example.test',token:'t'.repeat(32),hmacKey:Buffer.from('k'.repeat(32)),fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
});

test('audit sink refuses redirects to avoid forwarding its bearer token', async () => {
  let init;
  await assert.rejects(sendAuditEvent({seq:2},{url:'https://audit.example.test/ingest',token:'t'.repeat(32),hmacKey:Buffer.from('k'.repeat(32)),fetchImpl:async (_url, options)=>{init=options;throw new TypeError('redirect mode error');}}),/redirect mode error/);
  assert.equal(init.redirect,'error');
});

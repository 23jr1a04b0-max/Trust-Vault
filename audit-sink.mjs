import { createHmac } from 'node:crypto';

export function validateAuditSinkConfig(urlValue, tokenValue) {
  if (!urlValue && !tokenValue) return null;
  if (!urlValue || !tokenValue) throw new Error('AUDIT_SINK_URL and AUDIT_SINK_TOKEN must be configured together.');
  let url;
  try { url = new URL(urlValue); } catch { throw new Error('AUDIT_SINK_URL must be a valid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('AUDIT_SINK_URL must use HTTPS and must not include credentials or a fragment.');
  }
  if (Buffer.byteLength(tokenValue) < 32) throw new Error('AUDIT_SINK_TOKEN must be at least 32 bytes.');
  return url.toString();
}

export async function sendAuditEvent(payload, {
  url,
  token,
  hmacKey,
  fetchImpl = fetch,
  timeoutMs = 5000
}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const signature = createHmac('sha256', hmacKey).update(body).digest('hex');
  const response = await fetchImpl(url, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer ' + token,
      'x-trustvault-signature': 'sha256=' + signature,
      'idempotency-key': String(typeof payload === 'object' && payload ? payload.seq : '')
    },
    body,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error('Audit sink returned HTTP ' + response.status);
  return true;
}

import net from 'node:net';

const CHUNK_BYTES = 64 * 1024;
const MAX_SCAN_BYTES = 100 * 1024 * 1024;

/**
 * Scan one in-memory file through ClamAV's clamd INSTREAM protocol.
 * Resolves only when clamd reports "stream: OK"; malware, protocol errors,
 * timeouts and scanner outages reject so callers can fail closed.
 */
export async function scanWithClamAV(buffer, {
  host = process.env.CLAMAV_HOST || 'clamav',
  port = Number(process.env.CLAMAV_PORT || 3310),
  timeoutMs = 15_000
} = {}) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('ClamAV input must be a Buffer');
  if (buffer.length > MAX_SCAN_BYTES) throw new Error('File exceeds the configured scanner limit');
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid ClamAV endpoint');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = Buffer.alloc(0);
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      error ? reject(error) : resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('ClamAV scan timed out')));
    socket.on('error', error => finish(new Error('ClamAV scanner unavailable: ' + error.message)));
    socket.on('data', chunk => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 4096) return finish(new Error('Unexpected ClamAV response'));
      const end = response.indexOf(0);
      if (end < 0) return;
      const message = response.subarray(0, end).toString('utf8');
      if (message.endsWith(': OK')) return finish(null, { clean: true });
      if (message.includes(' FOUND')) return finish(Object.assign(new Error('Malware detected by ClamAV'), { code: 'MALWARE_DETECTED' }));
      finish(new Error('ClamAV scan failed: ' + message.slice(0, 200)));
    });

    socket.on('connect', async () => {
      try {
        socket.write(Buffer.from('zINSTREAM\0'));
        for (let offset = 0; offset < buffer.length; offset += CHUNK_BYTES) {
          const chunk = buffer.subarray(offset, Math.min(offset + CHUNK_BYTES, buffer.length));
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length, 0);
          if (!socket.write(Buffer.concat([length, chunk]))) await new Promise((res, rej) => {
            socket.once('drain', res);
            socket.once('error', rej);
          });
        }
        const terminator = Buffer.alloc(4);
        terminator.writeUInt32BE(0, 0);
        socket.end(terminator);
      } catch (error) {
        finish(error);
      }
    });
  });
}

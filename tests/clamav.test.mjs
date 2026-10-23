import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { scanWithClamAV } from '../clamav.mjs';

async function fakeClamd(reply) {
  const server = net.createServer(socket => {
    let data = Buffer.alloc(0);
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      // The protocol terminator is a zero-length chunk.
      for (let i = 0; i + 4 <= data.length;) {
        const size = data.readUInt32BE(i);
        if (i === 0) {
          const marker = data.indexOf(Buffer.from('INSTREAM\0'));
          if (marker < 0) return;
          i = marker + 9;
        }
        if (i + 4 > data.length) return;
        const n = data.readUInt32BE(i);
        if (n === 0) { socket.end(Buffer.from(reply + '\0')); return; }
        if (i + 4 + n > data.length) return;
        i += 4 + n;
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}

test('ClamAV scanner accepts clean file response', async t => {
  const f = await fakeClamd('stream: OK');
  t.after(() => f.server.close());
  assert.deepEqual(await scanWithClamAV(Buffer.from('safe text'), {host:'127.0.0.1',port:f.port}), {clean:true});
});

test('ClamAV scanner rejects malware findings', async t => {
  const f = await fakeClamd('stream: Eicar-Test-Signature FOUND');
  t.after(() => f.server.close());
  await assert.rejects(scanWithClamAV(Buffer.from('sample'), {host:'127.0.0.1',port:f.port}), e => e.code === 'MALWARE_DETECTED');
});

test('ClamAV scanner fails closed when service is unavailable', async () => {
  await assert.rejects(scanWithClamAV(Buffer.from('sample'), {host:'127.0.0.1',port:1,timeoutMs:250}), /scanner unavailable|timed out/);
});

test('ClamAV scanner rejects non-buffer and oversized inputs', async () => {
  await assert.rejects(scanWithClamAV('not a buffer'), /Buffer/);
  await assert.rejects(scanWithClamAV(Buffer.alloc(100 * 1024 * 1024 + 1)), /scanner limit/);
});

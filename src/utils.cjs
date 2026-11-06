const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function id(prefix) { return `${prefix}_${randomUUID()}`; }
function httpError(status, message) { return Object.assign(new Error(message), { status }); }
function normalizeUrl(input) {
  const value = String(input ?? '').trim();
  if (!value || value === 'about:blank') return 'about:blank';
  const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d+(?:[/?#]|$))/i.test(value);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(value);
  const url = new URL(hasScheme ? value : `${local ? 'http' : 'https'}://${value}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw httpError(400, '只支持 HTTP、HTTPS 和 about:blank 页面');
  if (url.username || url.password) throw httpError(400, '请勿在地址中包含用户名或密码');
  return url.href;
}
async function availablePort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(preferred, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}
async function atomicJson(filename, value) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temp = `${filename}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, filename);
}
function boundedText(value, maxBytes) {
  const bytes = Buffer.from(String(value));
  return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: bytes.length > maxBytes, originalBytes: bytes.length };
}
module.exports = { id, httpError, normalizeUrl, availablePort, atomicJson, boundedText };

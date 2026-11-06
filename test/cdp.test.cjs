const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { WebSocketServer } = require('ws');
const { CdpConnection } = require('../src/cdp.cjs');

test('CDP transport 区分响应和事件，超时及断线会结束挂起的调用', async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  t.after(() => { for (const client of server.clients) client.terminate(); server.close(); });
  server.on('connection', socket => socket.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.method === 'Runtime.enable') {
      socket.send(JSON.stringify({ id: message.id, result: { enabled: true } }));
      socket.send(JSON.stringify({ method: 'Runtime.consoleAPICalled', params: { type: 'log' } }));
    }
  }));
  const cdp = await CdpConnection.connect(`ws://127.0.0.1:${server.address().port}`);
  const event = once(cdp, 'event');
  assert.equal((await cdp.send('Runtime.enable')).enabled, true);
  assert.equal((await event)[0], 'Runtime.consoleAPICalled');
  await assert.rejects(cdp.send('Never.answers', {}, undefined, 30), /timeout/);
  const pending = cdp.send('Never.answers'); cdp.close();
  await assert.rejects(pending, /closed/); assert.equal(cdp.pending.size, 0);
});

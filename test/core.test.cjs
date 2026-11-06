const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { normalizeUrl, boundedText } = require('../src/utils.cjs');
const { Workspace } = require('../src/workspace.cjs');
const { CaptureStore } = require('../src/capture-store.cjs');
const { createApi } = require('../src/api.cjs');

test('地址处理支持本机端口，拒绝具有宿主权限的协议和 URL 凭证', () => {
  assert.equal(normalizeUrl('localhost:3000/test'), 'http://localhost:3000/test');
  assert.equal(normalizeUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000/');
  assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
  assert.equal(normalizeUrl(''), 'about:blank');
  for (const value of ['file:///C:/secret', 'javascript:alert(1)', 'data:text/html,x', 'https://user:password@example.com']) assert.throws(() => normalizeUrl(value));
  assert.equal(boundedText('abcdef', 3).truncated, true);
});
test('持久化操作并发时仍保存最后的完整工作区，损坏配置不被静默覆盖', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'page-debugger-state-'));
  const workspace = new Workspace(directory); await workspace.load();
  await Promise.all([workspace.createProfile({ name: 'A' }), workspace.createProfile({ name: 'B' })]);
  const restored = new Workspace(directory); await restored.load();
  assert.deepEqual(restored.state.profiles.map(profile => profile.name), ['默认环境', 'A', 'B']);
  await fs.writeFile(workspace.filename, '{broken');
  await assert.rejects(new Workspace(directory).load(), /原文件已保留/);
  assert.equal(await fs.readFile(workspace.filename, 'utf8'), '{broken');
});
test('关闭环境保留身份和配置，状态持久化且可以重新打开', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'page-debugger-profile-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = new Workspace(directory); await workspace.load();
  const profile = await workspace.createProfile({ name: '可重新打开的环境' });
  await workspace.setProfileClosed(profile.id, true);
  const restored = new Workspace(directory); await restored.load();
  assert.equal(restored.getProfile(profile.id).closed, true);
  assert.equal(restored.getProfile(profile.id).name, profile.name);
  await restored.setProfileClosed(profile.id, false);
  assert.equal(restored.getProfile(profile.id).closed, false);
  assert.equal(restored.state.profiles.length, 2);
  await assert.rejects(restored.setProfileClosed('missing', true), /不存在/);
});

test('记录淘汰会同步清理磁盘，完成后的响应更新不会丢失，并可读取历史运行', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'page-debugger-captures-'));
  const store = new CaptureStore(directory, { maxRecords: 2 }); await store.initialize();
  store.upsert('network', 'page_1', { id: 'request_1', startedAt: '2026-01-01T00:00:00Z', state: 'pending', url: '/a' });
  await store.flush();
  store.upsert('network', 'page_1', { id: 'request_1', startedAt: '2026-01-01T00:00:00Z', state: 'finished', url: '/a', body: { text: 'response' } });
  store.upsert('console', 'page_1', { id: 'console_2', startedAt: '2026-01-01T00:00:01Z', message: 'hello' });
  assert.equal(store.list({ kind: 'network', includeBodies: true })[0].body.text, 'response');
  store.upsert('console', 'page_2', { id: 'console_3', startedAt: '2026-01-01T00:00:02Z', message: 'world' });
  await store.flush();
  assert.equal(store.summary().evicted, 1);
  await assert.rejects(fs.readFile(path.join(store.directory, 'request_1.json')), { code: 'ENOENT' });
  const next = new CaptureStore(directory); await next.initialize();
  assert.equal((await next.archiveRecords(store.runId, {})).length, 2);
  await assert.rejects(next.archiveRecords('../secret', {}), /Invalid/);
});
test('本地控制接口强制鉴权并拒绝浏览器 Origin 及 DNS rebinding Host', async t => {
  const server = createApi({ version: 'test', state: () => ({ secret: 'guarded' }) }, 'correct-token');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${endpoint}/health`)).status, 200);
  assert.equal((await fetch(`${endpoint}/v1/status`)).status, 401);
  assert.equal((await fetch(`${endpoint}/v1/status`, { headers: { Authorization: 'Bearer correct-token', Origin: 'https://untrusted.example' } })).status, 403);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http.get(`${endpoint}/v1/status`, { headers: { Authorization: 'Bearer correct-token', Host: 'untrusted.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  const response = await fetch(`${endpoint}/v1/status`, { headers: { Authorization: 'Bearer correct-token' } });
  assert.equal((await response.json()).data.secret, 'guarded');
});

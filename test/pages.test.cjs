const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  class Contents extends EventEmitter {
    constructor() {
      super(); this.destroyed = false;
      this.navigationHistory = { canGoBack: () => false, canGoForward: () => false };
    }
    isDestroyed() { return this.destroyed; }
    getURL() { assert.equal(this.destroyed, false); return 'about:blank'; }
    isLoading() { assert.equal(this.destroyed, false); return false; }
    async loadURL() { assert.equal(this.destroyed, false); }
    setWindowOpenHandler() {}
    close() { assert.equal(this.destroyed, false); this.destroyed = true; this.emit('destroyed'); }
  }
  class View {
    constructor() { this.original = new Contents(); }
    get webContents() { return this.original.destroyed ? undefined : this.original; }
    setBackgroundColor() {}
    setVisible() { assert.equal(this.original.destroyed, false); }
    setBounds() { assert.equal(this.original.destroyed, false); }
  }
  class Recorder {
    constructor() { this.status = 'recording'; }
    async start() {}
    async stop() { this.stopped = true; await this.stopping; }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/pages.cjs'), 'utf8'), {
    module, URL, require: name => {
      if (name === 'electron') return { WebContentsView: View, session: { fromPartition: () => ({
        setPermissionRequestHandler() {}, setPermissionCheckHandler() {}
      }) } };
      if (name === './recorder.cjs') return { PageRecorder: Recorder };
      return require(path.join(__dirname, '../src', name));
    }
  });
  const children = new Set();
  const window = { isDestroyed: () => false, getContentSize: () => [1200, 800], contentView: {
    addChildView: view => children.add(view), removeChildView: view => children.delete(view)
  } };
  const workspace = { state: { profiles: [{ id: 'p' }, { id: 'q' }], tabs: [], activePageId: null },
    getProfile: profileId => workspace.state.profiles.find(profile => profile.id === profileId), async save() {} };
  const manager = new module.exports.PageManager(window, workspace, { upsert() {}, async flush() {} }, 'http://127.0.0.1:1', () => {});
  return { manager, workspace, children, Recorder };
}

test('状态刷新忽略已销毁、缺失 WebContents 和关闭中的标签，访问返回 404', async () => {
  const { manager } = harness();
  const live = await manager.create({ profileId: 'p' });
  manager.pages.set('missing', { id: 'missing', view: {} });
  manager.pages.set('destroyed', { id: 'destroyed', contents: { isDestroyed: () => true }, view: {} });
  manager.pages.set('closing', { id: 'closing', closing: true, view: {} });
  assert.equal(manager.list().length, 1);
  assert.equal(manager.list()[0].id, live.id);
  for (const pageId of ['missing', 'destroyed', 'closing']) {
    assert.throws(() => manager.get(pageId), error => error.status === 404);
  }
  assert.doesNotThrow(() => manager.layout());
});

test('原生 WebContents 销毁后清理记录器、视图和持久化标签，并选中同环境标签', async () => {
  const { manager, workspace, children } = harness();
  const sibling = await manager.create({ profileId: 'p' });
  await manager.create({ profileId: 'q' });
  const active = await manager.create({ profileId: 'p' });
  const page = manager.get(active.id);
  page.contents.close();
  assert.equal(page.view.webContents, undefined);
  assert.equal(manager.list().length, 2);
  assert.doesNotThrow(() => manager.layout());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.recorder.stopped, true);
  assert.equal(manager.pages.has(active.id), false);
  assert.equal(children.has(page.view), false);
  assert.equal(workspace.state.tabs.some(tab => tab.id === active.id), false);
  assert.equal(workspace.state.activePageId, sibling.id);
});

test('关闭等待采集器停止期间 WebContents 被销毁，状态更新与关闭均正常完成', async () => {
  const { manager, workspace } = harness();
  const created = await manager.create({ profileId: 'p' });
  const page = manager.get(created.id);
  let finish;
  page.recorder.stopping = new Promise(resolve => { finish = resolve; });
  const closing = manager.close(created.id);
  page.contents.close();
  assert.equal(manager.list().length, 0);
  assert.doesNotThrow(() => manager.layout());
  finish(); await closing;
  assert.equal(manager.pages.size, 0);
  assert.equal(workspace.state.tabs.length, 0);
  assert.equal(workspace.state.activePageId, null);
});

test('创建尚未完成时原生页面销毁，不保存已关闭的标签或掩盖原始错误', async () => {
  const { manager, workspace, Recorder } = harness();
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  Recorder.prototype.start = async function () { started(); await new Promise(resolve => { finish = resolve; }); };
  const creating = manager.create({ id: 'creating', profileId: 'p' });
  await ready;
  manager.pages.get('creating').contents.close();
  finish();
  await assert.rejects(creating, error => error.status === 404);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(workspace.state.tabs.length, 0);
  assert.equal(manager.pages.size, 0);
});

test('退出时跳过已失效的 WebContents，并保留正常标签供下次恢复', async () => {
  const { manager, workspace } = harness();
  const created = await manager.create({ profileId: 'p' });
  const page = manager.get(created.id);
  manager.pages.set('missing', { view: {}, recorder: { async stop() {} } });
  await manager.shutdown();
  assert.equal(page.contents.isDestroyed(), true);
  assert.equal(page.recorder.stopped, true);
  assert.equal(manager.pages.size, 0);
  assert.equal(workspace.state.tabs.length, 1);
});

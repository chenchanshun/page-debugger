const { test } = require('node:test');
const assert = require('node:assert/strict');
const { contextMenuItems, showContextMenu } = require('../src/context-menu.cjs');

const state = { profiles: [{ id: 'a' }, { id: 'b', closed: true }], pages: [
  { id: 'one', profileId: 'a' }, { id: 'two', profileId: 'a' }, { id: 'three', profileId: 'b' }
] };
test('原生右键菜单验证目标，关闭其他只统计同环境标签', () => {
  assert.deepEqual(contextMenuItems({ kind: 'profile', profileId: 'a' }, state).map(item => item.label), ['关闭']);
  assert.throws(() => contextMenuItems({ kind: 'profile', profileId: 'b' }, state), /已关闭/);
  assert.throws(() => contextMenuItems({ kind: 'page', pageId: 'missing' }, state), /已关闭/);
  assert.throws(() => contextMenuItems({ kind: 'unknown' }, state), /未知菜单/);
  const items = contextMenuItems({ kind: 'page', pageId: 'one' }, state);
  assert.deepEqual(items.map(item => item.label), ['关闭', '关闭其他', '关闭全部']);
  assert.equal(items[1].enabled, true);
  assert.equal(contextMenuItems({ kind: 'page', pageId: 'three' }, state)[1].enabled, false);
});
test('原生菜单等待菜单关闭，返回所选动作或取消结果', async () => {
  const window = {};
  for (const selection of [null, 'close-other-tabs']) {
    const Menu = { buildFromTemplate: items => ({ popup: options => {
      assert.equal(options.window, window);
      if (selection) items.find(item => item.id === selection).click();
      options.callback();
    } }) };
    assert.equal(await showContextMenu(Menu, window, { kind: 'page', pageId: 'one' }, state), selection);
  }
});

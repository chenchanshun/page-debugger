const { httpError } = require('./utils.cjs');

function contextMenuItems(input, state) {
  if (input.kind === 'profile') {
    if (!state.profiles.some(profile => profile.id === input.profileId && !profile.closed)) throw httpError(404, '环境已关闭或不存在');
    return [{ id: 'close-profile', label: '关闭', enabled: true }];
  }
  if (input.kind === 'page') {
    const page = state.pages.find(item => item.id === input.pageId);
    if (!page) throw httpError(404, '页面已关闭或不存在');
    return [
      { id: 'close-page', label: '关闭', enabled: true },
      { id: 'close-other-tabs', label: '关闭其他', enabled: state.pages.filter(item => item.profileId === page.profileId).length > 1 },
      { id: 'close-all-tabs', label: '关闭全部', enabled: true }
    ];
  }
  throw httpError(400, '未知菜单');
}

function showContextMenu(Menu, window, input, state) {
  const items = contextMenuItems(input, state);
  return new Promise(resolve => {
    let selected = null;
    const menu = Menu.buildFromTemplate(items.map(item => ({ ...item, click: () => { selected = item.id; } })));
    menu.popup({ window, callback: () => resolve(selected) });
  });
}
module.exports = { contextMenuItems, showContextMenu };

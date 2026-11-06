const path = require('node:path');

function showWindow(window) {
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.showInactive();
}
function createWindowTray({ window, onQuit, electron = require('electron') }) {
  const tray = new electron.Tray(path.join(__dirname, 'assets', 'app.ico'));
  const show = () => showWindow(window);
  const hide = () => { if (!window.isDestroyed()) window.hide(); };
  tray.setToolTip('Page Debugger · 点击恢复窗口');
  tray.setContextMenu(electron.Menu.buildFromTemplate([
    { label: 'Page Debugger', enabled: false },
    { type: 'separator' },
    { label: '显示窗口', click: show },
    { label: '后台运行', click: hide },
    { type: 'separator' },
    { label: '退出', click: onQuit }
  ]));
  tray.on('click', show); tray.on('double-click', show);
  return { show, hide, available: () => !tray.isDestroyed(), destroy: () => { if (!tray.isDestroyed()) tray.destroy(); } };
}
module.exports = { createWindowTray, showWindow };

const api = window.debugWorkspace;
const $ = selector => document.querySelector(selector);
let state, selectedProfileId, toastTimer, refreshTimer, selectedRecordId;
let closingTabs = false;
const currentPage = () => state?.pages.find(page => page.id === state.activePageId);
const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
async function act(action, input) {
  const result = await api.action(action, input);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
function toast(message) {
  $('#toast').textContent = message; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3200);
}
function handle(callback) { return async event => { try { await callback(event); } catch (error) { toast(error.message); } }; }
async function newTab() { await act('create-page', { profileId: selectedProfileId }); }
async function closeTabs(profileId, keepPageId) {
  if (closingTabs) return;
  closingTabs = true;
  try {
    if (keepPageId) await act('select-page', { pageId: keepPageId });
    const result = await act('close-profile-pages', { profileId, keepPageId });
    render(await act('state'));
    toast(keepPageId ? `已关闭 ${result.closed} 个标签页，保留此标签` : `已关闭当前环境的 ${result.closed} 个标签页`);
  } finally { closingTabs = false; }
}
async function pageContextMenu(event, page) {
  event.preventDefault(); event.stopPropagation();
  const action = await act('context-menu', { kind: 'page', pageId: page.id });
  if (action === 'close-page') await act('close-page', { pageId: page.id });
  if (action === 'close-other-tabs') await closeTabs(page.profileId, page.id);
  if (action === 'close-all-tabs') await closeTabs(page.profileId);
}
async function profileContextMenu(event, profile) {
  event.preventDefault();
  const action = await act('context-menu', { kind: 'profile', profileId: profile.id });
  if (action !== 'close-profile') return;
  await act('close-profile', { profileId: profile.id });
  render(await act('state')); toast('环境已关闭，可在「＋」中重新打开');
}
function render(next) {
  state = next;
  const active = currentPage();
  const openProfiles = state.profiles.filter(profile => !profile.closed);
  if (!selectedProfileId || !openProfiles.some(profile => profile.id === selectedProfileId)) selectedProfileId = active?.profileId ?? openProfiles[0]?.id;
  if (active && active.profileId !== selectedProfileId) selectedProfileId = active.profileId;
  const profile = state.profiles.find(item => item.id === selectedProfileId);
  $('#profile-name').textContent = profile?.name ?? '未打开环境';
  $('#profiles').replaceChildren(...openProfiles.map(item => {
    const button = el('button', `profile-item ${item.id === selectedProfileId ? 'active' : ''}`);
    const copy = el('span', 'profile-copy');
    copy.append(el('span', 'profile-label', item.name), el('span', 'profile-description', '独立浏览会话'));
    button.append(el('span', 'profile-badge', item.name.slice(0, 1)), copy,
      el('span', 'profile-count', String(state.pages.filter(page => page.profileId === item.id).length)));
    button.title = item.name;
    button.dataset.profileId = item.id;
    button.setAttribute('aria-haspopup', 'menu');
    button.oncontextmenu = handle(event => profileContextMenu(event, item));
    button.onclick = handle(async () => {
      selectedProfileId = item.id;
      const page = state.pages.find(page => page.profileId === item.id);
      if (page) await act('select-page', { pageId: page.id }); else await newTab();
    }); return button;
  }));
  $('#tabs').replaceChildren(...state.pages.filter(page => page.profileId === selectedProfileId).map(page => {
    const tab = el('div', `tab ${page.active ? 'active' : ''}`); tab.role = 'tab'; tab.tabIndex = 0;
    tab.dataset.pageId = page.id; tab.setAttribute('aria-haspopup', 'menu');
    tab.oncontextmenu = handle(event => pageContextMenu(event, page));
    tab.setAttribute('aria-selected', String(page.active)); tab.title = page.url;
    tab.append(el('span', 'tab-icon', page.loading ? '◌' : '◇'), el('span', 'tab-title', page.title));
    const close = el('button', 'icon-button close-tab', '×'); close.title = '关闭标签页';
    close.onclick = handle(async event => { event.stopPropagation(); await act('close-page', { pageId: page.id }); });
    tab.append(close); tab.onclick = handle(() => act('select-page', { pageId: page.id }));
    tab.onkeydown = event => { if (event.key === 'Enter') tab.click(); }; return tab;
  }));
  if (document.activeElement !== $('#address')) $('#address').value = active?.url === 'about:blank' ? '' : active?.url ?? '';
  $('#back').disabled = !active?.canGoBack; $('#forward').disabled = !active?.canGoForward;
  $('#reload').disabled = !active; $('#inspect').disabled = !active;
  $('#reload').textContent = active?.loading ? '×' : '↻';
  const showWelcome = !active || active.url === 'about:blank';
  $('#empty-state').hidden = !showWelcome;
  $('#empty-state').style.display = showWelcome ? 'flex' : 'none';
  $('#capture-status').textContent = !active ? '准备记录' : active.capture === 'recording' ? '正在记录' : active.capture === 'reconnecting' ? '记录连接恢复中' : '正在连接记录器';
  $('#capture-dot').style.background = active?.captureError || state.capture.persistenceError ? '#e8a144' : '#31b989';
  $('#record-count').textContent = `${state.capture.records} 条记录`;
  $('#page-status').textContent = active?.error ?? active?.captureError ?? (active?.loading ? '页面加载中…' : '页面就绪');
  $('#page-status').title = $('#page-status').textContent;
  $('#connection-port').textContent = state.connection.cdpEndpoint.replace('http://', '');
  $('#version').textContent = `v${state.version}`;
}
async function openDialog(selector) {
  await act('overlay', { visible: true }); $(selector).showModal();
}
async function closeDialog(selector) { $(selector).close(); await act('overlay', { visible: false }); }
for (const selector of ['#profile-dialog', '#records-dialog', '#console-dialog', '#cookies-dialog']) {
  $(selector).addEventListener('cancel', handle(async event => { event.preventDefault(); await closeDialog(selector); }));
}
$('#new-tab').onclick = handle(newTab); $('#empty-new-tab').onclick = handle(newTab);
$('#add-profile').onclick = handle(async () => {
  render(await act('state'));
  const closedProfiles = state.profiles.filter(profile => profile.closed);
  $('#closed-profiles').hidden = !closedProfiles.length;
  $('#closed-profile-select').replaceChildren(...closedProfiles.map(profile => {
    const option = el('option', '', profile.name); option.value = profile.id; return option;
  }));
  await openDialog('#profile-dialog'); $('#profile-input').focus();
});
$('#reopen-profile').onclick = handle(async () => {
  const profileId = $('#closed-profile-select').value;
  if (!profileId) return;
  await act('create-page', { profileId }); await closeDialog('#profile-dialog');
  toast('环境已重新打开');
});
$('#cancel-profile').onclick = handle(() => closeDialog('#profile-dialog'));
$('#profile-form').onsubmit = handle(async event => {
  event.preventDefault();
  const profile = await act('create-profile', { name: $('#profile-input').value });
  selectedProfileId = profile.id; $('#profile-input').value = '';
  await act('create-page', { profileId: profile.id }); await closeDialog('#profile-dialog'); toast('环境已创建，登录态会独立保存');
});
$('#address-form').onsubmit = handle(async event => {
  event.preventDefault();
  if (!currentPage()) await act('create-page', { profileId: selectedProfileId, url: $('#address').value });
  else await act('navigate', { pageId: currentPage().id, url: $('#address').value });
  $('#address').blur();
});
$('#back').onclick = handle(() => act('back', { pageId: currentPage()?.id }));
$('#forward').onclick = handle(() => act('forward', { pageId: currentPage()?.id }));
$('#reload').onclick = handle(() => act(currentPage()?.loading ? 'stop' : 'reload', { pageId: currentPage()?.id }));
$('#inspect').onclick = handle(() => act('devtools', { pageId: currentPage()?.id }));
$('#copy-connection').onclick = handle(async () => { await act('copy-connection'); toast('连接信息已复制，可提供给调试助手'); });
$('#data-folder').onclick = handle(() => act('data-folder'));
$('#hide-window').onclick = handle(() => act('hide'));
$('#export-records').onclick = handle(async () => {
  const result = await act('export', { pageId: currentPage()?.id }); toast(`已导出 ${result.records} 条记录：${result.filename}`);
});
async function refreshRecords() {
  const records = await act('records', { pageId: currentPage()?.id, kind: $('#record-kind').value, search: $('#record-search').value });
  $('#record-list').replaceChildren(...records.map(record => {
    const button = el('button', `record-item ${record.id === selectedRecordId ? 'selected' : ''}`);
    const isNetwork = record.kind === 'network';
    const text = isNetwork ? `${record.method}  ${shortUrl(record.url)}` : (record.message ?? record.expression ?? record.type ?? '事件');
    const line = el('div', '');
    if (isNetwork) line.append(el('span', `request-status ${record.status >= 400 || record.state === 'failed' ? 'error' : ''}`, record.status ? String(record.status) : '…'));
    line.append(document.createTextNode(text.slice(0, 110))); button.append(line);
    button.append(el('small', '', `${new Date(record.startedAt).toLocaleTimeString()}  ·  ${isNetwork ? `${record.resourceType ?? ''}  ${Math.round(record.durationMs ?? 0)} ms` : record.level ?? record.kind}`));
    button.title = record.url ?? text;
    button.onclick = handle(async () => {
      selectedRecordId = record.id;
      const full = await act('record', { recordId: record.id });
      $('#record-detail').textContent = full ? JSON.stringify(full, null, 2) : '记录已超过保留范围';
      $('#record-list .selected')?.classList.remove('selected'); button.classList.add('selected');
    }); return button;
  }));
  if (!records.length) $('#record-list').append(el('div', 'empty-list', '还没有匹配的记录'));
}
function shortUrl(url) { try { const value = new URL(url); return `${value.host}${value.pathname}${value.search}`; } catch { return url; } }
$('#open-records').onclick = handle(async () => { await openDialog('#records-dialog'); await refreshRecords(); });
$('#close-records').onclick = handle(() => closeDialog('#records-dialog'));
$('#refresh-records').onclick = handle(refreshRecords); $('#record-kind').onchange = handle(refreshRecords);
$('#record-search').oninput = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void refreshRecords().catch(error => toast(error.message)); }, 250); };
$('#open-console').onclick = handle(async () => {
  if (!currentPage()) throw new Error('请先打开页面');
  $('#console-target').textContent = `当前页面：${currentPage().url}`;
  await openDialog('#console-dialog'); $('#code-input').focus();
});
$('#close-console').onclick = handle(() => closeDialog('#console-dialog'));
$('#run-code').onclick = handle(async () => {
  $('#run-code').disabled = true; $('#code-result').textContent = '执行中…';
  try { const result = await act('evaluate', { pageId: currentPage().id, expression: $('#code-input').value }); $('#code-result').textContent = JSON.stringify(result, null, 2); }
  catch (error) { $('#code-result').textContent = error.message; }
  finally { $('#run-code').disabled = false; }
});
setupCookieImport({ act, openDialog, closeDialog, currentPage, getState: () => state, toast });
window.pageDebuggerTheme.setup();
api.onState(render);
void act('state').then(render).catch(error => toast(error.message));
// The counter also updates when capture events do not change navigation state.
setInterval(() => { void act('state').then(render).catch(() => {}); }, 2000);

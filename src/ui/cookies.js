function setupCookieImport({ act, openDialog, closeDialog, currentPage, getState, toast }) {
  const find = selector => document.querySelector(selector);
  let busy = false;
  const dialog = find('#cookies-dialog');
  function report(error) { find('#cookie-result').textContent = error.message; }
  find('#import-cookies').onclick = async () => {
    try {
      const state = getState();
      const profiles = state.profiles.filter(profile => !profile.closed);
      if (!profiles.length) throw new Error('请先打开浏览环境');
      find('#cookie-profile').replaceChildren(...profiles.map(profile => {
        const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; return option;
      }));
      find('#cookie-profile').value = currentPage()?.profileId ?? profiles[0].id;
      find('#cookie-result').textContent = '支持数组和 {"cookies":[...]}，单次最多 2,000 条 / 4 MiB。';
      await openDialog('#cookies-dialog'); find('#cookie-input').focus();
    } catch (error) { toast(error.message); }
  };
  find('#close-cookies').onclick = async () => { if (!busy) await closeDialog('#cookies-dialog'); };
  dialog.addEventListener('cancel', event => { if (busy) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  dialog.addEventListener('close', () => { find('#cookie-input').value = ''; find('#cookie-file').value = ''; find('#cookie-file-name').textContent = ''; });
  find('#choose-cookie-file').onclick = () => find('#cookie-file').click();
  find('#cookie-file').onchange = async () => {
    const file = find('#cookie-file').files[0]; if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Cookie 文件不能超过 4 MiB');
      find('#cookie-input').value = await file.text(); find('#cookie-file-name').textContent = file.name;
      find('#cookie-result').textContent = '文件已读取，点击导入即可写入所选环境。';
    } catch (error) { report(error); }
  };
  find('#run-cookie-import').onclick = async () => {
    if (busy) return;
    busy = true;
    const controls = ['#run-cookie-import', '#close-cookies', '#choose-cookie-file', '#cookie-profile', '#cookie-input', '#cookie-reload'];
    controls.forEach(selector => { find(selector).disabled = true; });
    find('#cookie-result').textContent = '正在导入…';
    try {
      const profileId = find('#cookie-profile').value;
      const result = await act('import-cookies', { profileId, cookies: find('#cookie-input').value });
      const lines = [`共 ${result.total} 条：成功 ${result.imported}，过期跳过 ${result.skipped}，失败 ${result.failed}。`,
        `其中分区 Cookie ${result.partitioned} 条。`, ...result.items.filter(item => item.status !== 'imported').map(item =>
          `第 ${item.index} 条 ${item.name || '(未命名)'}：${item.reason}`)];
      if (result.persistenceError) lines.push(result.persistenceError);
      if (result.imported && find('#cookie-reload').checked) {
        const page = currentPage();
        if (page?.profileId === profileId && /^https?:/.test(page.url)) {
          try { await act('reload', { pageId: page.id }); lines.push('当前页面已刷新。'); }
          catch { lines.push('Cookie 已导入，当前页面刷新失败，请手动刷新。'); }
        }
      }
      find('#cookie-result').textContent = lines.join('\n');
      if (!result.failed) find('#cookie-input').value = '';
    } catch (error) { report(error); }
    finally { busy = false; controls.forEach(selector => { find(selector).disabled = false; }); }
  };
}

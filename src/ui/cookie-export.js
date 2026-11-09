function setupCookieExport({ act, openDialog, closeDialog, currentPage, getState, toast }) {
  const find = selector => document.querySelector(selector);
  const dialog = find('#cookie-export-dialog');
  let busy = false, siteUrl = null, canExport = false;
  function updateScope() {
    const profileId = find('#cookie-export-profile').value;
    const active = currentPage();
    const page = active?.profileId === profileId && /^https?:/.test(active.url) ? active :
      getState().pages.find(item => item.profileId === profileId && /^https?:/.test(item.url));
    siteUrl = page ? new URL(page.url).origin : null;
    const option = find('#cookie-export-scope option[value="site"]');
    option.disabled = !siteUrl; option.textContent = siteUrl ? `当前网站（${new URL(siteUrl).hostname}）` : '当前网站（未打开网页）';
    find('#cookie-export-scope').value = siteUrl ? 'site' : 'all';
  }
  function controls() {
    for (const selector of ['#cookie-export-profile', '#cookie-export-scope', '#refresh-cookie-export', '#close-cookie-export']) find(selector).disabled = busy;
    for (const selector of ['#copy-cookie-export', '#save-cookie-export']) find(selector).disabled = busy || !canExport;
  }
  async function run(destination = 'preview') {
    if (busy) return;
    busy = true; canExport = false; controls();
    find('#cookie-export-json').value = '';
    find('#cookie-export-status').textContent = '正在读取 Cookie…';
    try {
      const result = await act('export-cookies', { profileId: find('#cookie-export-profile').value,
        ...(find('#cookie-export-scope').value === 'site' ? { url: siteUrl } : {}), destination });
      find('#cookie-export-json').value = JSON.stringify(result.cookies, null, 4);
      canExport = true;
      find('#cookie-export-status').textContent = result.filename ? `已保存 ${result.count} 条：${result.filename}` :
        destination === 'clipboard' ? `已复制 ${result.count} 条 Cookie` : `共 ${result.count} 条 Cookie`;
      if (destination === 'clipboard') toast('Cookie JSON 已复制');
      if (result.filename) toast(`Cookie JSON 已保存：${result.filename}`);
    } catch (error) { find('#cookie-export-status').textContent = error.message; }
    finally { busy = false; controls(); }
  }
  find('#export-cookies').onclick = async () => {
    try {
      const profiles = getState().profiles.filter(profile => !profile.closed);
      if (!profiles.length) throw new Error('请先打开浏览环境');
      find('#cookie-export-profile').replaceChildren(...profiles.map(profile => {
        const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; return option;
      }));
      find('#cookie-export-profile').value = currentPage()?.profileId ?? profiles[0].id;
      updateScope(); await openDialog('#cookie-export-dialog'); await run();
    } catch (error) { toast(error.message); }
  };
  find('#cookie-export-profile').onchange = async () => { updateScope(); await run(); };
  find('#cookie-export-scope').onchange = () => run();
  find('#refresh-cookie-export').onclick = () => run();
  find('#copy-cookie-export').onclick = () => run('clipboard');
  find('#save-cookie-export').onclick = () => run('file');
  find('#close-cookie-export').onclick = async () => { if (!busy) await closeDialog('#cookie-export-dialog'); };
  dialog.addEventListener('cancel', event => { if (busy) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  dialog.addEventListener('close', () => { find('#cookie-export-json').value = ''; find('#cookie-export-status').textContent = '准备导出'; canExport = false; controls(); });
}

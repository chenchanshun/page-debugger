const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { _electron } = require('playwright-core');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dataDirectory = path.join(root, '.local', `close-tray-${Date.now()}`);
  const env = { ...process.env, PAGE_DEBUGGER_DATA_DIR: dataDirectory }; delete env.ELECTRON_RUN_AS_NODE;
  const packaged = process.argv.includes('--packaged');
  const electron = await _electron.launch({ executablePath: packaged ? path.join(root, 'dist', 'PageDebugger-win32-x64', 'PageDebugger.exe') : require('electron'),
    args: [...(packaged ? [] : [root]), '--hidden'], env, timeout: 30000 });
  const child = electron.process();
  try {
    let connection;
    for (let i = 0; i < 100; i++) {
      try { connection = JSON.parse(await fs.readFile(path.join(dataDirectory, 'connection.json'), 'utf8')); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(connection, 'Connection descriptor should be ready');
    const request = async (method, route, body) => {
      const response = await fetch(`${connection.apiEndpoint}${route}`, { method,
        headers: { Authorization: `Bearer ${connection.apiToken}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
      const result = await response.json(); assert.ok(result.ok); return result.data;
    };
    const initial = await request('GET', '/v1/status');
    await request('POST', '/v1/window', { action: 'show' });
    // BrowserWindow.close() dispatches the same close event as the native title-bar X.
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    const hidden = await request('GET', '/v1/status');
    assert.equal(hidden.visible, false); assert.equal(hidden.trayAvailable, true);
    assert.equal(hidden.pages[0].targetId, initial.pages[0].targetId);
    assert.equal(hidden.pages[0].capture, 'recording');
    await request('POST', '/v1/window', { action: 'show' });
    assert.equal((await request('GET', '/v1/status')).visible, true);
    const exited = new Promise(resolve => child.once('exit', resolve));
    await request('POST', '/v1/quit', {});
    await Promise.race([exited, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Explicit quit timed out')), 15000); timer.unref(); })]);
    console.log('PASS title-bar close hides to tray; page/CDP survive; restore and explicit quit work.');
  } finally { if (child.exitCode === null) await electron.close().catch(() => child.kill()); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });

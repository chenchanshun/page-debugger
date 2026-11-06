const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
// Development hosts can set this for their own Node workers; the desktop app must run as Electron.
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const args = process.argv.slice(2).filter(arg => arg !== '--packaged');
const executable = packaged ? path.join(root, 'dist', 'PageDebugger-win32-x64', 'PageDebugger.exe') : require('electron');
const child = spawn(executable, [...(packaged ? [] : [root]), ...args], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });

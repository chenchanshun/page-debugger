const path = require('node:path');
async function main() {
  const { packager } = await import('@electron/packager');
  const outputs = await packager({ dir: path.resolve(__dirname, '..'), out: 'dist', name: 'PageDebugger', platform: 'win32', arch: 'x64',
    icon: path.resolve(__dirname, '..', 'src', 'assets', 'app.ico'),
    overwrite: true, asar: true, prune: true, ignore: [/^\/\.local(?:\/|$)/, /^\/dist(?:\/|$)/, /^\/\.git(?:\/|$)/, /^\/test(?:\/|$)/],
    win32metadata: { CompanyName: 'Local tools', FileDescription: 'Page Debugger', ProductName: 'Page Debugger' } });
  console.log(outputs.join('\n'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

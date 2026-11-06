const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}
const files = ['src', 'scripts', 'test'].flatMap(directory => fs.existsSync(directory) ? walk(directory) : []).filter(filename => /\.(cjs|js)$/.test(filename));
for (const filename of files) {
  const result = spawnSync(process.execPath, ['--check', filename], { encoding: 'utf8' });
  if (result.status) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
}
console.log(`Syntax checked ${files.length} JavaScript files.`);

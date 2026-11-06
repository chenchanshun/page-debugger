const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function connect() {
  const directory = process.env.PAGE_DEBUGGER_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'PageDebugger');
  const descriptorPath = process.env.PAGE_DEBUGGER_CONNECTION || path.join(directory, 'connection.json');
  const connection = JSON.parse(await fs.readFile(descriptorPath, 'utf8'));
  async function request(method, route, data) {
    const response = await fetch(`${connection.apiEndpoint}${route}`, { method,
      headers: { Authorization: `Bearer ${connection.apiToken}`, 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result.data;
  }
  return { connection, request };
}
async function main() {
  const [command = 'status', ...args] = process.argv.slice(2); const { request } = await connect();
  let result;
  if (command === 'status') result = await request('GET', '/v1/status');
  else if (command === 'pages') result = await request('GET', '/v1/pages');
  else if (command === 'profiles') result = await request('GET', '/v1/profiles');
  else if (command === 'profile') result = await request('POST', '/v1/profiles', { name: args.join(' ') });
  else if (command === 'import-cookies') {
    if (!args[0] || !args[1]) throw new Error('用法：import-cookies <profileId> <JSON 文件路径>');
    const cookies = await fs.readFile(args[1], 'utf8');
    result = await request('POST', `/v1/profiles/${args[0]}/cookies/import`, { cookies });
  }
  else if (command === 'open') result = await request('POST', '/v1/pages', { url: args[0], ...(args[1] ? { profileId: args[1] } : {}) });
  else if (command === 'navigate') result = await request('POST', `/v1/pages/${args[0]}/navigate`, { url: args[1] });
  else if (command === 'eval') result = await request('POST', `/v1/pages/${args[0]}/evaluate`, { expression: args.slice(1).join(' ') });
  else if (command === 'records') result = await request('GET', `/v1/records?${new URLSearchParams({ ...(args[0] ? { pageId: args[0] } : {}), ...(args[1] ? { search: args[1] } : {}) })}`);
  else if (command === 'record') result = await request('GET', `/v1/records/${args[0]}`);
  else if (command === 'captures') result = await request('GET', '/v1/captures');
  else if (['show', 'hide'].includes(command)) result = await request('POST', '/v1/window', { action: command });
  else if (command === 'quit') result = await request('POST', '/v1/quit', {});
  else throw new Error('命令：status | pages | profiles | profile <名称> | import-cookies <profileId> <JSON文件路径> | open <url> [profileId] | navigate <pageId> <url> | eval <pageId> <代码> | records [pageId] [筛选] | record <id> | captures | show | hide | quit');
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.code === 'ENOENT' ? '客户端未启动，或找不到 connection.json。请先运行 npm start。' : error.message); process.exitCode = 1; });
module.exports = { connect };

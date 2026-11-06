# Page Debugger

独立的本机页面调试客户端。内嵌网页、隔离和保存登录态，通过原生 CDP 连接真实页面，执行页面 JavaScript、操作元素、抓取请求及响应、读取 DOM 和已加载资源。无业务账号系统，无 AI 服务依赖。

## 启动

Windows 可直接运行 `dist/PageDebugger-win32-x64/PageDebugger.exe`。整个目录需要一起保留；复制此目录即可在同架构 Windows 机器使用，不依赖 Node.js。

运行 `npm run shortcut:desktop` 会在当前用户的桌面创建或更新 **Page Debugger** 快捷方式，直接指向上述 exe，不经过终端或开发启动脚本。之后双击桌面图标即可启动；已在后台运行时会恢复同一个窗口。请保留快捷方式指向的整个客户端目录。

从桌面启动后，调试助手读取 `%APPDATA%\PageDebugger\connection.json`，查询当前页面列表并连接 CDP；无需手动复制端口或令牌。每次启动可能分配新端口，必须重新读取连接文件。登录态和工作区仍使用当前用户的同一数据目录。

开发模式需要 Node.js >= 22.12：

```powershell
cd D:\project\page-debugger
npm install
npm start
```

也可以双击根目录 `start.cmd`。`npm run start:background` 隐藏窗口启动，页面和记录器仍然运行。

窗口中的「后台运行」会隐藏到右下角系统托盘，页面和记录器继续工作，此时任务栏窗口图标会消失。点击或双击托盘中的 Page Debugger 蓝色图标恢复窗口；图标也可能在系统托盘的「^」折叠菜单内。右键托盘图标可选择「显示窗口 / 后台运行 / 退出」。最小化窗口仍可通过任务栏恢复。

重新运行 exe 或 `start.cmd` 也会恢复同一个实例，不会创建另一份工作区。命令行恢复方式：

```powershell
npm run client -- show
```

点击主窗口右上角叉号会隐藏到系统托盘，页面、CDP 和记录器继续运行。需要完全退出时使用托盘右键菜单的「退出」，或运行 `npm run client -- quit`；退出时会正常保存工作区。

## 日常使用

1. 左侧「＋」创建浏览环境，例如「淘宝开发账号」。每个环境独立保存 Cookie、localStorage 等网站数据。
2. 同一环境的多个标签页共享登录态。输入地址后手动登录；重启后恢复标签页和持久化网站会话。
3. 网页首次导航前会连接记录器。底部可查看网络、控制台、代码执行和流式消息记录。
4. 「执行代码」在当前页面主框架执行 JavaScript，支持 Promise。iframe 上下文可由 CDP 或 API 明确指定。
5. 「复制连接信息」包含本机 API 地址、CDP 地址、API token、页面及 target 对应关系。将连接文件路径提供给本机调试助手即可，无需在聊天中粘贴凭证。
6. F12 打开原生 DevTools。普通后台调试不依赖 DevTools 窗口。
7. 标签栏右侧「关闭其他」保留当前标签，「关闭全部」清空当前环境的标签页；均不影响其他环境。清空后可直接新建标签，Cookie、登录态和已采集记录继续保留。

客户端的登录态属于自己的环境，不继承 Edge/Chrome 的个人浏览器会话。

## 外观主题

侧边栏底部「外观主题」可切换 **云白 / 石墨 / 松绿**。默认使用浅色云白，选择立即生效，重启后保留；侧边栏、地址栏和弹窗使用统一配色，内嵌网站保持自己的样式。主题选择不重新加载网页，也不改变当前环境或登录态。

## 导入 Cookie

左下角点击「导入 Cookie」，选择目标环境后，粘贴浏览器扩展导出的 JSON 或选择 JSON 文件。支持裸数组 `[{...}]`，也支持 `{"cookies":[...]}`；单次最多 2,000 条 / 4 MiB。

- 兼容 Cookie-Editor 等常见扩展字段：`domain`、`name`、`value`、`path`、`hostOnly`、`httpOnly`、`secure`、`sameSite`、`session`、`expirationDate`、`partitionKey`。
- `expirationDate` 使用 Unix 秒，保留小数；也接受 Playwright 风格的 `expires`。`session:true` 或 `expires:-1` 按会话 Cookie 处理，不强行延长有效期。
- `sameSite:"strict"/"lax"/"no_restriction"` 对应 Strict / Lax / None；`null` 和 `unspecified` 不强制设置 SameSite。`hostOnly:true` 保留仅当前主机的范围。
- 保留 `partitionKey.topLevelSite` 与 `hasCrossSiteAncestor`。分区写入失败会报告，绝不丢弃分区键后写成普通 Cookie。
- `storeId` 等浏览器扩展元数据被忽略。Cookie 值原样保存，不进行 URL 解码、JSON 二次解析或 `$` 展开。
- 导入合并进所选环境，覆盖同域、同路径、同名称、同分区的 Cookie，保留其他 Cookie。已过期条目跳过，不用于删除现有 Cookie。非法条目和浏览器拒绝的条目单独报告。
- 可选择导入后刷新当前页面；仅当当前页面属于所选环境且为 HTTP/HTTPS 时刷新。API 和 CLI 导入不会自动导航或刷新。
- 持久化 Cookie 写入后立即请求 Chromium 落盘；会话 Cookie 仍遵守浏览器会话生命周期。导入结果不包含 Cookie value；原始 JSON 不写入捕获记录。

CLI 也可导入，路径可以带空格：

```powershell
npm run client -- import-cookies <profileId> "D:\private\cookies.json"
```

## 连接发现

运行中的连接描述文件：

```text
%APPDATA%\PageDebugger\connection.json
```

开发启动还会写入 `.local/connection.json`。应优先读取当前用户数据目录中的文件；正常退出会删除该目录中的连接文件。

描述包含 `apiEndpoint`、`cdpEndpoint`、`apiToken`、`pid`、`dataDirectory`。CDP 与本地 API 自动分配端口，仅监听回环地址。**CDP 本身具有完整浏览器调试权限，不能转发到外网。** API 使用 Bearer token，不接受网页 Origin、跨域调用或其他 Host。

可通过环境变量指定独立实例目录或端口：

| 变量 | 用途 |
| --- | --- |
| `PAGE_DEBUGGER_DATA_DIR` | 用户数据目录、环境、捕获记录及 connection.json 的位置 |
| `PAGE_DEBUGGER_CDP_PORT` | 固定 CDP 端口；默认自动分配 |
| `PAGE_DEBUGGER_API_PORT` | 固定 API 端口；默认自动分配 |
| `PAGE_DEBUGGER_CONNECTION` | CLI 使用的连接描述文件路径 |

同一数据目录只运行一个实例。不同目录的实例彼此独立。

## CLI

```powershell
npm run status
npm run client -- profiles
npm run client -- profile "测试环境"
npm run client -- open "https://work.open.taobao.com/" <profileId>
npm run client -- pages
npm run client -- eval <pageId> "document.title"
npm run client -- records <pageId> "agent/list"
npm run client -- record <recordId>
npm run client -- captures
npm run client -- hide
npm run client -- show
```

CLI `eval` 代码作为普通命令行参数传入。复杂代码建议通过 Node.js API client 调用，避免 PowerShell 引号和变量展开。

## 原生 CDP / Playwright

客户端仅提供网页宿主；自动化助手可以使用标准 CDP WebSocket，也可以使用 Playwright `connectOverCDP`。

```js
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');

const connection = JSON.parse(await fs.readFile(
  path.join(process.env.APPDATA, 'PageDebugger', 'connection.json'), 'utf8'
));
const response = await fetch(`${connection.apiEndpoint}/v1/pages`, {
  headers: { Authorization: `Bearer ${connection.apiToken}` }
});
const { data: pages } = await response.json();
const selected = pages.find(page => page.id === wantedPageId);
const browser = await chromium.connectOverCDP(connection.cdpEndpoint);
let target;
for (const context of browser.contexts()) {
  for (const page of context.pages()) {
    const session = await context.newCDPSession(page);
    try {
      const { targetInfo } = await session.send('Target.getTargetInfo');
      if (targetInfo.targetId === selected.targetId) target = page;
    } finally { await session.detach(); }
  }
}
if (!target) throw new Error('页面已关闭或 target 已改变，请刷新页面列表');
await target.getByRole('button', { name: '搜索', exact: true }).click();
// 对 connectOverCDP 得到的连接执行 close 会断开本次自动化连接。
await browser.close();
```

不要只按 URL 匹配账号：多个环境可能打开同一网址。`pageId` 在工作区恢复时保留，`targetId` 在重启或目标重建后需要重新查询。尽量复用现有标签，页面生命周期和导航由本地 API 管理。

CDP 的 `/json/list` 也包含客户端自身的本地 UI 页面。只操作 `/v1/pages` 返回的网页 targets；UI 页面不注入到第三方网页。

## 本地接口

除 `/health` 外均需要 `Authorization: Bearer <apiToken>`。JSON 结果采用 `{ok:true,data:...}`；失败采用对应 HTTP 状态及 `{ok:false,error:...}`。

| 方法及路径 | 功能 / 请求体 |
| --- | --- |
| `GET /health` | 进程存活检查 |
| `GET /v1/status` | 环境、页面、连接地址、记录状态 |
| `GET /v1/profiles` | 环境列表 |
| `POST /v1/profiles` | `{name}` 创建环境 |
| `POST /v1/profiles/:id/cookies/import` | `{cookies:<数组、包含 cookies 的对象或 JSON 字符串>}`，返回逐项结果和成功/过期/失败计数 |
| `GET /v1/pages` | 页面及当前 target 映射 |
| `POST /v1/pages` | `{profileId?,url?,activate?}` 创建标签，不显示或聚焦桌面窗口 |
| `GET /v1/pages/:id` | 页面状态 |
| `DELETE /v1/pages/:id` | 关闭标签 |
| `POST /v1/pages/:id/navigate` | `{url}` 导航；返回接受状态，加载状态通过页面查询或 CDP 等待 |
| `POST /v1/pages/:id/select` | 选择标签，不聚焦桌面窗口 |
| `POST /v1/pages/:id/reload` | 刷新；另支持 `back`、`forward`、`stop` |
| `POST /v1/pages/:id/evaluate` | `{expression,contextId?,sessionId?}`，返回 CDP result / exceptionDetails |
| `POST /v1/pages/:id/cdp` | `{method,params?,sessionId?}` 页面 CDP 命令 |
| `GET /v1/pages/:id/screenshot` | PNG 的 base64 `data`，使用 Electron 隐藏页面截图路径 |
| `GET /v1/pages/:id/resources` | 框架 / 已加载资源树 |
| `GET /v1/records` | 查询本轮记录；支持 `pageId`、`kind`、`search`、`after`、`limit`、`includeBodies=true` |
| `GET /v1/records/:id` | 一条记录及已保存的完整正文 |
| `GET /v1/captures` | 历史运行列表 |
| `GET /v1/captures/:runId/records` | 历史运行记录，支持 `pageId`、`kind` |
| `POST /v1/window` | `{action:"show"或"hide"}`；show 使用 showInactive |
| `GET /v1/window/screenshot` | 本地 UI 截图，原生子视图需通过各页面截图接口单独获取 |
| `POST /v1/quit` | 保存并退出 |

记录类型为 `network`、`console`、`evaluation`、`event`。普通请求保存 method、URL、headers、postData、status、timing、响应正文及重定向关系。捕获失败、容量超限或连接中断会明确标注，不将缺失正文表示为空正文。

用 `Page.getResourceContent` 读取资源树中的 JS/CSS；用 DOM 或 Runtime 域读取当前页面结构。只有网站提供 source map 时才可能映射到原始工程源码。

## 记录与运行边界

- 当前运行最多保留 2,000 条记录、约 64 MiB JSON 数据，先到上限先淘汰最早记录，磁盘文件同步清理。
- 每个响应体最多保留约 1 MiB；编码后明显过大的响应直接标记未采集。请求正文上限 64 KiB；上传文件的二进制内容不采集。
- WebSocket 帧和 EventSource 消息保存为事件，每条最多 64 KiB。任意 `fetch` 流的逐 chunk 分析暂未实现。
- 记录器对相关子 target 尝试自动附加；复杂跨进程 iframe / worker 场景应检查实际捕获结果，不能假设所有浏览器活动都已采集。
- 记录约每 350 ms 批量落盘，正常退出等待写入。进程被强制结束时最近尚未落盘的记录可能丢失。持久化错误在状态接口中提供。
- 历史运行保留在 `captures/<runId>/`，当前版本不会自动清理旧运行。导出 JSON 以及本地捕获文件可能包含网站凭证和业务正文，请按调试资料管理。
- 页面脚本在页面或所选 iframe 上下文执行，远程页面保持 Node 隔离与 sandbox，不拥有客户端 preload API。
- 未配置代理、证书绕过、反检测、密码管理器或浏览器扩展。网站原生权限请求默认拒绝。
- 新窗口链接打开为同环境标签。依赖 `window.opener` 回传的 OAuth 弹窗流程暂未适配。
- 后台点击、输入和记录无需显示窗口；原生文件选择、系统认证等操作仍需人工处理。隐藏 / 非当前标签的截图由浏览器绘制状态决定，必要时先选择标签再截图，不会主动聚焦桌面窗口。

## 验证与打包

```powershell
npm run check
npm test
npm run test:integration
npm run package:win
npm run test:package
npm run shortcut:desktop
```

集成测试启动独立临时用户目录及本机测试站点，通过真实 CDP 操作内嵌页面，检查请求及正文、首次导航采集、控制台、会话隔离、后台执行、资源源码、UI、断开重连、重启恢复和历史记录。截图和结果保存到 `.local/integration-*/`。

## 提交与推送约定

远程仓库为 [chenchanshun/page-debugger](https://github.com/chenchanshun/page-debugger)，Git remote 使用 `origin`，默认分支为 `main`。

后续每次完成改动并通过适用检查后，自动提交并推送到该仓库的对应分支，无需再次确认。提交说明应描述实际改动，推送后核对远程提交；如果推送失败，应保留本地提交并报告原因。用户登录数据、`connection.json`、捕获文件、`node_modules/`、`dist/` 和 `.local/` 不纳入提交。

## 目录

```text
src/main.cjs             启动、窗口、连接发现、受限 UI IPC
src/pages.cjs            页面、会话与生命周期
src/cdp.cjs              CDP WebSocket transport
src/recorder.cjs         网络 / 控制台采集
src/capture-store.cjs    有界记录和本地持久化
src/workspace.cjs        环境与标签持久化
src/cookie-format.cjs    Cookie 格式归一与属性校验
src/cookie-importer.cjs  环境内 Cookie 写入和逐项结果
src/api.cjs              本地控制接口
src/ui/                 桌面界面
scripts/client.cjs       本机 CLI / Node API helper
scripts/integration.cjs  真实 Electron 集成验收
```

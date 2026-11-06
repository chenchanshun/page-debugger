# 项目协作约定

- 本项目是独立 Electron 调试客户端；第三方网页使用 `WebContentsView`，不引入业务客户端的账号、托管或发布模块。
- 操作此客户端通过它自身的本地接口、原生 CDP 或 Playwright。不要使用 Browser Use、Computer Use、cua_repl 或桌面坐标自动化。
- 日常使用优先连接已运行的客户端；需要启动时使用系统桌面目录中的 `Page Debugger.lnk`，或 `dist/PageDebugger-win32-x64/PageDebugger.exe`，不依赖开发模式 `npm start`。快捷方式可通过 `npm run shortcut:desktop` 重建。
- 先读取 `%APPDATA%/PageDebugger/connection.json`（或用户指定的 `PAGE_DEBUGGER_DATA_DIR`）；不要猜端口。不要在日志或聊天中输出 API token、网站 Cookie 或 Authorization。
- 网页身份以 `/v1/pages` 的 `pageId/profileId/targetId` 对应关系为准。重启后重新查询 targetId；不要只按标题或 URL 选择账号。
- 导航和标签生命周期通过本地 API 管理。常规操作不调用窗口 focus/show/bringToFront；用户明确要求显示时使用 showInactive。
- 页面代码在页面 JavaScript 上下文执行。保持远程内容的 sandbox、contextIsolation 和 Node 隔离；不向第三方页面注入宿主控制 API。
- 采集器必须在目标网址首次导航前就绪。正文缺失、超限、截断和记录中断须明确表达。
- Cookie 导入复用 cookie-format / cookie-importer。保留 hostOnly、SameSite、session、expires 和 partitionKey，不把分区 Cookie 降级为普通 Cookie；过期条目跳过，不能借此删除已有 Cookie。不得在导入结果或捕获日志中保存原始 value。
- 修改后运行 `npm run check`；逻辑变动运行相关 `node --test`；影响宿主/CDP/会话时运行 `npm run test:integration`。成品通过 `npm run package:win` 打包。
- 本项目远程仓库固定为 `https://github.com/chenchanshun/page-debugger.git`（`origin`）。后续每次完成改动并通过适用检查后，自动创建描述本次改动的 Git 提交并推送到该仓库的对应分支，无需再次询问；默认分支为 `main`。推送后核对远程提交；若失败，保留本地提交并明确报告原因，不将本地提交视为已推送。
- 不改动其他仓库，不提交用户登录数据、connection.json、捕获文件、node_modules 或 dist。

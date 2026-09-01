# 空间记忆教练：集成交接

> 更新：2026-09-01；分支：`codex/user-test-mvp`；功能提交：`ffd3d6032ca43966ad74b0d8499e9a120bbf9a6b`

## 完成状态

- 完整离线应用已接通：三个本地内容包（坏包隔离）、首页选包、可跳过摸底、认识新地点、五类题面、智能/自定义练习、探索定向练习、总结、未完成会话恢复。
- 首错提示、二错揭示、3–5 题后重测、15 题上限、跨会话重测债务、易忘历史恢复均进入真实应用数据流。
- 保存门禁已覆盖继续、离开、会话创建、备份刷新和更新安装；失败可重试，恢复总结包含重启前尝试。
- 备份导出、检查、merge、replace 已接线；导入后刷新失败会锁住返回并提供独立重试，不会误报导入失败。
- 启动更新检查非阻塞；仅首页/总结允许显式下载与安装，离线错误不影响学习。浏览器使用内存 adapters，Tauri 使用真实内容、SQLite、备份与更新 adapters。
- 制图工作台 token、简体中文、窄屏布局、本地 favicon 已完成；无远程字体、图片或地图依赖。
- 独立 Reviewer 已从产品闭环、可访问性、持久化门禁和更新接线审查；报告问题均已修复并加入回归测试。

## 证据

- Vitest + V8 coverage：34 个测试文件、403 项通过；Statements 80.98%，Branches 75.38%，Functions 85.39%，Lines 84.34%。
- `pnpm lint`、`pnpm typecheck`、`pnpm build`：通过；生产构建 300 modules。
- Playwright：3 项通过；覆盖 800×600、1280×800、无外部请求、备份导出与练习保存闭环。
- `pnpm content:validate -- --all`：中国省级行政区、上海行政区、美国州与州府三包通过。
- 发布预检：`Release preflight passed.`；`git diff HEAD --check` 通过。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`：通过。

## 剩余发布门禁

- 本机缺少 MSVC `link.exe`：需在 Windows CI 或安装 Build Tools 后完成 Rust clippy/test、真实 NSIS 构建和 updater 签名验签。
- 需执行远程 release workflow，并在干净 Windows 环境验证安装、升级、离线、下载中断、错误签名、WebView2 处理和数据库保留。
- 三个内容包仍标记 `development-only`；公开发布前需具名人工完成实际地图渲染、法定边界与合规审批。
- 需在真实 Tauri 窗口完成键盘、屏幕阅读器、高 DPI 与 1024×700 最小尺寸验收。

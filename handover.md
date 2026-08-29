# 空间记忆教练：当前交接

> 更新：2026-08-29；分支：`codex/user-test-mvp`；目标：完成可安装、可从 GitHub Releases 签名更新的 Windows x64 用户测试版。

## 阅读规则

先读本页，再只读当前任务对应专题。不要一次加载完整规格与全部 handover。

- 路线图与冻结接口：`docs/superpowers/plans/2026-08-27-development-roadmap.md`
- 完整规格（仅冲突时查）：`docs/superpowers/specs/2026-08-27-spatial-memory-coach-design.md`
- 决策优先级：用户最新指令 → `handover/decisions.md` → 对应专题 → 完整规格
- 专题：产品/UI=`product.md`+`ux-motion.md`；内容/地图=`content-map.md`；学习=`learning-engine.md`；工程=`architecture.md`+`engineering.md`

## 产品与发布边界

离线空间记忆教练：通过地图主动回忆、即时纠错和“地点 × 能力”调度，学习中国 34 个省级行政区、上海 16 区、美国 50 州。

- Tauri 2 + React + TypeScript strict + SQLite + 本地 SVG/TopoJSON
- 简体中文 UI；认识/揭示双语；输入接受内容包声明的中英文别名
- 核心离线；无账号、云同步、在线瓦片和第三方导入
- v1 必须有 Windows x64 安装包；WebView2 缺失时安装器自动处理
- v1 必须从本仓库 GitHub Releases 检查并安装签名更新；私钥仅进 GitHub Secrets
- 中国/上海内容公开分发前仍需具名人工完成实际渲染与法定审核；不阻塞本地用户测试

## 当前状态

路线图 Tasks 1–10、12、14 已实现并通过独立复审；Tasks 11、13、15、16 待完成。

“任务 0”是共享底座集成门禁，不是路线图编号，现已完成：

| 底座 | 状态 | 集成提交 |
|---|---|---|
| Tasks 1–8：契约、加载、学习、调度、SQLite、备份 | 完成 | 截止 `42ff299` |
| Task 9：离线 SVG 地图与无障碍交互 | 完成/APPROVED | `cdda216`, `b39dd90` |
| Task 10：练习答题生命周期与计时 | 完成/APPROVED | `ce3c5da`, `3094a30` |
| Task 12：暂停/选项/错误壳层与原创音效 | 完成/APPROVED | `26c5771`…`2da7af0` |
| Task 14：可重复内容管线与发布校验 | 完成/APPROVED | `08704cf`…`2d780bf`, `4fceb47` |

任务 0 最终证据（集成分支）：

- Vitest：24 个测试文件、290 个测试通过
- `pnpm typecheck`、`pnpm lint`、`pnpm build` 通过
- `pnpm content:validate -- --fixture` 通过；重复生成哈希一致
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` 退出成功
- 独立复审已关闭地图选择/拖拽、练习计时、保存竞态/StrictMode、音频生命周期、共享边界、事务发布和 TopoJSON 契约问题

## 后续任务与依赖

任务 0 已是后续 viewport 审核的绿色基线，不需要在 Tasks 11–16 中重复实现。

| 下一任务 | 依赖 | 独立修改范围 |
|---|---|---|
| Task 11：五类题面与统一控件 | Tasks 9、10 | 新增练习 UI/题型视图；不改地图/调度核心 |
| Task 13：首页、自定义练习、探索、总结 | Tasks 10、12 | 产品页面与导航接线；不改内容管线 |
| Task 15：三套真实启动内容包 | Task 14 | 内容源、生成物与审核记录；不改 UI/学习算法 |
| Task 16：E2E、NSIS/WebView2、GitHub 更新 | Tasks 11、13、15 | 发布配置、CI、签名更新、安装验证 |

可并行：Task 11、Task 13、Task 15。Task 16 等前三项合入后开始。每项使用独立 worktree/提交，禁止跨任务顺手改文件；集成分支只 cherry-pick 已复审提交。

## 环境与已知阻塞

- Node `24.18.0`、pnpm `11.19.0`；Rust/Cargo `1.98.0` stable MSVC
- 本机缺 Microsoft C++ linker（`link.exe`）；因此 Rust 可执行测试、Tauri 本地打包和安装包实测需由 Windows CI 或安装 Build Tools 后完成
- 不要再次触发管理员安装，除非用户明确授权
- 当前 UI 仍是底座组件，完整可操作产品流由 Tasks 11、13 接线；真实三包与安装/更新由 Tasks 15、16 完成

## 完成定义

只有以下全部满足才可称“第一版可上线”：完整用户流与三包可用、前端/Rust/E2E 全绿、Windows 安装器能处理 WebView2、GitHub test release 可签名更新、干净 Windows 安装/升级/回滚实测通过、handover 与发布证据同步。

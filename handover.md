# 空间记忆教练：当前交接

> 更新：2026-08-27；分支：`codex/user-test-mvp`；阶段：Tasks 1–5 已完成并通过独立审查，下一步 Task 6。

## 先读规则

后续任务先读本页，再只读任务矩阵指定的一个或两个专题文件和对应 task brief。不要默认加载完整设计规格、完整实施计划或所有专题；只有发现冲突时才追溯：

- 完整规格：`docs/superpowers/specs/2026-08-27-spatial-memory-coach-design.md`
- 16 任务计划与冻结接口：`docs/superpowers/plans/2026-08-27-development-roadmap.md`
- 冲突优先级：用户最新指令 → `handover/decisions.md` → 对应专题 → 完整规格。
- 当前任务 brief：`.superpowers/sdd/2026-08-27-development-roadmap/task-<N>-brief.md`；该目录被 Git 忽略，只用于本地协作。

## 产品一句话

面向 Windows/macOS 的离线空间记忆教练，用地图主动回忆、即时纠错和“地点 × 能力”调度学习中国 34 个省级行政区、上海 16 区和美国 50 州。

## 当前进度

| 范围 | 状态 | 提交/证据 |
|---|---|---|
| 规格与 16 任务路线图 | 已批准；跨任务类型已冻结 | `34ca6a0` |
| Task 1：Tauri/React 基础 | 已实现并通过独立 review + fix re-review | `220d988`, `b08e756`, `1bde2b9` |
| Task 2：内容契约 | 已实现；fix round 1 关闭 2 条 Important，scoped re-review 通过；全套 12 测试、strict typecheck、lint、build 通过 | `6ae2d48`, `811a063` |
| Task 3：离线内容加载与迁移 | 已实现；fix round 1 关闭 4 条 Important，scoped re-review 通过；全套 27 测试、strict typecheck、lint、build、rustfmt 通过 | `bf409ed`, `d58cb68` |
| Task 4：掌握阶段与易忘 | 已实现；fix round 1 关闭 5 条 Important，scoped re-review 通过；全套 69 测试、strict typecheck、lint、build 通过 | `d05ac88`, `b2cf36f` |
| Task 5：答案、提示与题目 | 已实现；fix round 1 关闭 4 条 Important，scoped re-review 通过；全套 131 测试、strict typecheck、lint、build 通过 | `6a22605`, `c425c73` |
| Tasks 6–16 | 未开始 | 下一步 Task 6，按依赖顺序执行 |

开发使用 `subagent-driven-development`：每任务一个实现 agent、独立 reviewer、最多五轮修复，并在 `.superpowers/sdd/2026-08-27-development-roadmap/progress.md` 记录状态。

Task 2 完成工件：

- brief：`.superpowers/sdd/2026-08-27-development-roadmap/task-2-brief.md`
- report：`.superpowers/sdd/2026-08-27-development-roadmap/task-2-report.md`
- review 修复：`src/content/types.ts`/`schema.ts` 已加入 TopoJSON 点坐标摘要；`src/content/validatePack.ts` 已拒绝非 region 和 self `parentId`。

Task 3 完成工件：

- brief：`.superpowers/sdd/2026-08-27-development-roadmap/task-3-brief.md`
- report：`.superpowers/sdd/2026-08-27-development-roadmap/task-3-report.md`
- 已落地整包隔离加载、来源目录/manifest ID 绑定、TopoJSON 严格校验与 Point transform、保守 mastery 迁移；Rust 测试仍受下述 MSVC 环境阻塞。

Task 4 完成工件：

- brief：`.superpowers/sdd/2026-08-27-development-roadmap/task-4-brief.md`
- report：`.superpowers/sdd/2026-08-27-development-roadmap/task-4-report.md`
- 已冻结掌握阶段/间隔、正确后 EMA、合法 placement 初始化，以及沿完整事件时间线锁存并显式清除的 fragile 状态机。

Task 5 完成工件：

- brief：`.superpowers/sdd/2026-08-27-development-roadmap/task-5-brief.md`
- report：`.superpowers/sdd/2026-08-27-development-roadmap/task-5-report.md`
- 已落地声明式双语精确判题、八方向/文字/选择弱提示、冻结 Question 联合、实体坐标权威、确定性四选一与能力/关系拒绝路径。

## 已安装依赖与环境阻塞

- Node `24.18.0`、pnpm `11.19.0`。
- Rust/Cargo `1.98.0` stable MSVC 已安装在 `C:\Users\Kevin\.cargo\bin`；新终端 PATH 可能需要刷新。
- Microsoft C++ Build Tools 未安装：两次管理员 UAC 均被用户取消。因此 `cargo clippy`、`pnpm tauri dev` 和 Windows 安装包暂不能在本机完成；前端开发与测试不受影响。
- Task 5 最终证据：完整 Vitest 9 文件/131 测试、`pnpm typecheck`、`pnpm lint`、`pnpm build`；详见上述 report。
- 当前可运行但不代表已通过的命令：`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run`、`pnpm build`、`cargo fmt ... --check`。
- 已知非阻塞项：`index.html` 引用缺失的 `/vite.svg`，会产生 favicon 404，留给最终审查或 UI 任务修复。

## 下一步

1. Task 6：调度与摸底。
2. Task 7：repository 与 SQLite 事务；Task 8：备份合并/替换。
3. Tasks 9–13：地图、练习 UI、首页/探索/总结，形成浏览器可完整试用闭环。
4. Tasks 14–16：内容管线、三包数据、E2E 与个人安装包；原生安装包仍取决于 MSVC 授权。

## 不可回退的硬约束

- 技术栈：Tauri 2 + React + TypeScript strict + SQLite + 本地 SVG/TopoJSON。
- 核心完全离线；无账号、云同步、在线瓦片、第三方内容导入或公开发行承诺。
- 简体中文 UI；认识/揭示双语；包级主要答案语言；输入接受声明的中英文别名。
- 中国/上海内容必须保留来源与处理链；公开分发前仍需人工合规与法定审核判断。

## 任务阅读矩阵

| 任务 | 必读专题 |
|---|---|
| 产品/UI 流程 | `handover/product.md`, `handover/ux-motion.md` |
| 内容/schema/地图数据 | `handover/content-map.md` |
| 学习、调度、判题 | `handover/learning-engine.md` |
| React/Tauri/SQLite/备份 | `handover/architecture.md`, `handover/engineering.md` |
| 变更既定决定 | `handover/decisions.md` + 对应专题 |

# 空间记忆教练：当前交接

> 更新：2026-08-27；分支：`codex/user-test-mvp`；阶段：Task 1 完成，Task 2 代码已实现但任务未完成，尚待修复审查问题。

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
| Task 2：内容契约 | 代码已实现但任务未完成；8 个测试、strict typecheck、lint、build 通过；review 发现 2 条 Important，等待 fix round 1 与 scoped re-review | `6ae2d48` |
| Tasks 3–16 | 未开始 | 必须按依赖顺序执行 |

开发使用 `subagent-driven-development`：每任务一个实现 agent、独立 reviewer、最多五轮修复，并在 `.superpowers/sdd/2026-08-27-development-roadmap/progress.md` 记录状态。

Task 2 当前工件：

- brief：`.superpowers/sdd/2026-08-27-development-roadmap/task-2-brief.md`
- report：`.superpowers/sdd/2026-08-27-development-roadmap/task-2-report.md`
- review 问题：`src/content/types.ts`/`schema.ts` 缺 TopoJSON 点坐标摘要；`src/content/validatePack.ts` 未拒绝非 region 或 self `parentId`。

## 已安装依赖与环境阻塞

- Node `24.18.0`、pnpm `11.19.0`。
- Rust/Cargo `1.98.0` stable MSVC 已安装在 `C:\Users\Kevin\.cargo\bin`；新终端 PATH 可能需要刷新。
- Microsoft C++ Build Tools 未安装：两次管理员 UAC 均被用户取消。因此 `cargo clippy`、`pnpm tauri dev` 和 Windows 安装包暂不能在本机完成；前端开发与测试不受影响。
- Task 2 已通过证据：完整 Vitest 2 文件/8 测试、`pnpm typecheck`、`pnpm lint`、`pnpm build`；修复后必须重新运行并追加到上述 report。
- 当前可运行但不代表已通过的命令：`pnpm lint`、`pnpm typecheck`、`pnpm test -- --run`、`pnpm build`、`cargo fmt ... --check`。
- 已知非阻塞项：`index.html` 引用缺失的 `/vite.svg`，会产生 favicon 404，留给最终审查或 UI 任务修复。

## 下一步

1. Task 2 fix round 1：类型化 TopoJSON 点坐标摘要；拒绝非 region/self `parentId`；复审关闭后才完成。
2. Task 3：资源加载、无效包隔离、内容迁移、窄 Tauri 资源命令。
3. Task 4：掌握阶段与易忘；Task 5：答案/提示/题目；Task 6：调度与摸底。
4. Task 7：repository 与 SQLite 事务；Task 8：备份合并/替换。
5. Tasks 9–13：地图、练习 UI、首页/探索/总结，形成浏览器可完整试用闭环。
6. Tasks 14–16：内容管线、三包数据、E2E 与个人安装包；原生安装包仍取决于 MSVC 授权。

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

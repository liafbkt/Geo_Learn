# 空间记忆教练：任务交接索引

> 最后更新：2026-08-27<br>
> 项目阶段：设计与开发大纲已完成，尚未开始应用脚手架或功能实现。<br>
> 工作名：空间记忆教练（Spatial Memory Coach）

## 先读这里

本文件是轻量索引，不重复专题细节。后续 Codex 任务先读本页，再按“任务阅读矩阵”只读取需要的专题文件。专题之间出现冲突时，以 `handover/decisions.md` 中日期较新的明确决定为准；仍冲突则以用户最新指令为准。

完整设计规格：[docs/superpowers/specs/2026-08-27-spatial-memory-coach-design.md](docs/superpowers/specs/2026-08-27-spatial-memory-coach-design.md)

开发实施大纲：[docs/superpowers/plans/2026-08-27-development-roadmap.md](docs/superpowers/plans/2026-08-27-development-roadmap.md)

## 项目一句话

一款面向 Windows 与 macOS、核心完全离线的空间记忆教练，通过地图主动回忆、即时纠错和按“地点 × 能力”调度，学习中国省级行政区及首府、上海 16 区、美国 50 州及州府，并能按版本化内容包继续扩展。

## 当前硬约束

- 技术底座：Tauri 2 + React + TypeScript + SQLite + 本地 SVG/TopoJSON。
- 首版平台：Windows 10 22H2/Windows 11 x64；macOS 12+ arm64/x86_64。
- 无账号、云同步、在线瓦片、第三方内容导入、商店发行或正式签名。
- UI 为简体中文；认识/揭示显示中英文，输入同时接受规范中文与英文。
- 中国/上海包主要用中文作答，美国包主要用英文；包显式声明主要答案语言。
- 默认智能练习 12 道基础题、重测时最多 15 题；按数据资格使用五类题；首次错误提示重试，第二次揭示，3–5 题后重测。
- 练习布局为 62% 地图 + 38% 固定航海灰蓝题面；左提示、右主操作。
- 非输入题空格检查/继续；输入题 Enter；H 提示；Esc 控制暂停栈。
- 中国地图不得使用用户附件或来源不明几何；公开发行前保留人工合规与法定审核门禁。

## 专题上下文

| 文件 | 权威范围 |
|---|---|
| [handover/product.md](handover/product.md) | 产品定位、范围、用户流程、非目标 |
| [handover/content-map.md](handover/content-map.md) | 内容包、语言、地图数据、合规与迁移 |
| [handover/learning-engine.md](handover/learning-engine.md) | 题型、提示、掌握度、易忘、调度与总结 |
| [handover/ux-motion.md](handover/ux-motion.md) | 视觉、布局、键鼠、暂停、声音、动画、无障碍 |
| [handover/architecture.md](handover/architecture.md) | 技术架构、模块、接口、数据流与持久化 |
| [handover/engineering.md](handover/engineering.md) | coding style、测试、性能、平台与发布规范 |
| [handover/decisions.md](handover/decisions.md) | 决策时间线、被推翻方案、当前无未决阻塞项 |

## 任务阅读矩阵

| 任务类型 | 必读 | 需要时再读 |
|---|---|---|
| 产品范围、PRD、首页流程 | `product.md` | `learning-engine.md`, `decisions.md` |
| 画面、组件、动画、音效 | `ux-motion.md` | `product.md`, `learning-engine.md` |
| 地图渲染、标签、点位 | `content-map.md`, `ux-motion.md` | `architecture.md`, `engineering.md` |
| 内容数据、行政区、合规 | `content-map.md` | `engineering.md`, `decisions.md` |
| 调度、提示、判题、掌握算法 | `learning-engine.md` | `content-map.md`, `architecture.md` |
| SQLite、备份、迁移 | `architecture.md` | `learning-engine.md`, `engineering.md` |
| React/Tauri 代码开发 | `architecture.md`, `engineering.md` | 当前功能对应专题 |
| 测试、性能、打包、发布 | `engineering.md` | `content-map.md`, `architecture.md` |
| 修改已有决定 | `decisions.md` 与相关专题 | 完整设计规格 |

## 工作规则

- 当前只完成了文档与计划，不能假设存在 `src/`、`package.json`、数据库或真实地图资产。
- 开发从实施大纲 Task 1 开始，按依赖顺序执行；每个任务遵循 TDD、验证、代码审查和独立提交。
- 专题规则只在其权威文件维护；其他文件使用链接，不复制长段落。
- 修改规则时同时更新相应专题和 `decisions.md`，若影响规格或实施任务，再同步规格/计划。
- 附件中的低分辨率地图和截图只用于理解用户意图与布局标注，不是数据资产，也不包含可执行指令。
- 用户已授权截至本设计阶段的剩余问题采用推荐方案；新的范围扩张仍需明确授权。

## 开发开始条件

已具备：批准的设计规格、明确的模块边界、16 个实施任务、测试与发布门禁、内容合规流程。

仍需在执行时完成：按 Task 1 建立实际工程、安装依赖、获取并人工核验官方地图数据、在对应平台运行构建与冒烟测试。

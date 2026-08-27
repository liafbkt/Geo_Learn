# 架构摘要

> 文件级接口与任务依赖以实施计划为准；禁止另建平行目录或状态体系。

## 技术与边界

Tauri 2 + React/TypeScript strict + Vite + SQLite + 本地 TopoJSON/SVG。TypeScript 负责内容、学习、会话和视图；Rust 只负责 SQLite 事务、资源读取、原生文件对话框和备份容器。

模块：`app`、`content`、`learning`、`practice`、`map`、`explore`、`persistence`、`audio`、`src-tauri`。地图只发 selection/viewport 事件，不知道正确答案；React 不拼 SQL；Rust command 不包含学习规则。

生产与测试通过 `ContentSource`、`ProgressRepository`、`RandomSource` 注入 Tauri/内存适配器和真实/固定随机源。

## 保存数据流

内容校验 → mastery 快照 → 不可变会话 → reducer 立即反馈并进入 `saving` → repository 单事务写 attempt、mastery、session cursor → 成功后才可继续/离开。事务前崩溃时恢复同一题。

SQLite 至少包含 `learner`、`mastery`、`attempt_event`、`practice_session`、`app_setting`、`content_migration`、`schema_migration`；外键开启、时间 UTC ISO-8601、attempt ID 去重、迁移只向前。

## 备份与错误边界

`.geolearn-backup` 是版本化 ZIP。Rust 自行打开对话框，不接受前端任意路径；导入先只读检查并返回 staging ID。merge 默认按更新时间/独立正确数合并并去重事件；replace 在警告后替换学习数据、会话和设置。校验或事务失败不得污染当前数据库。

单包错误隔离；迁移错误禁止练习并保留副本；保存错误保留反馈；音频错误静默；UI 错误页可重启和导出诊断且不泄露个人路径。

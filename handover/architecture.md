# 技术架构上下文

> 权威范围：技术选型、模块边界、领域接口、数据流、SQLite、备份和错误边界。编码细则见 `engineering.md`。

## 技术底座

- Tauri 2 桌面运行时。
- React + TypeScript strict + Vite 前端。
- 本地 SQLite；Rust 使用窄命令和事务，不向 React 暴露通用 SQL。
- 本地 TopoJSON/GeoJSON，经 `d3-geo` 投影为 SVG；`topojson-client` 生成要素和共享边界。
- Zod 校验内容包；Vitest/Testing Library/Playwright 测试。
- pnpm 管理前端依赖，Cargo 管理 Rust。

Tauri 在 Windows 使用 WebView2，在 macOS 使用 WKWebView。Windows 安装器必须处理少数缺少 WebView2 Runtime 的 Windows 10 环境。

## 模块边界

- `app`：启动、页面/暂停栈、依赖装配、错误边界。
- `content`：schema、校验、载入、版本与内容迁移。
- `map`：投影、SVG 图层、命中、视口、标签、可访问性。
- `learning`：能力、答案、提示、掌握、易忘、调度。
- `practice`：会话、题目状态机、摸底/智能/自定义、总结。
- `explore`：探索用例和地点学习详情。
- `persistence`：repository port、内存适配器、Tauri 适配器、备份。
- `audio`：音效方案、预加载、音量和失败降级。
- `desktop`/`src-tauri`：SQLite、资源读取、文件对话框、备份容器、打包。

React 页面只组合状态和视图；地图只发出 selection/viewport 事件，不认识正确答案；Rust command 不包含学习规则。

## 关键接口

```ts
interface ContentSource {
  readPackIds(): Promise<readonly string[]>;
  readJson(packId: string, fileName: PackFileName): Promise<unknown>;
}

type AppSettings = Readonly<{
  audio: Readonly<{ enabled: boolean; packId: 'crisp' | 'soft' | 'minimal'; volume: number }>;
}>;

interface ProgressRepository {
  loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]>;
  saveAttempt(input: SaveAttemptInput): Promise<void>;
  saveSession(session: PracticeSession): Promise<void>;
  loadResumableSession(learnerId: string, packId: string, now: string): Promise<PracticeSession | null>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
}

interface RandomSource {
  next(): number;
}
```

生产与测试必须可分别注入 Tauri/内存适配器和加密/固定随机源。

## 答题数据流

1. 调度器从已校验内容和 mastery 快照生成不可变会话。
2. UI 选择或输入答案，纯 reducer 计算立即反馈并进入 `saving`；若事务完成前进程崩溃，重启后仍恢复同一题。
3. repository 在单一事务中插入 attempt、更新 mastery、推进 session cursor。
4. 保存成功后才允许继续、返回主菜单或关闭会话；失败保留当前反馈并提供重试。
5. 会话总结由 attempt 事件和前后 mastery 差异生成。

## SQLite

至少包含：`learner`、`mastery`、`attempt_event`、`practice_session`、`app_setting`、`content_migration`、`schema_migration`。

- mastery 唯一键：`learner_id, pack_id, entity_id, skill`。
- attempt 使用稳定 ID 去重。
- 时间统一为 ISO-8601 UTC。
- 外键开启；多表更新事务化；迁移只向前、顺序唯一、可在空库重放。
- UI 不拼 SQL，不申请通用 SQL Tauri 权限。

## 备份

扩展名 `.geolearn-backup`，内部是版本化 ZIP：manifest、progress、sessions、settings，不含内置地图。

首页“数据管理”是唯一入口。Rust 端命令自行打开原生文件对话框，不接受前端提供的任意路径；导入先生成只读预览和短期 staging ID，再由 `import_staged_backup` 执行合并或替换。

- 默认合并：同一能力保留更新时间较新的记录，attempt 按 ID 去重。
- 同时间记录优先保留独立正确次数更多者。
- 完全替换需明确警告，事务执行。
- 导入前完整校验并自动生成安全备份；损坏/不兼容不写数据库。
- 导出先写临时文件、刷新后原子改名。

## 错误边界

- 单个内容包无效：隔离该包，其他包可用。
- 数据库迁移失败：不进入练习，保留数据库副本。
- 答题保存失败：不丢反馈、不推进题目，可重试。
- 音频失败：静默降级。
- UI 未捕获错误：错误边界提供重启和导出诊断，不泄露个人路径。

## 计划映射

完整文件级接口和任务依赖见 `docs/superpowers/plans/2026-08-27-development-roadmap.md`。禁止脱离该计划直接创建另一套目录或状态管理体系。

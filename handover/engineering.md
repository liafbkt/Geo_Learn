# 工程规范上下文

> 权威范围：coding style、测试、性能、平台、提交和发布门禁。

## TypeScript / React

- 开启 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。
- 禁止无说明的 `any`、非空断言和跨层复用数据库 DTO。
- 领域对象不可变；状态转换使用纯函数和判别联合，分支穷尽检查。
- React 使用函数组件；页面负责组合，规则不放进 effect 或点击处理器。
- 副作用通过 port/adapter；测试用内存实现。
- 一个文件一个明确职责；不创建万能 `utils.ts`、超大 hook 或超大页面。
- 标识符、文件名和提交信息为英文；用户文案为简体中文并集中管理。
- 错误使用稳定 code + 用户文案，不比较英文异常字符串。

## Rust / Tauri

- Rust 边界保持薄；`rustfmt` 与 `clippy -D warnings`。
- command 使用显式 serde DTO，校验 ID、时间、路径和枚举。
- 不开放 shell、任意文件系统或通用 SQL；权限最小化。
- 路径必须来自用户批准的文件对话框或内部资源目录；拒绝分隔符穿越。
- SQLite 多表写事务化；迁移只向前；失败保留可恢复状态。

## CSS 与资源

- 所有视觉值来自 token；正误状态同时有文字、图标、轮廓和颜色。
- 动画只用高效属性并尊重 reduced motion。
- 音效必须原创并附授权说明；不拉取远程字体、图片、音频或地图。
- 内容原始数据不手改派生文件；通过可复现 pipeline 转换并保存哈希。

## TDD 与测试层级

每项功能先写失败测试、确认失败原因、最小实现、确认通过、重构、聚焦提交。

- 单元：内容校验、答案归一化、提示、题目生成、掌握、易忘、调度、备份合并。
- 组件：五题型、认识、错误重试、提示、揭示、快捷键、暂停栈、音效、reduced motion。
- E2E：首页 → 摸底/智能 → 延迟重测 → 总结 → 重启；自定义；探索；备份。
- Rust：迁移、事务回滚、路径拒绝、ZIP 损坏和导入原子性。
- 数据：34/16/50 数量、双语、关系、点位落界、拓扑、来源、可复现哈希。

## 质量命令

```powershell
pnpm lint
pnpm typecheck
pnpm test -- --run --coverage
pnpm exec playwright test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
pnpm content:validate -- --all
```

开发初期命令不存在是预期状态；Task 1/14 分别建立工程和内容脚本。任何“完成/通过”声明必须基于当前任务中的新鲜完整输出。

## 性能与可访问性门槛

- 基准设备冷启动约 2 秒内可操作。
- 答案反馈 100ms 内出现；题目切换 200ms 内。
- 地图目标 60fps，基准持续帧时间不高于 20ms。
- 1024×700 和 200% 缩放完成核心练习。
- 可见焦点、语义名称、键盘等价路径；无颜色/声音/动画单一语义。

## 平台与发布

- Windows x64：NSIS 个人安装包；处理 WebView2 Runtime 缺失。
- macOS 12+：arm64 与 x86_64 构建，之后验证通用包。
- 首版可无签名/公证，仅个人安装；文档明确系统安全提示。
- 不声明公开发布就绪，直到完成中国地图人工合规/法定审核判断、许可证、签名、公证、更新和实际最低系统冒烟。

## Git 规范

- 提交小而聚焦，使用 `build:`, `feat:`, `fix:`, `test:`, `docs:`。
- 不提交 `.superpowers/`、依赖目录、构建产物、覆盖率或本地数据库。
- 不重写或丢弃用户改动；开始任务先读 `git status`。
- 实施顺序和每个提交点以 16 任务开发大纲为准。

# 工程执行摘要

> 当前进度和环境阻塞只看根 `handover.md`；本页维护编码、验证与提交规则。

## 编码规则

- TypeScript：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`；不可变领域对象、纯函数、判别联合、穷尽分支；禁止无说明 `any` 和非空断言。
- React：函数组件；规则不放 effect/事件处理器；副作用通过 port/adapter；文件单一职责。
- Rust：窄 command、显式 serde DTO、稳定错误码、事务写入、最小权限；禁止 shell、任意路径或通用 SQL。
- 用户文案集中为简体中文；标识符、文件名、提交信息为英文。
- 本地资产、字体、地图和音效；不拉远程资源。派生内容只能通过可复现 pipeline 生成。

## TDD 与任务门禁

每项行为先 RED、确认预期失败、最小 GREEN、重构、聚焦提交。每个计划任务由实现 agent 完成，再由独立 reviewer 给出规格与质量 verdict；Critical/Important 必须修复并 scoped re-review 后才能继续。

测试重点：学习纯函数、内容校验、五题型/快捷键/暂停、完整 E2E、Rust 事务/路径/备份、三包 34/16/50 数据不变量。

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

只声明本轮实际执行且 exit 0 的门禁。Windows/macOS 安装、最低系统、IME、文件对话框和性能最终仍需真机烟测。

## Git

保护用户改动；小提交使用 `build:/feat:/fix:/test:/docs:`。不提交 `.superpowers/`、依赖目录、缓存、coverage、Playwright 产物、构建产物或本地数据库。

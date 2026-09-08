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

- Windows v1 qualification design: `baa3c73`; implementation/release evidence pending.
- Manual witness is the current Windows 10 Home 22H2 user account; Windows 11, fresh OS, and missing-WebView2 manual scenarios are excluded and must not be reported as passed.
- Personal-use decision excludes named-human public-map/statutory approval from this release gate; existing compliance boxes remain unchecked.
- No branch push, candidate, stable Release, installer, or updater smoke has yet occurred.
- 更新检查边界已改为首页/总结页由用户显式触发；完全断网时不会因启动检查产生错误，主动检查失败不影响本地学习。
- Playwright 固定 fixture 已覆盖冷启动、反馈、切题和地图帧门槛；这些浏览器数据不得标记为原生 Tauri 性能实测。
- RC/stable 版本边界已在本地工具层固定为 `vMAJOR.MINOR.PATCH-rc.N`（`N >= 1`）或 `vMAJOR.MINOR.PATCH`；四个版本源必须先一致，再通过带回滚的暂存替换同步。
- 发布资产契约现为 NSIS `.exe`、`.exe.sig`、`latest.json`、`SHA256SUMS.txt` 恰好四项；校验文件覆盖另外三项并使用小写 SHA-256、ASCII 文件名排序。
- 草稿晋级只能从当前 `GITHUB_REF` 派生身份，远端草稿的 tag、candidate/stable channel、四资产、签名、更新清单和校验和全部通过后才允许一次 PATCH；这些规则仅完成本地自动测试，尚未创建或晋级任何 GitHub Release。
- E2E 全局类型声明改用模块导入以满足当前 ESLint 门禁，E2E-only 运行时边界未改变。
- `THIRD_PARTY_NOTICES.md` 已从锁定的生产依赖元数据生成并通过逐字 `--check`：12 个 Node 包、494 个 Rust 包，另含 bundled SQLite、三套原创音频和三内容包的使用/许可边界；不包含本机路径，也不把 development-only 地图声明为合规获批。
- Windows CI 证据格式固定为九个 `QG-01..09` 命令全部 `passed` 后才能写出；记录 commit/tag/run URL、runner image 和 Node/pnpm/Rust 工具版本，拒绝缺项、改命令、非 tag、非 Windows、旧输出目录和个人路径。当前只通过合成环境测试，尚无真实 GitHub run 证据。
- Release workflow 的 tag push 现在逐条执行九个原文门禁，上传 coverage、Playwright report/traces 和 `quality-gates.json`，再签名、验证并创建四资产草稿；`workflow_dispatch` 只允许在所选现有 tag 上复验远端草稿并晋级，不重建或覆盖资产。普通 quality workflow 的 Windows/macOS 矩阵使用同一九命令序列。
- 固定命令 `pnpm test -- --run --coverage` 的 pnpm 分隔符由最小测试入口归一化；本地实跑确认 `Coverage enabled with v8`、43 文件/487 项通过并生成 `coverage/index.html`。原命令文本未改变。
- Windows v1 qualification 本地实现提交链：`c17a56d`（RC/stable 与四资产）、`d2d1009`（notices/证据）、`e0546d7`（精确 Windows CI）。这些提交当前位于隔离 worktree 的 detached 线，Task 9 资格提交后需以 fast-forward 落回 `codex/user-test-mvp`；尚未推送。
- 2026-09-03 本地九门禁：QG-01/02/03/04/05/06/09 最终 exit 0；QG-03 为 43 文件/487 项，QG-04 为 19 项，QG-09 三包 34/16/50。QG-07/08 实际 exit 1，唯一 Rust 根因是本机缺少 MSVC `link.exe`，必须由 GitHub Windows runner 补齐。
- 本地失败保留：QG-05 首次因沙箱拒绝 esbuild 读取 Vite 配置 exit 1，QG-09 首次因沙箱内 `uv_os_get_passwd` ENOMEM 在校验器启动前 exit 1；两者完全相同命令在允许读取本地环境的执行面重跑 exit 0。一次 RC 聚焦测试误用 Vitest `--grep` 未启动，改用 `-t` 后通过。Task 9 收尾时 notices 检查也曾因沙箱无法收集依赖元数据 exit 1，同命令在允许读取依赖的执行面重跑 exit 0。
- 2026-09-03 安全干跑：notices freshness、离线扫描、stable identity preflight、合成 RC identity preflight、tracked secret/sensitive-file scan、ignore/upload boundary 与 `git diff --check` 均 exit 0。无 Release 资产、CI URL 或原生安装/更新烟测可报告。
- GitHub promotion PATCH 的 `draft`/`prerelease` 使用 `gh api -F` 发送 JSON boolean；stable 的 `make_latest=true` 保持 API 要求的字符串字段。该边界按 GitHub CLI 官方类型语义修正并有单测，尚未对远端执行。
- Task 9 独立审查发现并已修复发布晋级阻断：远端单资产限 256 MiB 且 `gh` 同步读取缓冲相应放宽，2 MiB 回归样本已覆盖；四资产从 GitHub 重下并通过 SHA-256 后，还必须由 Rust/minisign 使用仓库提交的 updater 公钥验签，才允许唯一一次 PATCH。真实远端和真实签名仍待授权后的候选版证明。
- `latest.json` 和 Release 草稿说明不再提前声称当前用户已验证；草稿明确个人用途、Windows 11/全新系统/真实缺失 WebView2 边界，以及 updater minisign 不等同 Authenticode 发布者签名。
- 四版本源更新在全部替换后才进入提交点；提交后的 `.bak` 清理失败不再触发回滚。staging、八个 rename 位置、rollback 和部分 backup cleanup 均有故障注入覆盖；失败回滚不先删除当前版本源。
- `THIRD_PARTY_NOTICES.md` 改为 Windows production/build Rust 可达图，排除仅开发依赖，附带并去重映射依赖自带的 license/NOTICE 正文；配置要求它随 NSIS 资源分发。当前只是配置与生成验证，安装后的实际落盘位置仍需候选版烟测确认。
- 本机缺少 MSVC `link.exe`：Rust clippy/test 的 exit-0 证据和真实 NSIS/updater 构建必须来自 GitHub Windows runner。
- 自动化、资产、授权和当前用户实测的实时状态以 `docs/release/windows-v1-checklist.md` 与 `docs/release/windows-v1-smoke.md` 为准；尚未记录的结果不得宣称通过。
- 2026-09-07 下载就绪复核：本地 release-focused Vitest 8 文件/121 项、lint、typecheck、rustfmt、notices freshness 与 `git diff --check` 均 fresh exit 0；`pnpm build` 在已知 esbuild 沙箱读权限失败后以完全相同命令在允许读取本机环境的执行面复跑 exit 0（305 modules）。GitHub 公共 API 返回 0 个 Release、0 次 Actions run，远端未找到 `codex/user-test-mvp`，且当前 `gh` 登录 token 无效。因此初版安装测试尚不能开始，必须先经明确授权重新登录、推送并由 Windows runner 生成真实资产。
- 2026-09-07 第一阶段已获当前用户明确授权：GitHub 登录恢复，审核分支与不可变 `v0.1.0-rc.1` 已推送。真实 Windows run `34126066871` 的 QG-01..06 通过，但 QG-07 在 `progress.rs` 生命周期/SQLite 类型推断与 `backup.rs` 两个 clippy warning 失败；QG-08/09、签名、草稿资产均未运行。修复提交 `8138063` 只纠正这七项；`rc.1` 保留为失败候选，必须用新的 `v0.1.0-rc.2` 重跑，绝不覆盖 tag。
- 2026-09-07 `v0.1.0-rc.2` 的真实 Windows run `34127404393` 再次在 QG-07 停止：先前七项已消失，唯一剩余根因是 `progress.rs:563` 将 `lock_database(...)?` 直接借用给 `&mut Connection`，而 `?` 返回 `MutexGuard<Connection>`（`E0308`）。修复提交 `2138e7a` 仅将该 guard 显式绑定后传入；QG-01..06 在 rc.1/rc.2 均通过，QG-08/09、签名和草稿资产均未运行。`rc.2` 永远保留为失败候选，下一步只能用 `v0.1.0-rc.3` 重测。当前用户无需提供密钥、token 或本机 MSVC；安装与更新测试仍须等成功候选并另获授权。
- 2026-09-07 `v0.1.0-rc.3` 的真实 Windows run `34128882514`：QG-01..06 均通过，`progress.rs` 修复已获 MSVC 编译验证；QG-07 随后拒绝无调用的 `backup.rs:1130 mastery_key`（`-D dead-code`）。修复提交 `7caaf22` 仅删除该孤立函数；QG-08/09、签名和草稿资产未运行。`rc.3` 保留为失败候选，下一步只能用 `v0.1.0-rc.4` 重测。
- 2026-09-07 `v0.1.0-rc.4` 的真实 Windows run `34129905190`：QG-01..07 全部通过；QG-08 的备份测试在应用解析器之前失败，因为 ZIP writer 已拒绝测试夹具的重复名称。修复提交 `cd04860` 先生成同长度占位名，再替换 ZIP 本地头与中央目录中的两个名称为 `progress.json`，并断言替换数为二，仍由真实解析器拒绝重复条目。`rc.4` 保留为失败候选，下一步只能用 `v0.1.0-rc.5` 重测；未产生 Release 或安装包。
- 2026-09-08 `v0.1.0-rc.5` 的真实 Windows run `34136508178` 已首次令 QG-01..09 全部通过；随后证据写入器将 Windows pnpm 入口硬编码为 `pnpm.cmd` 而失败，签名与草稿资产未运行。修复提交 `7937cc2` 在 Windows 明确由 `pwsh -NoProfile -Command "pnpm --version"` 获取版本；用合成非敏感 CI 身份已完整写出九门禁证据，发布脚本测试 6 文件/116 项通过。`rc.5` 保留为失败候选，下一步只能用 `v0.1.0-rc.6` 重测。
- 2026-09-08 `v0.1.0-rc.6` 的真实 Windows run `34177876989` 已令 QG-01..09 与门禁证据写入全部通过；签名密钥、密码及 `contents: write` 预检也通过。签名 job 在构建前拒绝 `THIRD_PARTY_NOTICES.md`（CI 生成结果与提交文件不一致），因此没有生成、签名或上传任何资产。为取得 Windows 端的可审计差异，release workflow 仅在该 freshness 检查失败时生成并保留 7 天 `THIRD_PARTY_NOTICES.md` 诊断 artifact；它不触及私钥、不执行构建、也不创建 Release。`rc.6` 保留为失败候选，必须先以新不可变候选运行该诊断，再提交 Windows 生成的声明文件。
- 2026-09-08 `v0.1.0-rc.7` 的真实 Windows run `34222866127` 再次令 QG-01..09、门禁证据与签名预检通过，并在 notices 检查失败后安全跳过构建/签名/上传。其 `windows-third-party-notices-diagnostic` artifact（77,375 bytes，artifact SHA-256 `ac79eb3d9aa158e5ce86d79ba78fb5b2974c502737534d09ab26944850cd70c2`）中的文件与仓库 blob 逐字相同（内容 SHA-256 `eb0b9255d2956678c97808f7591a077d4c95b5af57323923caff628568e1cca1`）。根因是 GitHub Windows runner 的 `core.autocrlf=true` 将未受属性约束的 Markdown 工作树文件检出为 CRLF，而生成器固定输出 LF；`.gitattributes` 现强制 `THIRD_PARTY_NOTICES.md text eol=lf`，并有回归测试。不得在该行尾修复经 Windows CI 验证前发起下一候选或 Release。
- 2026-09-08 `v0.1.0-rc.8` 的真实 Windows run `34225148188` 已验证上述 LF 修复：notices freshness 通过，QG-01..09、门禁证据和签名预检也通过。随后 `pnpm tauri build … --ci -- --locked` 使 pnpm 吞掉 Tauri-to-Cargo 的分隔符，Tauri 收到孤立 `--locked` 并在编译/签名/上传前退出；没有 Release 资产。人为尝试的 `pnpm run tauri -- …` 在本地验证中同样错误地将首个 `--` 传给 Tauri，因此未推送。最终修复固定为 `pnpm exec tauri build … --ci -- --locked`，并由工作流回归测试锁定；该命令尚待新的 Windows 候选验证，验证前不得创建 candidate 或 Release。

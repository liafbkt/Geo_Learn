# Windows 发布与签名更新

本分支从 `WAVE_A_SHA=a3026a055e1ec6e25dcc3dc16d863eb8201188c9` 建立发布基础设施；不修改 `src/app/App.tsx`，不代表完整用户版本已可公开发行。

## 当前信任配置

2026-09-01，经用户明确授权，使用官方 Tauri signer 生成真实更新签名密钥，并将公钥写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`。私钥及非空随机密码分别通过 `gh secret set` 的标准输入写入以下仓库 Actions Secrets，两个命令均成功，并再次核实名称及更新时间。未使用示例密钥。

此前的 Secrets HTTP 403 权限阻塞已解除。配置中的公钥文本（去除首尾空白）的 SHA-256：`a47374a40e99621fa4724eefc2806372c84088b074089d8fabc8694bdeb374f7`。

已配置的仓库 Actions Secrets：

| 名称 | 内容 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Tauri signer 生成的完整私钥文件内容，不能填写本机路径 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥的非空加密密码 |

`GITHUB_TOKEN` 由 GitHub Actions 自动提供，仅发布 job 需要 `contents: write`；不另存 PAT。

## 密钥配置流程

1. 用户明确授权生成生产更新密钥，并为当前 GitHub 凭据授予本仓库 Actions Secrets 读写权限。先只读检查权限和 Secret 名称；已有部署密钥时不得覆盖或自动轮换。
2. 在仓库外创建随机临时目录，关闭继承权限，仅当前用户可访问。本次通过已安装官方 `@tauri-apps/cli` 的进程内 API 调用 `signer generate --write-keys`；随机密码通过子进程标准输入进入内存，不出现在操作系统命令行中，CLI 原始输出全部截留。不使用 `--force`。故障恢复密码只以 Windows DPAPI 加密形式临时保存在同一受限目录。
3. 通过子进程标准输入把私钥文件内容交给 `gh secret set TAURI_SIGNING_PRIVATE_KEY --repo liafbkt/Geo_Learn`；同样通过标准输入设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。不要使用 `--body` 参数、`.env`、剪贴板、仓库内临时文件或输出 secret 内容。
4. 检查两个写入命令均成功；把生成的 `.pub` 内容填入 `plugins.updater.pubkey` 并提交，内容不是文件路径。若任一写入失败，报告尚未设置的名称，保留受限临时材料以便恢复，不生成第二套密钥或声称完成。
5. 确认两个写入命令成功、Secret 名称存在、公钥匹配，并用官方 signer 签名随机挑战文件：验证有效签名、可信注释签名，并确认篡改数据验签失败。本次这些检查均通过，随后已删除受限临时目录中的全部材料，包括私钥与 DPAPI 密码恢复文件。此检查不能代替 workflow 中对真实 NSIS 安装器的验签和安装实测。

以上配置流程已执行；秘密未显示、未写入 `.env` 或仓库。GitHub Secrets 不可读回，当前未保留本地恢复副本；不要删除或随意轮换这些 Secrets。若需要可恢复备份，须由用户另行指定受信任的密码保险库及安全恢复流程，不能把秘密导出到日志或普通文件。丢失私钥将无法给已有安装签发更新。

## 安装与资源

- 目标为 Windows x64，NSIS `currentUser` 安装。`downloadBootstrapper` 由安装器检查 WebView2；缺失时下载并静默安装，需要首次安装时能访问微软下载服务。WebView2 已存在后的核心学习功能不需要网络。
- SQLite 通过 `rusqlite` 的 `bundled` 特性编入应用，SQL migrations 使用 `include_str!` 编译，前端 `dist` 与应用图标随应用提供；无需单独安装 SQLite 服务。
- 内容包沿用 `resources/content/**/*`，Rust 从 `resource_dir/resources/content` 读取。release gate 要求中国省级、上海区县、美国州三包完整且校验通过；本基线尚无这些真实数据，禁止拿夹具替代。
- 用户数据库创建在应用数据目录的 `progress.sqlite3`，不放安装目录，不复制进发布资产。升级保留用户数据；SQLite 迁移兼容性仍由后续版本验证。
- 更新模式为官方推荐的 `passive`，Tauri 在安装阶段可能退出当前 Windows 进程。任务 9 必须在调用安装前完成保存与确认；本任务不添加重启、shell 或通用文件访问插件。

检查入口是本地内联插件的无参数 `app-update:allow-check`，Rust 固定 30 秒超时并使用编译配置。官方通用 `updater:allow-check` 不授权，因为它允许传入代理 URL、请求头、目标平台和降级选项。仅另授予 `updater:allow-download` 与 `updater:allow-install`，二者操作 Rust 创建的更新资源，不能传入任意安装路径或安装字节。三个权限仅适用于 Windows 本地主窗口。

## 发布流程与验收

流程面向本仓库的版本标签；先运行 Windows 前端/Rust 门禁，再执行内容/公钥/Secrets/版本一致性检查、NSIS 构建和 updater 签名。Rust `verify_update_artifact` 使用 Tauri 同样的 minisign 验证，确认安装器与已提交公钥匹配。仅在所有步骤通过后准备安装器、`.exe.sig`、`latest.json`，上传 Actions artifact 并创建 **draft Release**。脚本不覆盖已公开发布的 Release。

Tauri 2 的 NSIS `.exe` 本身就是 updater artifact，不使用 v1 的 `.nsis.zip`。`latest.json` 的 `windows-x86_64.signature` 必须是 `.sig` 文件内容；URL 必须指向本仓库对应版本安装器。

固定客户端 endpoint：

```text
https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json
```

草稿和预发布不会成为该地址指向的稳定最新版。只有完成内容人工合规审核、安装和升级实测后，由有权限的用户发布稳定 Release；不要为了测试而擅自公开草稿。首次还没有稳定 Release 时的 404 是可恢复检查错误，不是“已经最新”。

后续必须在干净 Windows x64 环境验证：已有/缺失 WebView2 的安装；离线启动与三包/SQLite 可用；从旧版升级到同一密钥签发的新版；网络中断及下载重试；错误签名被拒绝；安装失败后的恢复；进度数据库保留；回退到兼容版本的人工恢复。签名验证成功并不等于这些实际安装验收完成。

Updater 签名与 Windows Authenticode 是两套机制。本任务提供前者，不宣称获得 Windows 代码签名证书或消除 SmartScreen 提示。

## 本轮验证与独立审查

2026-08-31，在此隔离分支执行并退出成功：

- Vitest 全量覆盖率运行：29 个文件、352 项测试通过（包含更新状态机/真实 JS 插件 IPC 合约、配置、发布脚本和解析后的 workflow 声明）。
- `pnpm typecheck`、`pnpm lint`、`pnpm build`。
- Playwright 构建产物烟测：800×600、1280×800 两项均通过；只验证本地浏览器壳层加载/重载，无外部请求，不冒充完整练习流程或原生更新 E2E。
- 内容夹具验证与重复生成哈希一致性、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`。
- 真实工作区发布预检拒绝空公钥，退出 1，未进入签名或发布。

独立只读安全审查代理 `security_review` 审阅全部变更并独立执行 62 项相关测试，全部通过；结论：**无 Critical / Important 问题，可以提交基础设施变更，尚不能发布生产版本**。初审指出官方 check IPC 可传入代理 URL，已改为无参数 Rust 内联插件，并通过最终复审。未以实现代理自审代替独立审查。

2026-09-01 配置真实公钥后再次运行 Vitest 全量覆盖率测试：29 个文件、352 项通过。公钥格式验证通过；真实工作区发布预检已通过公钥/endpoint 等配置检查，随后按预期拒绝缺失的 `cn-provinces` 真实内容包。签名材料处理脚本执行前经过独立安全审查，未发现阻断执行的问题。

`cargo check --all-targets` 和 `cargo test --locked --offline --all-targets` 此前均因本机缺少 `link.exe` 失败，故没有 Rust 可执行测试、真实安装器构建/验签或安装升级通过证据。未推送分支、运行远程 release workflow 或创建 Release。三套真实内容仍由内容任务集成，公开地图审核仍需具名人工完成。

## 官方依据（2026-08-31 核验）

- [Tauri 2 Windows Installer](https://v2.tauri.app/distribute/windows-installer/)：NSIS、WebView2 安装模式。
- [Tauri 2 Updater](https://v2.tauri.app/plugin/updater/)：强制签名、`createUpdaterArtifacts`、静态 JSON、`passive` 和权限。
- [Tauri 2 Updater JavaScript API](https://v2.tauri.app/reference/javascript/updater/)：检查、下载进度、分别安装和资源生命周期。
- [Tauri 2 Capabilities](https://v2.tauri.app/security/capabilities/)：窗口、平台和本地访问范围。
- [Tauri 官方 updater 验签实现](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/updater/src/updater.rs)：验签算法及 Windows 安装行为。
- [GitHub Actions 安全使用](https://docs.github.com/en/actions/reference/security/secure-use)：固定 Action 引用、权限和不可信输入处理。
- [GitHub Actions Secrets](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)：Secrets、CLI 配置和最小化泄漏风险。
- 已核验的官方 Action 声明：[checkout@v4](https://github.com/actions/checkout/blob/v4/action.yml)、[setup-node@v4](https://github.com/actions/setup-node/blob/v4/action.yml)、[upload-artifact@v4](https://github.com/actions/upload-artifact/blob/v4/action.yml)。不使用 `@main`、`@master` 或第三方下载脚本。

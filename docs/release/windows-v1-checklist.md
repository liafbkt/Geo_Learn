# Windows v1 发布验收台账

> 范围：个人使用的 Windows x64 测试版。任何 `passed` 记录都必须同时写明时间和命令、Actions run 或 Release 引用；无引用的结果不得视为证据。

## 质量门禁

| ID | Command | Local | Windows CI | Evidence URL |
| --- | --- | --- | --- | --- |
| QG-01 | `pnpm lint` | pending | pending | — |
| QG-02 | `pnpm typecheck` | pending | pending | — |
| QG-03 | `pnpm test -- --run --coverage` | pending | pending | — |
| QG-04 | `pnpm exec playwright test` | pending | pending | — |
| QG-05 | `pnpm build` | pending | pending | — |
| QG-06 | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | pending | pending | — |
| QG-07 | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | blocked: local MSVC absent | pending | — |
| QG-08 | `cargo test --manifest-path src-tauri/Cargo.toml` | blocked: local MSVC absent | pending | — |
| QG-09 | `pnpm content:validate -- --all` | pending | pending | — |

## 授权台账

| ID | Mutation | Status | Authorized at/by | Evidence |
| --- | --- | --- | --- | --- |
| AUTH-01 | Push reviewed `codex/user-test-mvp` branch | pending | — | — |
| AUTH-02 | Create and push candidate version commit/tag | pending | — | — |
| AUTH-03 | Promote candidate draft to prerelease | pending | — | — |
| AUTH-04 | Execute candidate installer in current account | pending | — | — |
| AUTH-05 | Create and push stable version commit/tag | pending | — | — |
| AUTH-06 | Promote stable draft to GitHub latest | pending | — | — |
| AUTH-07 | Launch the downloaded stable updater installer | pending | — | — |

## Candidate publication

| Field | Status | Evidence |
| --- | --- | --- |
| Selected immutable tag | pending | — |
| Version sources synchronized | pending | — |
| Tag release workflow exit 0 | pending | — |
| Draft asset inspection | pending | — |
| Candidate promotion | pending | — |
| Candidate download and checksum verification | pending | — |

## Stable publication

| Field | Status | Evidence |
| --- | --- | --- |
| Immutable tag `v0.1.0` | pending | — |
| Version sources synchronized | pending | — |
| Tag release workflow exit 0 | pending | — |
| Draft asset inspection | pending | — |
| Stable promotion and GitHub latest | pending | — |
| Stable download and checksum verification | pending | — |

## Required Release assets

| ID | Asset | Candidate | Stable | Name / size / SHA-256 / URL |
| --- | --- | --- | --- | --- |
| ASSET-01 | Windows x64 NSIS `.exe` | pending | pending | — |
| ASSET-02 | Matching updater `.exe.sig` | pending | pending | — |
| ASSET-03 | `latest.json` | pending | pending | — |
| ASSET-04 | `SHA256SUMS.txt` | pending | pending | — |

## Current-user native smoke summary

Detailed observations belong in `windows-v1-smoke.md`.

| Range | Scope | Status | Evidence |
| --- | --- | --- | --- |
| SMOKE-C-01..15 | Candidate install and native behavior | pending | — |
| SMOKE-U-01..08 | Candidate-to-stable signed update | pending | — |

## Failed release candidates

| Candidate | Failed at | Symptom | Repair commit | Retest / successor |
| --- | --- | --- | --- | --- |
| none yet | — | — | — | — |

## Unverified boundaries

| Boundary | Status | Release treatment |
| --- | --- | --- |
| Windows 11 manual test | not tested | Must not be reported as passed |
| Fresh Windows installation | not tested | Must not be reported as passed |
| Genuinely missing WebView2 | not tested | Installer configuration may be checked; no manual pass claim |
| Named-human China-map render review | out of scope: personal-use | Existing compliance box remains unchecked |
| Statutory/public-distribution map approval | out of scope: personal-use | Existing compliance box remains unchecked |

## Completion

| Requirement | Status | Evidence |
| --- | --- | --- |
| All QG-01..09 exit 0 on GitHub Windows runner | pending | — |
| Candidate installed and SMOKE-C-01..15 observed | pending | — |
| Stable assets directly downloadable | pending | — |
| Installed candidate verifies and launches stable updater | pending | — |
| SMOKE-U-01..08 observed | pending | — |
| Final commit `test: qualify the Windows v1 release` pushed | pending | — |


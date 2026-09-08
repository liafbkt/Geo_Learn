# Windows v1 发布验收台账

> 范围：个人使用的 Windows x64 测试版。任何 `passed` 记录都必须同时写明时间和命令、Actions run 或 Release 引用；无引用的结果不得视为证据。

## 质量门禁

| ID | Command | Local | Windows CI | Evidence URL |
| --- | --- | --- | --- | --- |
| QG-01 | `pnpm lint` | passed — 2026-09-07 21:35 CST; exit 0 | passed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-02 | `pnpm typecheck` | passed — 2026-09-07 21:35 CST; exit 0 | passed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-03 | `pnpm test -- --run --coverage` | passed on sandbox-exempt rerun — 2026-09-07 21:35 CST; exit 0; 43 files/505 tests | passed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-04 | `pnpm exec playwright test` | passed on sandbox-exempt rerun — 2026-09-07 21:36 CST; exit 0; 19 tests | passed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-05 | `pnpm build` | passed on sandbox-exempt rerun — 2026-09-07 21:36 CST; exit 0; 305 modules | passed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-06 | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | passed — 2026-09-07 21:35 CST; exit 0 | passed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-07 | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | blocked — 2026-09-07 21:37 CST; MSVC `link.exe` absent | failed — 2026-09-07; `v0.1.0-rc.1`, `v0.1.0-rc.2` | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393); rc.2's sole `E0308` repaired in `2138e7a` |
| QG-08 | `cargo test --manifest-path src-tauri/Cargo.toml` | blocked — 2026-09-07 21:37 CST; MSVC `link.exe` absent | not run — `v0.1.0-rc.1` and `v0.1.0-rc.2` stopped at QG-07 | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |
| QG-09 | `pnpm content:validate -- --all` | passed on sandbox-exempt rerun — 2026-09-07 21:37 CST; exit 0; 34/16/50 packs | not run — `v0.1.0-rc.1` and `v0.1.0-rc.2` stopped at QG-07 | [rc.1](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871), [rc.2](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) |

## Local security and dry checks

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm release:notices -- --check` | passed — 2026-09-03 21:33 CST; exit 0 | `THIRD_PARTY_NOTICES.md is current.` |
| `pwsh -File scripts/check-offline.ps1` | passed — 2026-09-03 21:33 CST; exit 0 | `Offline scan passed.` |
| Stable identity preflight | passed — 2026-09-03 21:34 CST; exit 0 | `GITHUB_REF=refs/tags/v0.1.0`; `Release preflight passed.` |
| Synthetic RC identity preflight | passed — 2026-09-03 21:33 CST; exit 0 | Focused test for `refs/tags/v0.1.0-rc.1`; 1 passed/44 skipped |
| Tracked secret-pattern and sensitive-file scan | passed — 2026-09-03 21:33 CST; exit 0 | No private-key marker or tracked `.env`/`.key`/`.p12`/`.pfx` |
| Ignore/upload boundary | passed — 2026-09-03 21:33 CST; exit 0 | release artifacts/evidence, coverage, Playwright output, `.env`, and key containers matched `.gitignore`; workflows deliberately upload only named CI evidence |
| `git diff --check` | passed — 2026-09-03 21:33 CST; exit 0 | Operator-recorded local observation (no retained transcript) |

## 2026-09-07 readiness recheck

| Check | Result | Evidence |
| --- | --- | --- |
| Release-focused Vitest | passed — 2026-09-07 20:28 CST; exit 0; 8 files/121 tests | `pnpm exec vitest run scripts/release scripts/run-tests.test.mjs src/release/config.test.ts` |
| Lint/typecheck/rustfmt/diff | passed — 2026-09-07 20:28 CST; each exit 0 | Fresh local command results; Windows native link gates remain unchanged |
| Production build | passed on identical sandbox-exempt rerun — 2026-09-07 20:31 CST; exit 0; 305 modules | Initial sandbox EACCES retained below |
| Notices freshness | passed — 2026-09-07 20:29 CST; exit 0 | `THIRD_PARTY_NOTICES.md is current.` |
| Public GitHub release audit | not ready — 2026-09-07 20:27 CST | GitHub public API returned 0 Releases and 0 Actions runs; remote `codex/user-test-mvp` was not found |
| GitHub CLI authentication | restored — 2026-09-07 21:08 CST | `liafbkt` authenticated; repository reports admin and push access |

This read-only audit is not authorization for a push, tag, Release, promotion, or installer execution. The installation test cannot start until a Windows workflow passes and publishes the required assets.

## Local qualification incidents

| Timestamp | Command | Exit | Cause and disposition |
| --- | --- | --- | --- |
| 2026-09-03 21:31 CST | `pnpm build` | 1 | Sandbox denied esbuild access to `vite.config.ts`; identical sandbox-exempt rerun exit 0. No source fix or waiver. |
| 2026-09-03 21:32 CST | `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | 1 | MSVC `link.exe` absent; remains blocked pending GitHub Windows runner. |
| 2026-09-03 21:32 CST | `cargo test --manifest-path src-tauri/Cargo.toml` | 1 | MSVC `link.exe` absent; remains blocked pending GitHub Windows runner. |
| 2026-09-03 21:33 CST | `pnpm content:validate -- --all` | 1 | Sandbox Node startup failed at `uv_os_get_passwd` with ENOMEM before validation; identical sandbox-exempt rerun exit 0. |
| 2026-09-03 21:33 CST | RC-focused Vitest invocation with unsupported `--grep` | 1 | Test did not start; corrected to supported `-t`, then 1 focused test passed. Not a product or release-candidate failure. |
| 2026-09-03 21:38 CST | `pnpm release:notices -- --check` | 1 | Sandbox could not collect installed dependency metadata; identical sandbox-exempt rerun exit 0 and confirmed the committed notices are current. |
| 2026-09-07 20:30 CST | `pnpm build` | 1 | Sandbox again denied esbuild access while loading `vite.config.ts`; identical sandbox-exempt rerun exit 0 with 305 modules. |
| 2026-09-07 21:16 CST | Windows `QG-07` for `v0.1.0-rc.1` | 1 | Real MSVC runner found seven Rust compile/clippy errors in `progress.rs` and `backup.rs`; no QG-08/QG-09, signing, or draft asset steps ran. Repair `8138063`; successor must be a new immutable RC. |
| 2026-09-07 21:29 CST | Windows `QG-07` for `v0.1.0-rc.2` | 1 | Real MSVC runner cleared the seven prior errors but found the sole `E0308` at `progress.rs:563`: a `MutexGuard<Connection>` was passed through `?` where `Connection` was expected. No QG-08/QG-09, signing, or draft asset steps ran. Repair `2138e7a`; successor must be a new immutable RC. |
| 2026-09-07 21:47 CST | Windows `QG-07` for `v0.1.0-rc.3` | 1 | Real MSVC runner compiled `progress.rs` successfully, then rejected the unused `backup.rs:1130` `mastery_key` under `-D dead-code`. No QG-08/QG-09, signing, or draft asset steps ran. Repair `7caaf22`; successor must be a new immutable RC. |
| 2026-09-07 22:03 CST | Windows `QG-08` for `v0.1.0-rc.4` | 1 | QG-01..07 passed. The duplicate ZIP test fixture unwrapped a `zip` writer error before reaching `inspect_archive_bytes`; Windows rejected the duplicate name during fixture construction. Repair `cd04860` constructs duplicate central/local ZIP names after creation; successor must be a new immutable RC. |
| 2026-09-08 09:12 CST | Evidence writer for `v0.1.0-rc.5` | 1 | QG-01..09 passed, but `write-gate-evidence.mjs` hard-coded `pnpm.cmd`; the hosted runner exposes pnpm through PowerShell. No signing or draft assets ran. Repair `7937cc2` invokes `pwsh -NoProfile -Command "pnpm --version"`; successor must be a new immutable RC. |

## 授权台账

| ID | Mutation | Status | Authorized at/by | Evidence |
| --- | --- | --- | --- | --- |
| AUTH-01 | Push reviewed `codex/user-test-mvp` branch | performed — 2026-09-07 21:10 CST | current user, explicit first-stage authorization | [remote branch](https://github.com/liafbkt/Geo_Learn/tree/codex/user-test-mvp) through `9b4addf` |
| AUTH-02 | Create and push candidate version commit/tag | performed — 2026-09-07 21:12 CST | current user, explicit first-stage authorization | immutable `v0.1.0-rc.1` and `v0.1.0-rc.2` retained below after failures |
| AUTH-03 | Promote candidate draft to prerelease | pending | — | — |
| AUTH-04 | Execute candidate installer in current account | pending | — | — |
| AUTH-05 | Create and push stable version commit/tag | pending | — | — |
| AUTH-06 | Promote stable draft to GitHub latest | pending | — | — |
| AUTH-07 | Launch the downloaded stable updater installer | pending | — | — |

## Candidate publication

| Field | Status | Evidence |
| --- | --- | --- |
| Selected immutable tag | `v0.1.0-rc.1` through `v0.1.0-rc.6` failed; successor is pending Windows notices diagnosis | [rc.6](https://github.com/liafbkt/Geo_Learn/actions/runs/34177876989) |
| Version sources synchronized | passed for immutable `v0.1.0-rc.1` and `v0.1.0-rc.2` | commits `69ed53c`, `9b4addf` |
| Tag release workflow exit 0 | failed for immutable `v0.1.0-rc.1` and `v0.1.0-rc.2` | QG-07 failures; successor required |
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
| `v0.1.0-rc.1` | QG-07, [Windows run 34126066871](https://github.com/liafbkt/Geo_Learn/actions/runs/34126066871) | Rust lifetime/type inference errors and two denied clippy warnings; no draft assets created | `8138063` | Full local recheck passed where executable locally; prepare `v0.1.0-rc.2` and re-run all Windows gates |
| `v0.1.0-rc.2` | QG-07, [Windows run 34127404393](https://github.com/liafbkt/Geo_Learn/actions/runs/34127404393) | Sole Rust `E0308` from passing `MutexGuard<Connection>` through `?`; no draft assets created | `2138e7a` | Full local recheck passed where executable locally; prepare `v0.1.0-rc.3` and re-run all Windows gates |
| `v0.1.0-rc.3` | QG-07, [Windows run 34128882514](https://github.com/liafbkt/Geo_Learn/actions/runs/34128882514) | Unused `mastery_key` denied by `-D dead-code`; no draft assets created | `7caaf22` | Full local recheck passed where executable locally; prepare `v0.1.0-rc.4` and re-run all Windows gates |
| `v0.1.0-rc.4` | QG-08, [Windows run 34129905190](https://github.com/liafbkt/Geo_Learn/actions/runs/34129905190) | Duplicate ZIP fixture failed during construction before the production parser; no draft assets created | `cd04860` | Use a post-write duplicate-name fixture and prepare a new immutable candidate |
| `v0.1.0-rc.5` | Gate-evidence write, [Windows run 34136508178](https://github.com/liafbkt/Geo_Learn/actions/runs/34136508178) | QG-01..09 passed; Windows `pnpm.cmd` version lookup failed before signing | `7937cc2` | Windows PowerShell version lookup repaired; prepare a new immutable candidate |
| `v0.1.0-rc.6` | Notices freshness, [Windows run 34177876989](https://github.com/liafbkt/Geo_Learn/actions/runs/34177876989) | QG-01..09, gate evidence, signing-secret and `contents: write` preflight passed; committed notices differ from Windows generation, so build/sign/upload were skipped | pending Windows diagnostic artifact | New candidate will upload the generated notice only on this failure; then commit its exact contents and retry |

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


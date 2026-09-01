# Windows x64 signed update infrastructure

**Baseline:** `a3026a055e1ec6e25dcc3dc16d863eb8201188c9` (`WAVE_A_SHA`).
**Branch:** `codex/v1-windows-release`.
**Goal:** supply NSIS release infrastructure and a typed update service, without application navigation/UI integration or public distribution.

## Decisions

- Build only `x86_64-pc-windows-msvc` NSIS; WebView2 `downloadBootstrapper`, silent dependency installation, per-user application installation, updater `passive`.
- Keep SQLite statically bundled through rusqlite; compile migrations and frontend assets into the application. Keep content under the existing resource path. Never package a user's progress database.
- Use only the local main window's Windows updater check/download/install permissions; no shell, filesystem, HTTP, opener or process grants are added.
- Separate the typed service from a native adapter. Explicit check/download/install/retry operations; unknown progress totals remain indeterminate. Download completion must include successful signature verification. Task 9 owns UI wiring and saving before an installation that exits Windows.
- Windows workflow verifies the full available frontend/Rust suite before signing. Fail closed on missing content, trust material, mismatched versions or incomplete artifacts. Verify the generated installer signature against the committed public key before creating `latest.json` or uploading assets. Create draft releases only.
- Fixed official GitHub Action major versions; all release scripts are checked into this repository. Signing material is restricted to signing/preflight steps; automatic `GITHUB_TOKEN` only for release writes.

## Tasks and evidence

1. Configuration contracts: RED on missing NSIS/updater/capability, then GREEN after configuration edits.
2. Update service: independent implementation agent, fake native port and real JS plugin IPC contract tests, RED/GREEN and lifecycle/error tests.
3. Release tooling: independent implementation agent, parsed workflow declarations and executable preflight/artifact fixtures; local browser build smoke.
4. Whole-change security review by an independent reviewer; fix important findings and re-review before final commit.
5. Run available local gates and record limitations. Commit with `build: add signed Windows release updates`.

## External gates, not simulated completion

- On 2026-09-01, explicit user authorization and corrected Secrets permissions allowed real signing-key provisioning. The public key is configured; both signing Secrets were set through stdin and their names verified. An official-signer challenge passed signature verification and rejected tampered bytes. Restricted temporary private material was removed; this does not establish installer-build or installation success.
- Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Provisioning uses safe stdin to `gh secret set`, no `.env`, command-line secret values, output or repository private files.
- Baseline lacks the three real content packs, complete application flows and MSVC linker. Do not fabricate content, weaken tests, install administrator tools or claim installation/update smoke tests ran.

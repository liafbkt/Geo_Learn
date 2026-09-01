# Windows v1 Release Qualification Design

**Date:** 2026-09-01  
**Branch:** `codex/user-test-mvp`  
**Reviewed prerequisite:** roadmap Task 9 is recorded as APPROVED in the integration handover.  
**Release target:** personal-use Windows x64 test release, candidate `v0.1.0-rc.N` followed by stable `v0.1.0`.

## 1. Goal and completion boundary

Qualify a real, downloadable Windows v1 rather than treating the existence of a workflow as release evidence. Completion requires automated acceptance, a signed NSIS candidate installed by the current Windows user, a stable GitHub Release, an in-application signed update from the installed candidate to `v0.1.0`, and an auditable evidence handover.

The repository and its Release downloads are anonymously reachable, but the product is treated as a personal application. At the user's direction, named-human China-map render review and statutory public-distribution approval are not completion gates for this release. Existing unchecked compliance items remain unchecked and are described as out of scope, not passed. Release notes and the handover must state the personal-use boundary and must not claim public or commercial map compliance.

The sole manual test environment is the current user's existing Windows 10 Home 22H2 x64 account. No virtual machine or separate Windows account will be created. The following therefore remain explicitly unverified by manual testing: Windows 11, a freshly installed operating system, and a machine genuinely missing WebView2. CI and configuration tests may establish installer construction and WebView2 mode, but may not be reported as those manual scenarios passing.

## 2. Release sequence and authorization gates

1. Implement the automated qualification suite, release tooling, notices, checklists, and evidence templates locally on `codex/user-test-mvp`.
2. Run all locally feasible gates. The local lack of MSVC `link.exe` is evidence of an environment limitation, never a substitute for Rust success.
3. Ask for explicit authorization before pushing the reviewed branch or creating any GitHub tags or Releases. Restore GitHub authentication through the user's normal account; do not bypass an invalid credential with an undisclosed token.
4. Push the reviewed branch and require a GitHub Windows runner to execute the exact quality matrix with exit code 0.
5. Set all application version sources to `0.1.0-rc.1`, create tag `v0.1.0-rc.1`, build and sign it, and publish it as a GitHub prerelease. A prerelease is downloaded from its tag-specific Release page and is intentionally excluded from GitHub `latest`.
6. Download and install the candidate in the current Windows account. Preserve existing user data; if application data already exists, export a backup before installation. Exercise the candidate manual checklist except the final-update steps.
7. On any failure, add a regression test where applicable, repair the defect, rerun the full gates, and publish the next immutable candidate (`rc.2`, `rc.3`, and so on). Never move an existing tag or replace its assets.
8. After the candidate passes, ask for explicit authorization to publish the stable release. Set all version sources to `0.1.0`, create tag `v0.1.0`, run the same signed Windows release pipeline, and publish it as a non-draft, non-prerelease Release.
9. From the installed candidate, use the application's update UI to retrieve `releases/latest/download/latest.json`, detect `0.1.0` as newer, download the updater artifact, verify its signature, and start the passive installer.
10. After update, verify the displayed version and preservation of SQLite progress, settings, resumable session state, and backup behavior. Exercise uninstall and reinstall and record the observed data behavior.
11. Record Release URL, CI URLs, exact asset names and SHA-256 values, manual observations, failures, and limitations. Compress `handover.md` to the final evidence state and finish with commit `test: qualify the Windows v1 release`.

The stable `v0.1.0` tag remains immutable after publication. A defect found afterward is fixed in `v0.1.1`; `v0.1.0` is never silently rebuilt.

## 3. Automated acceptance architecture

Automated acceptance is divided by the boundary it proves.

### 3.1 Browser end-to-end acceptance

Playwright drives the production browser build with deterministic test dependencies. It covers:

- home to placement/smart practice, introduction, first error, hint, reveal, delayed retest, and summary;
- custom practice and explore-to-focused practice;
- pause, options, and the complete Esc stack;
- save failure, locked continuation, retry, and recovery;
- restart-equivalent restoration of an unfinished session through a persistent E2E adapter;
- backup export, inspection, merge, replace, and corrupt-backup rejection;
- all five question types by keyboard, including shortcut isolation and IME composition events;
- visible focus, accessible names and state, a 1024x700 window at 200% equivalent layout, and reduced-motion media emulation;
- complete network denial after local assets load, with core learning continuing and only an explicit update check permitted to fail;
- fixed-fixture timing for home readiness, answer feedback, question transition, and map animation frames.

The E2E adapter uses the same typed application ports and serialized domain objects as production. It may replace native dialogs and SQLite transport, but it may not duplicate learning, backup, or practice rules. Native behavior is covered separately by Rust integration tests and current-user smoke testing.

### 3.2 Unit, component, Rust, and content acceptance

Vitest and Testing Library retain focused coverage for reducer transitions, persistence gating, backup behavior, accessibility, update state, and configuration contracts. Rust tests cover SQLite, atomic backup operations, merge/replace rollback, command exposure, and updater verification. Content tests and `content:validate` independently enforce the 34/16/50 entity counts and all relationship, name, geometry, source, and hash invariants.

Release-tool tests parse the workflow and fail if it omits any mandatory gate, signing check, asset, version check, immutable-release rule, or evidence manifest. Signature verification must accept the real generated artifact and reject tampered bytes.

### 3.3 Performance thresholds

The handover thresholds remain exact:

- cold start to an operable home screen: at most 2 seconds on the recorded benchmark environment;
- answer submission to visible feedback: at most 100 milliseconds;
- continue action to the next operable question: at most 200 milliseconds;
- sustained map interaction frame time: at most 20 milliseconds in the fixed benchmark fixture.

Automated browser timings and current-user native observations are recorded separately. A browser timing may not be labeled a native cold-start result.

## 4. Mandatory quality matrix

The GitHub Windows runner executes these exact commands, individually, with each command required to exit 0:

```text
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

No later command runs after a failed prerequisite in the same job, and the release job cannot run unless the quality job succeeds. Logs must identify the commit, runner image, Node/pnpm/Rust versions, and command exit status. Local success, workflow syntax, or an uploaded Actions artifact alone is not proof of a downloadable installer.

## 5. Current-user native smoke test

The manual witness is the current Windows user on Windows 10 Home 22H2 x64. The record includes OS build, display scaling, reduced-motion setting, candidate/final versions, installer hashes, timestamps, and PASS/FAIL notes.

The candidate smoke test covers:

- tag-specific candidate download and NSIS current-user installation;
- first launch, Simplified Chinese UI, and actual Chinese IME input;
- creation of `progress.sqlite3` in the application data location;
- all five question types, visible focus, keyboard shortcuts, and 200% display scaling;
- the full learning journey, custom practice, explore-to-focused practice, and pause/options Esc behavior;
- visible save gating and retry behavior during normal use; forced save-failure injection remains an automated E2E and Rust test and is not performed against the current user's real database;
- closing with an unfinished session and restoring it after process restart;
- native backup export, merge, replace, corrupt rejection, and safety behavior;
- disabling network access, restarting, and completing core learning offline;
- cold-start, feedback, transition, and map timing observations;
- candidate uninstall/reinstall behavior without assuming whether application data is removed.

After stable publication, the update smoke test covers:

- explicit update check finding `v0.1.0` through `latest.json`;
- user-visible download progress and successful signature validation;
- passive installer launch and completion;
- final version launch and preservation of progress, settings, unfinished-session state, and backups;
- final uninstall/reinstall behavior.

WebView2 is normally distributed with supported Windows 10 and Windows 11 builds. The test must inspect and record the runtime state but must not remove an operating-system component from the user's daily machine merely to manufacture a missing-runtime scenario.

## 6. Release assets and trust

Every candidate and stable Release contains, at minimum:

- the Windows x64 NSIS installer/update artifact (`.exe`);
- the matching Tauri updater signature (`.exe.sig`);
- `latest.json` for a stable Release, with the exact `.sig` content embedded for `windows-x86_64`;
- a SHA-256 asset manifest;
- release notes stating personal-use scope, tested environment, known limitations, and updater-signing versus Authenticode distinction.

The candidate and stable builds use the same Tauri application identifier, updater public key, GitHub endpoint, and protected signing Secrets. Private signing material is restricted to the signing steps and is never printed, persisted in the repository, placed on a command line, or included in an artifact.

`THIRD_PARTY_NOTICES.md` lists application dependencies, bundled SQLite, original audio assets, content sources, their license/use terms, and applicable notices. It does not convert unresolved legal or statutory review into an approval.

## 7. Failure handling

- A test failure blocks signing and Release creation.
- A signing, artifact verification, or asset-manifest failure blocks upload and publication.
- A candidate installation or smoke failure creates a new release candidate after repair; it never mutates the failed candidate.
- A corrupt or invalidly signed update is rejected and leaves the installed candidate usable.
- A save failure keeps feedback visible, locks unsafe navigation or installation, and offers a retry.
- A backup validation failure performs no learning-data mutation; transactional import failure rolls back.
- A network failure affects explicit update checking only and does not block local learning.
- Existing current-user data is never deleted to make a test appear clean. Destructive replace import and uninstall/reinstall observations require their documented confirmation and prior backup.

## 8. Evidence and handover contract

Create and maintain:

- `docs/release/windows-v1-checklist.md`: release prerequisites, exact automated gates, authorization checkpoints, asset audit, and completion boxes;
- `docs/release/windows-v1-smoke.md`: candidate/final versions, OS and environment, asset hashes, timestamped current-user steps, observations, failures, repairs, and retest results;
- `THIRD_PARTY_NOTICES.md`: third-party and content notices;
- CI artifacts containing machine-readable gate and asset manifests, without secrets or personal paths;
- `handover.md`: compressed final state with commit, Release link, CI run links, exact assets, automated results, current-user manual results, and unverified boundaries.

Every changed boundary is written to the handover when it is introduced or finalized. This includes personal-use scope, exclusion of the map public-distribution gate, current-user-only smoke testing, lack of Windows 11/fresh-OS/missing-WebView2 manual evidence, candidate renumbering, failed runs, and the stable Release result. Chat history and workflow files are not substitutes for the handover record.

The first version is marked complete only when all in-scope automated gates have fresh exit-0 evidence, the stable assets are downloadable, the installed candidate completes the signed update to `v0.1.0`, current-user smoke results are recorded, the final handover contains no ambiguous completion claim, and the final qualification commit exists.

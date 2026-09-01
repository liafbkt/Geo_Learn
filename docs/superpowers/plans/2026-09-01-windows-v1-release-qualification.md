# Windows v1 Release Qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, install, update, and evidence a real downloadable Windows x64 personal-use release, from `v0.1.0-rc.N` to stable `v0.1.0`.

**Architecture:** Extend the existing typed dependency boundary with an E2E-only persistent adapter so Playwright can exercise full product journeys without copying domain rules. Keep native SQLite, backup dialogs, signing, NSIS installation, and update installation in Rust/CI/current-user acceptance. Make the tag-driven release pipeline fail closed, generate an asset checksum manifest, and keep every automated, manual, and unverified boundary in an auditable release ledger and compressed handover.

**Tech Stack:** Tauri 2, React 19, TypeScript strict mode, Vite, Playwright, Vitest/Testing Library/V8 coverage, pnpm, Rust 1.98/MSVC, rusqlite bundled SQLite, GitHub Actions/Releases, Tauri updater/minisign.

## Global Constraints

- Work only on the reviewed `codex/user-test-mvp` line and preserve unrelated user changes.
- The release is a personal-use Windows x64 test release. Existing public-map compliance boxes remain unchecked and are described as out of scope, never passed.
- The only manual environment is the current user's Windows 10 Home 22H2 x64 account. Do not claim Windows 11, fresh-OS, or genuinely missing-WebView2 manual coverage.
- Do not delete current-user application data to simulate a clean install. Export a backup before any installer, replace-import, uninstall, or reinstall operation that could affect it.
- Candidate versions are immutable `v0.1.0-rc.N` prereleases. Stable is immutable `v0.1.0`; a later stable defect becomes `v0.1.1`.
- Candidate and stable builds use the same application identifier, updater public key, GitHub endpoint, and protected signing Secrets.
- GitHub authentication is restored only through the user's normal account. Signing secrets never enter command arguments, logs, repository files, or downloadable artifacts.
- No branch push, tag, Release promotion, installer execution, or final publication occurs before the explicit authorization checkpoint for that action.
- Browser E2E adapters may replace transport and native dialogs but may not duplicate scheduling, practice, mastery, backup-merge, or validation rules.
- Performance gates are cold start ≤2,000 ms, feedback ≤100 ms, question transition ≤200 ms, and sustained map frame time ≤20 ms in the recorded benchmark fixture.
- Every boundary change, candidate renumbering, failed run, retest, Release URL, asset name, CI URL, current-user result, and unverified platform is recorded in `handover.md`.
- Final commit message is exactly `test: qualify the Windows v1 release`.

---

## Planned file map

- `handover.md`: concise live boundary and final release evidence.
- `docs/release/windows-v1-checklist.md`: authorization, quality, asset, install, update, and completion ledger.
- `docs/release/windows-v1-smoke.md`: timestamped current-user candidate/final observations and hashes.
- `THIRD_PARTY_NOTICES.md`: generated dependency/content/audio notices.
- `src/persistence/InMemoryProgressRepository.ts`: add clone-safe state import/export needed by the persistent E2E wrapper.
- `src/e2e/E2EProgressRepository.ts`: localStorage persistence and one-shot save failure injection.
- `src/e2e/E2EBackupCommands.ts`: staged valid/corrupt backup behavior using real `mergeBackupRecords`.
- `src/e2e/createE2EDependencies.ts`: deterministic clock, IDs, question plan, update port, and browser control API.
- `src/e2e/types.ts`: stable `window.__GEOLEARN_E2E__` contract shared by application and Playwright.
- `src/e2e/*.test.ts`: focused adapter/control tests.
- `src/app/performance.ts`: named Performance API marks and threshold constants.
- `src/app/App.tsx`, `src/practice/PracticeScreen.tsx`: emit readiness/feedback/transition marks without changing domain decisions.
- `src/app/dependencies.ts`, `src/main.tsx`: select the E2E dependency set only for Vite `e2e` mode.
- `e2e/helpers/app.ts`: role-based journey helpers and E2E control access.
- `e2e/practice-flow.spec.ts`: placement/smart introduction-error-hint-reveal-retest-summary and save recovery.
- `e2e/navigation-flow.spec.ts`: custom practice, exploration, pause/options Esc, and restart recovery.
- `e2e/backup-flow.spec.ts`: export, merge, replace, corrupt rejection, and refresh failure.
- `e2e/accessibility.spec.ts`: five question types, keyboard, IME, focus, 200%, and reduced motion.
- `e2e/offline-performance.spec.ts`: denied network and the four performance gates.
- `scripts/check-offline.ps1`: packaged/static outbound-network audit with the updater endpoint as the only allowlisted remote runtime URL.
- `scripts/release/version-lib.mjs`, `set-version.mjs`: validated atomic synchronization of four version sources.
- `scripts/release/evidence-lib.mjs`, `write-gate-evidence.mjs`: deterministic machine-readable CI evidence.
- `scripts/release/notices-lib.mjs`, `generate-notices.mjs`: deterministic notices from installed Node/Rust metadata plus curated content/audio notices.
- `scripts/release/lib.mjs`, `prepare-artifacts.mjs`, `publish-lib.mjs`, `publish-draft.mjs`: RC/stable identity, four-asset preparation, immutable draft creation, and controlled promotion.
- `scripts/release/promote-release.mjs`: authenticated draft-to-prerelease/stable promotion after an explicit human checkpoint.
- `scripts/release/*.test.mjs`: release, version, evidence, notices, workflow, and mutation-rejection tests.
- `.github/workflows/quality.yml`: keep ordinary Windows quality aligned with the release gates.
- `.github/workflows/release.yml`: exact nine-command Windows gate, signing, verification, four assets, and evidence upload.

---

### Task 1: Establish the live release ledger and handover boundary

**Files:**
- Create: `docs/release/windows-v1-checklist.md`
- Create: `docs/release/windows-v1-smoke.md`
- Modify: `handover.md`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-09-01-windows-v1-release-qualification-design.md`.
- Produces: stable checkbox IDs `QG-01..09`, `ASSET-01..04`, `SMOKE-C-*`, `SMOKE-U-*`, and an explicit authorization ledger referenced by later tasks.

- [ ] **Step 1: Write the checklist with immutable evidence fields**

Create sections with these exact gate IDs and commands:

```markdown
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
```

Add separate tables for branch-push authorization, candidate tag/promotion, stable tag/promotion, installer execution, four assets, current-user smoke, failed RCs, and unverified boundaries. Each completed cell requires a timestamp plus a command/run/Release reference.

- [ ] **Step 2: Write the smoke record template without claiming results**

Use this fixed environment header:

```markdown
## Witness environment

- Witness: current Windows user
- OS: Windows 10 Home 22H2 x64, build 19045
- Windows account: existing daily-use account
- Fresh OS: no
- Windows 11: not tested
- Missing WebView2: not forced on the daily-use machine
- Candidate version/hash: pending
- Stable version/hash: pending
```

List candidate steps `SMOKE-C-01..15` and update steps `SMOKE-U-01..08`; set every result to `pending` and require observation text rather than a bare checkbox.

- [ ] **Step 3: Replace stale handover claims with the newly approved boundary**

Keep prior verified counts and commit IDs, then add:

```markdown
- Windows v1 qualification design: `baa3c73`; implementation/release evidence pending.
- Manual witness is the current Windows 10 Home 22H2 user account; Windows 11, fresh OS, and missing-WebView2 manual scenarios are excluded and must not be reported as passed.
- Personal-use decision excludes named-human public-map/statutory approval from this release gate; existing compliance boxes remain unchecked.
- No branch push, candidate, stable Release, installer, or updater smoke has yet occurred.
```

- [ ] **Step 4: Verify the ledger is internally consistent**

Run:

```powershell
rg -n "pending|not tested|current Windows user|personal-use|QG-09|SMOKE-U-08" docs/release handover.md
git diff --check
```

Expected: all IDs appear, no completed result is present, and `git diff --check` exits 0.

- [ ] **Step 5: Commit the boundary before implementation changes**

```powershell
git add handover.md docs/release/windows-v1-checklist.md docs/release/windows-v1-smoke.md
git commit -m "docs: establish Windows v1 qualification ledger"
```

---

### Task 2: Build the persistent deterministic E2E dependency boundary

**Files:**
- Modify: `src/persistence/InMemoryProgressRepository.ts`
- Modify: `src/persistence/InMemoryProgressRepository.test.ts`
- Create: `src/e2e/types.ts`
- Create: `src/e2e/E2EProgressRepository.ts`
- Create: `src/e2e/E2EProgressRepository.test.ts`
- Create: `src/e2e/E2EBackupCommands.ts`
- Create: `src/e2e/E2EBackupCommands.test.ts`
- Create: `src/e2e/createE2EDependencies.ts`
- Create: `src/e2e/createE2EDependencies.test.ts`
- Modify: `src/app/dependencies.ts`
- Modify: `src/main.tsx`
- Modify: `src/vite-env.d.ts`
- Modify: `package.json`
- Modify: `playwright.config.ts`

**Interfaces:**
- Produces: `InMemoryProgressState`, `exportState(): InMemoryProgressState`, `replaceState(state): Promise<void>`.
- Produces: `E2EControl` at `window.__GEOLEARN_E2E__` with `reset`, `failNextAttemptSave`, `setQuestionKinds`, `setBackupScenario`, `setUpdate`, and `readState`.
- Produces: `createE2EDependencies(storage: Storage): AppDependencies` selected only when `import.meta.env.MODE === 'e2e'`.

- [ ] **Step 1: Read the honest-test rules before changing test code**

Read `C:\Users\Kevin\.codex\skills\test-driven-development\writing-good-tests.md` completely. Name the production behavior each new test would catch before writing it.

- [ ] **Step 2: Write failing state round-trip tests**

Add tests that prove exported state is a deep clone, replacement validates every record before mutation, and a completed save survives construction of a second E2E repository over the same Storage object:

```ts
it('restores a saved unfinished session from the same browser storage', async () => {
  const storage = new MemoryStorage();
  const first = new E2EProgressRepository(storage);
  await first.saveSession(session({ sessionId: 'resume-me', questionCursor: 1 }));

  const second = new E2EProgressRepository(storage);

  await expect(second.loadResumableSession(
    'learner-1', 'us-states', '2026-09-01T01:00:00.000Z',
  )).resolves.toMatchObject({ sessionId: 'resume-me', questionCursor: 1 });
});
```

- [ ] **Step 3: Run RED for the missing repository**

Run:

```powershell
pnpm exec vitest run src/persistence/InMemoryProgressRepository.test.ts src/e2e/E2EProgressRepository.test.ts
```

Expected: FAIL because `InMemoryProgressState` and `E2EProgressRepository` do not exist.

- [ ] **Step 4: Implement clone-safe state import/export and persistent mutation**

Use this state shape:

```ts
export type InMemoryProgressState = Readonly<{
  mastery: readonly MasteryRecord[];
  attempts: readonly AttemptEvent[];
  sessions: readonly PracticeSession[];
  settings: AppSettings;
}>;
```

`replaceState` builds a new validated `InMemoryProgressRepository`, awaits every item through existing public save methods, and swaps state only after validation succeeds. `E2EProgressRepository` serializes `exportState()` after `saveAttempt`, `saveSession`, and `saveSettings`; `failNextAttemptSave()` throws once before any inner mutation.

- [ ] **Step 5: Write failing backup adapter tests**

Cover valid inspect-without-mutation, merge preserving current settings by default, replace replacing settings, corrupt inspection rejection, consumed staging IDs, and import failure leaving repository state unchanged:

```ts
await commands.inspectBackup();
await commands.importBackup({ stagingId: 'stage-1', mode: 'merge', includeSettings: false });
expect((await repository.loadSettings()).audio.enabled).toBe(current.audio.enabled);
```

- [ ] **Step 6: Run backup RED and implement with the real merge function**

Run `pnpm exec vitest run src/e2e/E2EBackupCommands.test.ts` and confirm the missing-module failure. Implement `E2EBackupCommands` so it converts stored sessions to `BackupSessionRecord` with the adapter clock as `savedAt`, merge calls `mergeBackupRecords`, replace validates then awaits `replaceState`, and corrupt inspection throws before creating a staging ID.

- [ ] **Step 7: Write failing deterministic control tests**

Assert the five requested question kinds are returned in order, IDs and timestamps are deterministic, control methods mutate only E2E state, and the update handle records download/install actions without native IPC.

```ts
control.setQuestionKinds([
  'locate_region', 'identify_region', 'associate_capital', 'locate_place', 'identify_place',
]);
expect(dependencies.planSession(input).questions.map(question => question.kind)).toEqual([
  'locate_region', 'identify_region', 'associate_capital', 'locate_place', 'identify_place',
]);
```

- [ ] **Step 8: Run control RED and implement the E2E mode selector**

Run `pnpm exec vitest run src/e2e/createE2EDependencies.test.ts`. Then implement `createE2EDependencies`, declare `Window.__GEOLEARN_E2E__`, and select it only in Vite mode `e2e`. Add:

```json
"build:e2e": "tsc && vite build --mode e2e"
```

Set Playwright's web server command to `pnpm build:e2e && pnpm preview --host 127.0.0.1 --port 4173 --strictPort`.

- [ ] **Step 9: Run GREEN and confirm the normal build has no control global**

Run:

```powershell
pnpm exec vitest run src/persistence/InMemoryProgressRepository.test.ts src/e2e
pnpm typecheck
pnpm build
```

Expected: tests/typecheck/build exit 0. Search `dist` for `__GEOLEARN_E2E__`; normal build must not contain it.

- [ ] **Step 10: Commit the isolated E2E transport boundary**

```powershell
git add package.json playwright.config.ts src/main.tsx src/vite-env.d.ts src/app/dependencies.ts src/persistence src/e2e
git commit -m "test: add persistent browser acceptance adapters"
```

---

### Task 3: Cover the complete learning, navigation, save, and restart journeys

**Files:**
- Create: `e2e/helpers/app.ts`
- Create: `e2e/practice-flow.spec.ts`
- Create: `e2e/navigation-flow.spec.ts`
- Remove after equivalent coverage exists: `e2e/app-flow.spec.ts`

**Interfaces:**
- Consumes: `window.__GEOLEARN_E2E__`, role-based application UI, and all five `Skill` values.
- Produces: reusable `openPackCard`, `answerWrong`, `answerCorrect`, `continueIntroduction`, and `finishQuestion` helpers with no CSS-class selectors.

- [ ] **Step 1: Write the failing primary learning journey**

The test must assert this exact observable sequence:

```ts
test('smart practice introduces, corrects, delays a retry, and summarizes', async ({ page }) => {
  await resetE2E(page);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await expect(page.getByText('认识 1/1')).toBeVisible();
  await page.getByRole('button', { name: '继续认识' }).click();
  await answerWrong(page);
  await expect(page.getByText('再试一次')).toBeVisible();
  await page.getByRole('button', { name: /提示/ }).click();
  await answerWrong(page);
  await expect(page.getByText('答案已揭示')).toBeVisible();
  await finishRemainingQuestions(page);
  await expect(page.getByRole('heading', { name: '本次总结' })).toBeVisible();
  expect(await delayedRetryDistance(page)).toBeGreaterThanOrEqual(3);
});
```

- [ ] **Step 2: Run RED and inspect the first real failure**

Run `pnpm exec playwright test e2e/practice-flow.spec.ts`.

Expected: FAIL on the first missing helper/control or product behavior, not because of a selector typo.

- [ ] **Step 3: Add only the deterministic data required for GREEN**

Use the existing production reducer, hints, mastery update, delayed-retry insertion, and summary. E2E planning supplies entity/kind order only; do not implement alternate answer or retry rules in the harness.

- [ ] **Step 4: Add save failure and recovery to the real page flow**

Before submitting the reveal attempt, call `failNextAttemptSave()`. Assert feedback stays visible, Continue is disabled, `重试保存` succeeds, and the same attempt ID is not duplicated in `readState()`.

- [ ] **Step 5: Add restart restoration**

Start a session, persist one introduction/question transition, call `page.reload()`, and assert the pack card exposes `继续上次练习`. Resume and assert the prior cursor, rather than a new session, is displayed.

- [ ] **Step 6: Add placement, custom, explore, and pause-stack tests**

Cover actual placement entry; custom entity/skill/status/count selection; explore entity selection followed by `练习这个地点`; and this Esc sequence:

```text
practice --Esc--> pause --Options--> options --Esc--> pause --Esc--> practice
```

Assert focus is trapped/returned at each overlay and no shortcut leaks into the underlying practice screen.

- [ ] **Step 7: Run the focused Playwright suite GREEN**

Run:

```powershell
pnpm exec playwright test e2e/practice-flow.spec.ts e2e/navigation-flow.spec.ts
```

Expected: all journeys pass twice consecutively without changing deterministic fixture data.

- [ ] **Step 8: Remove the superseded shallow flow and commit**

Delete `e2e/app-flow.spec.ts` only after its export and saved-attempt assertions exist in the new suites.

```powershell
git add e2e src/e2e
git commit -m "test: exercise complete browser learning journeys"
```

---

### Task 4: Cover backup, keyboard, IME, focus, zoom, and reduced motion

**Files:**
- Create: `e2e/backup-flow.spec.ts`
- Create: `e2e/accessibility.spec.ts`
- Modify if a failing test proves a product defect: `src/practice/PracticeScreen.tsx`
- Modify if a failing test proves a product defect: `src/map/MapViewport.tsx`
- Modify if a failing test proves a product defect: `src/app/product.css`
- Modify if a failing test proves a product defect: `src/ui/global.css`

**Interfaces:**
- Consumes: E2E backup scenario and question-kind controls.
- Produces: `assertVisibleFocus(locator)` and `dispatchIME(text)` helpers.

- [ ] **Step 1: Write backup RED cases**

Test export status, valid merge without settings, merge with settings, confirmed replace, corrupt inspection rejection, and post-import refresh failure/retry. After each rejected/cancelled operation, compare `readState()` before and after for deep equality.

- [ ] **Step 2: Run backup RED and repair the specific failing contract**

Run `pnpm exec playwright test e2e/backup-flow.spec.ts`. Fix adapter or product behavior with a focused Vitest regression first whenever the failure is not purely E2E wiring.

- [ ] **Step 3: Write parameterized five-kind keyboard tests**

For each of:

```ts
['locate_region', 'identify_region', 'associate_capital', 'locate_place', 'identify_place'] as const
```

assert a mouse-free answer route, the documented Space/Enter behavior, H outside editable inputs, 1–4 only for choices, arrow-key map navigation, accessible name/state, and visible focus.

- [ ] **Step 4: Write a real composition-event test**

Dispatch `compositionstart`, input `北`, press Enter while composing, assert no submission, dispatch `compositionend` with `北京`, then press Enter and assert one submission. Do not simulate IME solely with `fill()`.

- [ ] **Step 5: Write 200% and reduced-motion tests**

At 1024x700, call `page.evaluate(() => { document.documentElement.style.zoom = '2'; })`, finish one map and one text question, and assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`. Emulate `reducedMotion: 'reduce'` and assert computed answer/reveal animations have zero motion duration while text/icon/outline feedback remains.

- [ ] **Step 6: Run RED, repair through TDD, and run GREEN**

For each discovered defect: add a focused component test, watch it fail, make the minimal product change, pass the focused test, then rerun:

```powershell
pnpm exec vitest run src/practice src/map src/app
pnpm exec playwright test e2e/backup-flow.spec.ts e2e/accessibility.spec.ts
```

- [ ] **Step 7: Commit accessibility and data acceptance**

```powershell
git add e2e src/app src/map src/practice src/ui
git commit -m "test: qualify data and accessible input flows"
```

---

### Task 5: Enforce offline operation and performance thresholds

**Files:**
- Create: `src/app/performance.ts`
- Create: `src/app/performance.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/practice/PracticeScreen.tsx`
- Create: `e2e/offline-performance.spec.ts`
- Create: `scripts/check-offline.ps1`
- Create: `scripts/release/offline-scan.test.mjs`
- Modify: `e2e/release-smoke.spec.ts`

**Interfaces:**
- Produces: `PERFORMANCE_THRESHOLDS` and marks `geo:home-ready`, `geo:answer-submitted`, `geo:feedback-visible`, `geo:continue-requested`, `geo:question-ready`.
- Produces: offline scanner exit 0 only when packaged runtime URLs are local except the exact updater endpoint.

- [ ] **Step 1: Write performance-mark unit RED**

Assert marks are monotonic, SSR/jsdom absence of `performance.mark` is safe, feedback duration is `geo:feedback-visible - geo:answer-submitted`, question-transition duration is `geo:question-ready - geo:continue-requested`, and constants are exactly:

```ts
export const PERFORMANCE_THRESHOLDS = Object.freeze({
  coldStartMs: 2_000,
  feedbackMs: 100,
  questionTransitionMs: 200,
  mapFrameMs: 20,
});
```

- [ ] **Step 2: Run RED and add minimal instrumentation**

Run `pnpm exec vitest run src/app/performance.test.ts`. Add marks after the home heading is operable, after feedback commits to the DOM, and after the next prompt/actions are operable. Marks observe UI readiness; they do not drive state.

- [ ] **Step 3: Write browser timing gates**

Read the marks through `performance.getEntriesByName`. For map frames, collect 120 consecutive `requestAnimationFrame` deltas during keyboard pan/zoom and require the sustained-window p95 to be at most 20 ms. Attach the raw samples to the Playwright report on both pass and failure.

- [ ] **Step 4: Write the denied-network journey**

Allow only the Playwright preview origin, abort every external request, reload the page, start and complete learning, save progress, and export through the E2E adapter. This models Tauri's bundled local assets while denying the public network. Assert the only user-visible network error arises after an explicit update check. The current-user smoke separately disables the real network adapter before a native restart.

- [ ] **Step 5: Write offline scanner RED fixtures**

Create synthetic bundle fixtures containing a remote font, remote map, arbitrary API, and the exact GitHub updater endpoint. Expect the first three to fail and the updater-only fixture to pass.

- [ ] **Step 6: Implement the scanner without modifying the firewall**

`scripts/check-offline.ps1` parses `dist/index.html` and emitted CSS for remote scripts, styles, imports, fonts, images, and `url(...)`; scans runtime source outside `_provenance` for `fetch`, `XMLHttpRequest`, `WebSocket`, and `EventSource`; and parses updater endpoints from `tauri.conf.json`. Source-ledger citation URLs are data and are not treated as runtime requests. Reject every runtime remote endpoint except:

```text
https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json
```

It does not change Windows firewall rules. Actual network-disable behavior remains the current-user smoke step.

- [ ] **Step 7: Run focused GREEN three times**

Run:

```powershell
pnpm exec vitest run src/app/performance.test.ts scripts/release/offline-scan.test.mjs
pnpm exec playwright test e2e/offline-performance.spec.ts e2e/release-smoke.spec.ts
pnpm exec playwright test e2e/offline-performance.spec.ts
pnpm exec playwright test e2e/offline-performance.spec.ts
```

Expected: all runs pass; retained reports contain raw timing samples and no external-request list.

- [ ] **Step 8: Commit offline and timing gates**

```powershell
git add src/app src/practice e2e scripts/check-offline.ps1 scripts/release/offline-scan.test.mjs
git commit -m "test: enforce offline and performance release gates"
```

---

### Task 6: Support immutable RC/stable identities and four verified assets

**Files:**
- Create: `scripts/release/version-lib.mjs`
- Create: `scripts/release/set-version.mjs`
- Create: `scripts/release/version.test.mjs`
- Modify: `scripts/release/lib.mjs`
- Modify: `scripts/release/prepare-artifacts.mjs`
- Modify: `scripts/release/publish-lib.mjs`
- Modify: `scripts/release/publish-draft.mjs`
- Create: `scripts/release/promote-release.mjs`
- Modify: `scripts/release/release.test.mjs`

**Interfaces:**
- Produces: `parseReleaseTag(ref) -> { version, tag, channel: 'candidate' | 'stable' }`.
- Produces: `setVersion(root, version)` updating `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and the root package entry in `src-tauri/Cargo.lock`.
- Produces: four assets: `.exe`, `.exe.sig`, `latest.json`, `SHA256SUMS.txt`.
- Produces: promotion that maps candidate to `draft=false, prerelease=true` and stable to `draft=false, prerelease=false, make_latest=true`.

- [ ] **Step 1: Write version synchronization RED**

Accept `0.1.0-rc.1`, `0.1.0-rc.2`, and `0.1.0`; reject `rc.0`, leading zeros, arbitrary prerelease names, build metadata, path/shell characters, and any mismatched file. Assert a failed write leaves all four files byte-for-byte unchanged.

- [ ] **Step 2: Run RED and implement validated atomic updates**

Run `pnpm exec vitest run scripts/release/version.test.mjs`. Parse before writing; create same-directory temporary files with exclusive creation; rename only after all outputs are ready; clean temporary files on failure.

- [ ] **Step 3: Write release identity and asset RED**

Change existing tests so `refs/tags/v0.1.0-rc.1` is a candidate, `refs/tags/v0.1.0` is stable, and asset preparation expects:

```text
GeoLearn_<version>_x64-setup.exe
GeoLearn_<version>_x64-setup.exe.sig
latest.json
SHA256SUMS.txt
```

`SHA256SUMS.txt` contains lowercase SHA-256 for the other three assets, sorted by ASCII filename.

- [ ] **Step 4: Run release RED and implement identity/checksum changes**

Run `pnpm exec vitest run scripts/release/release.test.mjs`. Update notes to the approved personal-use/current-user scope; remove the stale statement that human map review is required for this personal release without marking that review complete.

- [ ] **Step 5: Write immutable promotion RED**

Mock the GitHub API and assert promotion refuses missing/different assets, published Releases, tag/version mismatch, candidate-as-stable, stable-as-prerelease, malformed API responses, and any checksum mismatch. Assert no mutating API call occurs after a failed inspection.

- [ ] **Step 6: Implement controlled promotion**

`promote-release.mjs` accepts no free-form URL or tag argument. It derives the tag from `GITHUB_REF`, inspects the existing draft and its four assets, and performs one PATCH only after all checks pass. It runs only in a manually dispatched GitHub Actions job at the selected tag, with the automatic `GITHUB_TOKEN` scoped to that job.

- [ ] **Step 7: Run release GREEN and commit**

```powershell
pnpm exec vitest run scripts/release/version.test.mjs scripts/release/release.test.mjs
pnpm typecheck
```

```powershell
git add scripts/release
git commit -m "build: harden candidate and stable release assets"
```

---

### Task 7: Generate notices and machine-readable gate evidence

**Files:**
- Create: `scripts/release/notices-lib.mjs`
- Create: `scripts/release/generate-notices.mjs`
- Create: `scripts/release/notices.test.mjs`
- Create: `scripts/release/evidence-lib.mjs`
- Create: `scripts/release/write-gate-evidence.mjs`
- Create: `scripts/release/evidence.test.mjs`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `package.json`

**Interfaces:**
- Produces: `pnpm release:notices` and `pnpm release:notices -- --check`.
- Produces: `release-evidence/quality-gates.json` containing commit, ref, run ID/URL, runner OS/image, tool versions, nine commands, and status `passed` only after the workflow reaches the evidence step.

- [ ] **Step 1: Write deterministic notices RED fixtures**

Pass synthetic pnpm-license and Cargo-metadata JSON directly to `generateNotices`. Assert ASCII sorting, SPDX/license text preservation, duplicate package-version collapse, missing-license failure, all direct production dependencies present, and fixed sections for bundled SQLite, original audio, and three content packs.

- [ ] **Step 2: Run RED and implement pure notice generation**

Run `pnpm exec vitest run scripts/release/notices.test.mjs`. Keep subprocess calls in the CLI wrapper with `shell: false`; the pure generator receives parsed JSON. Redact filesystem paths and reject dependency entries without a name, version, or license expression.

- [ ] **Step 3: Generate and check the committed notices**

Run:

```powershell
pnpm release:notices
pnpm release:notices -- --check
```

Expected: the second command exits 0 and `THIRD_PARTY_NOTICES.md` contains Node, Rust, SQLite, audio, and content sections.

- [ ] **Step 4: Write gate-evidence RED**

Assert missing GitHub variables, non-tag refs, duplicate/missing gate IDs, any non-passed gate, or personal paths fail. A complete fixed environment serializes deterministic JSON with these nine exact command strings.

- [ ] **Step 5: Run RED and implement evidence serialization**

Run `pnpm exec vitest run scripts/release/evidence.test.mjs`. The CLI creates a new `release-evidence` directory and refuses stale files. It never reads or writes signing-secret environment variables.

- [ ] **Step 6: Run GREEN and commit**

```powershell
pnpm exec vitest run scripts/release/notices.test.mjs scripts/release/evidence.test.mjs
pnpm release:notices -- --check
```

```powershell
git add package.json scripts/release THIRD_PARTY_NOTICES.md
git commit -m "docs: generate dependency notices and release evidence"
```

---

### Task 8: Make Windows CI execute the exact release gates before signing

**Files:**
- Modify: `.github/workflows/quality.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `scripts/release/workflow.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nine exact commands, four release assets, notice check, signature verifier, and evidence writer.
- Produces: downloadable Actions artifacts `windows-x64-release` and `windows-v1-evidence`; draft GitHub Release only after all prerequisites pass.

- [ ] **Step 1: Write workflow RED for the exact commands and ordering**

Replace `arrayContaining` with exact ordered equality:

```js
expect(qualityCommands).toEqual([
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test -- --run --coverage',
  'pnpm exec playwright test',
  'pnpm build',
  'cargo fmt --manifest-path src-tauri/Cargo.toml -- --check',
  'cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
  'cargo test --manifest-path src-tauri/Cargo.toml',
  'pnpm content:validate -- --all',
]);
```

Also assert Rust 1.98 is selected as the job default before these commands, Chromium is installed before Playwright, the notice check precedes signing, evidence is written only after QG-09, and release waits on the quality job.

- [ ] **Step 2: Run workflow RED**

Run `pnpm exec vitest run scripts/release/workflow.test.mjs`.

Expected: FAIL because the current workflow uses different Vitest/Cargo commands, omits content validation from the quality job, and knows only three assets.

- [ ] **Step 3: Implement the exact Windows quality job**

Set `RUSTUP_TOOLCHAIN=1.98.0-x86_64-pc-windows-msvc` after installing rustfmt/clippy and the MSVC target, then execute the nine commands verbatim as distinct steps. Do not use `continue-on-error`. Upload coverage, Playwright report/traces, and `quality-gates.json` with `if-no-files-found: error`.

- [ ] **Step 4: Update signing and draft upload**

On a tag push, after `needs: [tests]`, re-run preflight with Secrets, check notices, build/sign NSIS, run the Rust verifier, prepare four assets, validate `SHA256SUMS.txt`, upload the four-asset Actions artifact, and create a draft. Signing Secrets exist only on preflight and build steps; `GITHUB_TOKEN` exists only on draft creation. On `workflow_dispatch` at an existing tag, skip build/draft jobs and run a separate promotion job that re-inspects the draft and uses only the automatic `GITHUB_TOKEN`.

- [ ] **Step 5: Align ordinary quality CI without weakening the release job**

Keep PR/main quality useful on Windows and macOS, but ensure the Windows leg includes Playwright, Rust tests, coverage, and content validation. The tag release workflow remains the authoritative exact nine-command evidence.

- [ ] **Step 6: Run workflow GREEN and all release tooling tests**

```powershell
pnpm exec vitest run scripts/release
pnpm typecheck
pnpm lint
git diff --check
```

- [ ] **Step 7: Commit CI qualification**

```powershell
git add .github .gitignore scripts/release
git commit -m "ci: gate signed Windows release artifacts"
```

---

### Task 9: Run the complete local qualification and prepare the reviewed branch

**Files:**
- Modify with fresh evidence only: `docs/release/windows-v1-checklist.md`
- Modify: `handover.md`

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: clean reviewed branch ready for the explicit remote authorization checkpoint.

- [ ] **Step 1: Run the nine commands separately and capture exit codes**

Run exactly:

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

Record local exits exactly. The known missing `link.exe` may leave QG-07/QG-08 locally blocked; do not mark them passed. All nine must later show exit 0 in the Windows CI run.

- [ ] **Step 2: Run security and artifact dry checks**

Run notice freshness, offline scan, release preflight against a synthetic RC tag environment, `git diff --check`, secret-pattern scans, and ensure `release-artifacts`, `release-evidence`, private keys, `.env`, coverage, and test traces are ignored or deliberately uploaded only by CI.

- [ ] **Step 3: Review every changed requirement against the approved design**

Check off each design section and ensure no automated browser result is labeled native, no current-user result exists before installation, and handover contains the newly introduced boundaries.

- [ ] **Step 4: Commit implementation qualification without claiming release success**

```powershell
git add e2e src scripts .github package.json pnpm-lock.yaml THIRD_PARTY_NOTICES.md docs/release handover.md
git commit -m "test: add Windows v1 release qualification gates"
```

- [ ] **Step 5: Stop at the remote mutation gate**

Report local evidence and blockers. Ask explicitly for authorization to restore GitHub authentication, push `codex/user-test-mvp`, create the candidate version commit/tag, and run the release workflow. Do not push or tag in the same turn before approval.

---

### Task 10: Build, publish, install, and smoke the candidate after authorization

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify with observed results: `docs/release/windows-v1-checklist.md`
- Modify with observed results: `docs/release/windows-v1-smoke.md`
- Modify: `handover.md`

**Interfaces:**
- Produces: immutable candidate tag/Release, four downloadable assets, Windows CI evidence, and current-user candidate smoke record.

- [ ] **Step 1: Restore normal GitHub authentication and verify scope**

Use interactive `gh auth login` for `liafbkt`; verify repository read/write and Actions access without printing a token. Read existing tags/Releases/Secrets names before mutation. Never overwrite a tag, Release, or signing Secret.

- [ ] **Step 2: Push the reviewed branch**

Push `codex/user-test-mvp` to `origin` and record the remote commit URL in the checklist/handover.

- [ ] **Step 3: Prepare the next unused RC version**

Start with `0.1.0-rc.1`; if it already exists, inspect why and select the next unused positive RC number. Run:

```powershell
node scripts/release/set-version.mjs 0.1.0-rc.1
pnpm typecheck
pnpm exec vitest run scripts/release
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: prepare v0.1.0-rc.1"
git tag -a v0.1.0-rc.1 -m "Windows v1 candidate 1"
```

- [ ] **Step 4: Push the version commit and tag, then wait for Windows CI**

Push the branch and the one explicit tag. Wait for the release workflow to finish. Inspect all nine command steps, downloaded Actions artifacts, signature-verifier output, and draft assets. Any nonzero step returns to TDD repair and a new RC; it does not get waived.

- [ ] **Step 5: Obtain explicit candidate-promotion authorization and promote the draft**

After authorization, manually dispatch the release workflow at the candidate tag. The promotion job uses the automatic `GITHUB_TOKEN`; no token is copied to a terminal. Confirm the Release is `prerelease=true`, `draft=false`, and not GitHub latest.

- [ ] **Step 6: Download and hash the candidate**

Download all four assets from the tag-specific Release URLs, verify `SHA256SUMS.txt`, and run the committed Rust verifier/CI evidence check. Record Release URL, CI URL, names, sizes, and hashes before executing the installer.

- [ ] **Step 7: Obtain explicit installer authorization and protect current data**

Read the current installation/app-data state. If the app launches and data exists, export a native backup first. Do not rename, delete, or chmod the real database to manufacture a failure.

- [ ] **Step 8: Install and perform `SMOKE-C-*` with the current user**

The user is the witness. Record direct observations for NSIS installation, first launch, actual Chinese IME, SQLite creation, all learning/navigation/accessibility flows, restart recovery, native backup round-trip, offline learning, timing, uninstall/reinstall behavior, and current WebView2 state.

- [ ] **Step 9: Repair any failure as a new RC**

For code defects, reproduce with a failing automated test, repair, run the full local gates, increment RC, and repeat Tasks 10.3–10.8. Preserve every failed run and candidate in the ledger.

- [ ] **Step 10: Commit and push candidate evidence**

```powershell
git add docs/release/windows-v1-checklist.md docs/release/windows-v1-smoke.md handover.md
git commit -m "docs: record Windows v1 candidate smoke"
git push origin codex/user-test-mvp
```

Stop and ask for explicit stable-publication authorization.

---

### Task 11: Publish stable v0.1.0, prove signed update, and close handover

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `docs/release/windows-v1-checklist.md`
- Modify: `docs/release/windows-v1-smoke.md`
- Modify: `handover.md`

**Interfaces:**
- Consumes: passing installed RC, stable-publication authorization, signing Secrets, latest endpoint.
- Produces: stable `v0.1.0`, successful candidate-to-stable update, actual Release/CI/assets evidence, and final qualification commit.

- [ ] **Step 1: Prepare stable version after authorization**

```powershell
node scripts/release/set-version.mjs 0.1.0
pnpm typecheck
pnpm exec vitest run scripts/release
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "build: prepare v0.1.0"
git tag -a v0.1.0 -m "Windows v1 personal release"
```

- [ ] **Step 2: Push and require a fresh all-green Windows release workflow**

Push branch/tag, wait for CI, and verify every QG step is exit 0. Download Actions artifacts and validate signature and checksum evidence independently before promotion.

- [ ] **Step 3: Promote stable and audit GitHub latest**

After the final promotion checkpoint, manually dispatch the release workflow at `v0.1.0`; its promotion job sets `draft=false`, `prerelease=false`, `make_latest=true`. Verify:

```text
/releases/tag/v0.1.0
/releases/latest
/releases/latest/download/latest.json
```

all resolve to the stable Release/manifest and the Release exposes exactly the required four assets.

- [ ] **Step 4: Prove the installed candidate detects and verifies stable**

From the installed RC UI, run explicit update check. Record detected `0.1.0`, download progress, `更新已下载并通过校验`, passive installer launch, final process launch, and displayed final version. If signature verification fails, do not bypass it or run the downloaded installer manually as a substitute.

- [ ] **Step 5: Complete post-update native observations**

Verify prior progress, settings, resumable state, SQLite, and backup behavior. Perform final uninstall/reinstall only after confirming a current backup, then record whether application data remains. Mark each `SMOKE-U-*` with timestamped observation.

- [ ] **Step 6: Re-audit Release assets and CI evidence**

Record actual Release link, tag commit, workflow run link, runner image, nine exit-0 commands, asset names/sizes/SHA-256, `latest.json` platform URL/signature relationship, and direct download status. Do not cite only the workflow source.

- [ ] **Step 7: Compress the handover without erasing limitations**

Keep only current architecture/evidence and short historical references. State that Windows 10 current-user smoke passed only for steps with recorded observations; Windows 11, clean OS, and missing WebView2 remain untested manually; personal-use map compliance is out of scope and unchecked.

- [ ] **Step 8: Run final repository verification before the completion claim**

Run fresh local feasible gates, validate docs/asset links, `git diff --check`, and `git status --short`. Re-read the approved design line by line and confirm every in-scope requirement maps to a recorded result.

- [ ] **Step 9: Create the required final commit and push it**

```powershell
git add docs/release/windows-v1-checklist.md docs/release/windows-v1-smoke.md handover.md
git commit -m "test: qualify the Windows v1 release"
git push origin codex/user-test-mvp
```

- [ ] **Step 10: Return the actual evidence**

Return the stable Release link, candidate Release link, CI run links, exact four asset names/hashes, current-user smoke summary, failed/repaired RC history, final commit ID, and explicit unverified boundaries. Only then mark the first version complete.

---

## Plan self-review checklist

- Every approved design requirement maps to Tasks 1–11.
- All production behavior changes start from an observed failing test.
- Browser transport, native transport, and current-user evidence are never conflated.
- The exact nine commands appear verbatim and must exit 0 on the Windows runner.
- Candidate/stable versions, tags, Releases, and assets are immutable.
- Four assets include NSIS, signature, latest JSON, and SHA-256 manifest.
- Every remote/destructive action has an explicit authorization checkpoint.
- Handover changes at boundary creation, candidate evidence, and stable closure.
- The final commit message is exact.

## Execution handoff

This plan can be executed in one of two ways:

1. **Inline execution (recommended for this thread):** use `executing-plans`, implement Tasks 1–9 locally with review checkpoints, stop for remote authorization, then perform Tasks 10–11 with the user as current-account witness.
2. **Subagent-driven execution:** only if the user explicitly requests agent delegation; use `subagent-driven-development` with specification and quality review per task.

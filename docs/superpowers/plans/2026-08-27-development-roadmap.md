# Spatial Memory Coach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete offline Windows/macOS MVP described in `docs/superpowers/specs/2026-08-27-spatial-memory-coach-design.md`.

**Architecture:** Use a Tauri 2 modular monolith: React/TypeScript owns content validation, learning rules, session state and SVG presentation; narrow Rust commands own SQLite transactions, resource/file access and backup containers. Every feature depends on explicit domain interfaces so pure in-memory adapters can exercise the entire learning flow before desktop integration.

**Tech Stack:** Tauri 2, React, TypeScript strict mode, Vite, pnpm, Vitest, Testing Library, Playwright, Zod, d3-geo, topojson-client, Rust, rusqlite with bundled SQLite, serde, zip.

## Global Constraints

- Target Windows 10 22H2/Windows 11 x64 and macOS 12+ arm64/x86_64.
- Core learning, maps, scheduling, progress and backup must work without network access.
- Default smart session is 12 base questions and may extend to 15 for legal delayed retries; a single question type is at most 50%; 4–6 new places; fragile content is at most 25%.
- UI copy is Simplified Chinese; content introductions and reveals show Chinese and English names.
- Non-input questions use Space for check/continue; input questions use Enter; H requests a hint only outside editable inputs; IME composition takes precedence; Esc controls the pause stack.
- Practice layout is 62% map and 38% fixed marine-mist panel at 860 CSS px or wider, then stacks vertically with a sticky action row.
- China and Shanghai content must preserve official source, processing and review metadata; public distribution is blocked until human compliance review.
- TypeScript uses `strict`; no unexplained `any`, non-null assertion, SQL in React, or learning rules in Rust commands.
- All feature work follows red-green-refactor, includes keyboard/reduced-motion coverage, and ends with a focused commit.

---

## Planned file map

```text
src/
  app/                 startup, page state, dependency assembly, error boundary
  audio/               original sound packs and playback settings
  content/             pack schema, validation, loading, migration
  explore/             exploration use cases and screens
  learning/            mastery, fragile status, scheduling, answers, hints
  map/                  projection, SVG layers, viewport and accessibility
  persistence/          domain repository ports and in-memory/Tauri adapters
  practice/             sessions, questions, reducer and practice screens
  ui/                   design tokens and reusable controls
src-tauri/
  migrations/           forward-only SQLite migrations
  src/                  narrow Tauri commands, database and backup modules
  resources/content/    validated built-in content packs
scripts/content/        reproducible content transformation and validation CLI
tests/e2e/              user journeys in web harness and packaged-app smoke
```

## Task 1: Tauri/React foundation and quality gates

**Files:**
- Create: `package.json`, `pnpm-lock.yaml`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/App.test.tsx`, `src/ui/tokens.css`, `src/ui/global.css`
- Create: `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`
- Create: `.github/workflows/quality.yml`

**Interfaces:**
- Consumes: the global constraints above.
- Produces: `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm tauri dev`; app identifier `com.kevin.spatialmemorycoach`.

- [ ] **Step 1: Scaffold the official React/TypeScript Tauri template**

Run `pnpm create tauri-app` in a temporary directory, choose project name `spatial-memory-coach`, identifier `com.kevin.spatialmemorycoach`, TypeScript, pnpm, React and TypeScript, then move only generated source/config files into the repository. Do not overwrite `handover.md`, `handover/` or `docs/`.

- [ ] **Step 2: Add runtime and test dependencies**

Run:

```powershell
pnpm add zod d3-geo topojson-client
pnpm add -D vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom eslint typescript-eslint @playwright/test
```

- [ ] **Step 3: Write the failing application-shell test**

```tsx
// src/app/App.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

it('renders the offline home heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
});
```

- [ ] **Step 4: Run the test and verify the red state**

Run: `pnpm vitest run src/app/App.test.tsx`

Expected: FAIL because `App` does not render the requested heading.

- [ ] **Step 5: Implement the minimum shell and token foundation**

```tsx
// src/app/App.tsx
import '../ui/tokens.css';
import '../ui/global.css';

export function App() {
  return <main><h1>选择学习范围</h1></main>;
}
```

Define token groups for marine-mist panel, cartographic grid, ink, hint, primary action, correct, incorrect, focus, spacing, radius, shadow, motion and reduced motion. Configure `strict: true`, `noUncheckedIndexedAccess: true` and `exactOptionalPropertyTypes: true`.

- [ ] **Step 6: Add CI gates and run them locally**

The workflow runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test -- --run`, `pnpm build`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` on Windows and macOS. Run the same commands locally; expected result is exit code 0 for each available host check.

- [ ] **Step 7: Commit the foundation**

```powershell
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts src src-tauri .github
git commit -m "build: scaffold spatial memory coach"
```

## Task 2: Versioned content contract

**Files:**
- Create: `src/content/types.ts`, `src/content/schema.ts`, `src/content/validatePack.ts`, `src/content/validatePack.test.ts`
- Create: `src/content/fixtures/minimal-pack.ts`

**Interfaces:**
- Consumes: Zod and TypeScript strict settings from Task 1.
- Produces: `ContentPack`, `Entity`, `PackCapabilities`, `PackValidationResult`, `validatePack(input: unknown): PackValidationResult`.

- [ ] **Step 1: Define a fixture that exercises region, capital and geometry references**

```ts
export const minimalPack = {
  manifest: {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    packId: 'fixture-pack',
    title: { zh: '测试包', en: 'Fixture Pack' },
    primaryAnswerLanguage: 'zh',
    expectedEntityCounts: { region: 1, place: 1 },
    capabilities: ['locate_region', 'identify_region', 'associate_capital', 'locate_place', 'identify_place'],
    defaultViewport: { center: [121.47, 31.23], scale: 9000 },
  },
  entities: [
    { id: 'region-a', kind: 'region', names: { zh: '甲区', en: 'Region A' }, aliases: [], capitalId: 'city-a' },
    { id: 'city-a', kind: 'place', names: { zh: '甲城', en: 'City A' }, aliases: [], coordinate: [121.47, 31.23] },
  ],
  topologyObjectIds: ['region-a'],
  sources: [{ id: 'fixture', organization: 'Test', url: 'https://example.invalid', retrievedAt: '2026-08-27', license: 'test-only', sha256: '0'.repeat(64), processing: [] }],
};
```

- [ ] **Step 2: Write failing validation tests**

Test that the fixture passes and that duplicate entity IDs, missing capital references, count mismatches, unsupported schema versions, absent English names and missing geometry references each return a typed issue with a stable code.

- [ ] **Step 3: Run the focused test**

Run: `pnpm vitest run src/content/validatePack.test.ts`

Expected: FAIL because `validatePack` is absent.

- [ ] **Step 4: Implement schemas and cross-reference validation**

```ts
export type PackValidationIssue = Readonly<{
  code: 'schema' | 'duplicate_id' | 'missing_reference' | 'count_mismatch' | 'missing_geometry' | 'capability_mismatch';
  path: string;
  message: string;
}>;

export type PackValidationResult =
  | Readonly<{ ok: true; pack: ContentPack }>
  | Readonly<{ ok: false; issues: readonly PackValidationIssue[] }>;
```

Parse structural fields with Zod, then run deterministic cross-reference checks. A failed pack never returns partially parsed entities.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/content/validatePack.test.ts`

Expected: all content contract tests PASS.

```powershell
git add src/content
git commit -m "feat: define versioned content pack contract"
```

## Task 3: Content resource loader and pack isolation

**Files:**
- Create: `src/content/ContentSource.ts`, `src/content/loadPacks.ts`, `src/content/loadPacks.test.ts`, `src/content/migrateContent.ts`, `src/content/migrateContent.test.ts`
- Create: `src/persistence/InMemoryContentSource.ts`, `src/persistence/TauriContentSource.ts`
- Create: `src-tauri/src/content.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: `validatePack` from Task 2.
- Produces: `ContentSource.readPackIds()`, `ContentSource.readJson(packId, fileName)`, `loadAvailablePacks(source)`, `migrateContentProgress` and Tauri command `read_content_resource`.

- [ ] **Step 1: Write loader isolation tests**

Create an in-memory source containing one valid fixture and one pack with a missing entity reference. Assert that `loadAvailablePacks` returns the valid pack under `available` and the invalid pack under `rejected` with its validation issues.

- [ ] **Step 2: Run the focused test and observe failure**

Run: `pnpm vitest run src/content/loadPacks.test.ts`

Expected: FAIL because the source interface and loader are absent.

- [ ] **Step 3: Implement the domain-facing source port**

```ts
export interface ContentSource {
  readPackIds(): Promise<readonly string[]>;
  readJson(packId: string, fileName: 'manifest.json' | 'entities.json' | 'sources.json' | 'map.topojson'): Promise<unknown>;
}
```

The loader combines the four resources, extracts TopoJSON object IDs, validates once, and never mutates the source payload.

- [ ] **Step 4: Implement the narrow Rust resource command**

`read_content_resource(pack_id, file_name)` must accept only the four allow-listed filenames, reject path separators and resolve within Tauri's bundled `resources/content` directory. Return a structured `{ code, message }` error; never expose an arbitrary filesystem path capability.

- [ ] **Step 5: Implement and test conservative content migration**

Given old/new manifests and an explicit migration ledger, assert unchanged stable IDs preserve mastery through renames and boundary-only updates; split/merge/level-change operations archive old mastery and create `new` records for replacement IDs. Reject an update that changes IDs without a declared migration operation.

- [ ] **Step 6: Verify malicious path handling and commit**

Run:

```powershell
pnpm vitest run src/content/loadPacks.test.ts src/content/migrateContent.test.ts
cargo test --manifest-path src-tauri/Cargo.toml content
```

Expected: valid/invalid pack isolation passes and `../settings.json` is rejected.

```powershell
git add src/content src/persistence src-tauri
git commit -m "feat: load and isolate bundled content packs"
```

## Task 4: Mastery stages and fragile status

**Files:**
- Create: `src/learning/types.ts`, `src/learning/updateMastery.ts`, `src/learning/updateMastery.test.ts`, `src/learning/fragile.ts`, `src/learning/fragile.test.ts`

**Interfaces:**
- Consumes: entity/skill IDs from Task 2.
- Produces: `MasteryRecord`, `AttemptOutcome`, `updateMastery(record, outcome, now)`, `isFragile(history, now)`.

- [ ] **Step 1: Encode the stage and interval table in tests**

```ts
const intervals = {
  new: 0,
  learning: 10 * 60_000,
  weak: 24 * 60 * 60_000,
  familiar: 3 * 24 * 60 * 60_000,
  solid: 7 * 24 * 60 * 60_000,
  mastered: 21 * 24 * 60 * 60_000,
} as const;
```

Test independent first-try promotion, hinted non-promotion, second-try non-promotion, failure demotion and the 90-day mastered cap.

- [ ] **Step 2: Run the red test**

Run: `pnpm vitest run src/learning/updateMastery.test.ts src/learning/fragile.test.ts`

Expected: FAIL because learning functions are absent.

- [ ] **Step 3: Implement pure immutable transitions**

```ts
export type MasteryStage = 'new' | 'learning' | 'weak' | 'familiar' | 'solid' | 'mastered';
export type Skill = 'locate_region' | 'identify_region' | 'associate_capital' | 'locate_place' | 'identify_place';

export type AttemptOutcome = Readonly<{
  correct: boolean;
  firstTry: boolean;
  usedHint: boolean;
  responseMs: number;
  completedAt: string;
}>;
```

Return new records only. Use response time solely as an exponentially smoothed tie-break value after correctness; never demote for slowness.

- [ ] **Step 4: Implement fragile thresholds**

Mark fragile after the record has reached `familiar` and two scheduled-review failures occur in the previous 30 days. Clear after three independent correct scheduled reviews separated by at least 24 hours.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/learning/updateMastery.test.ts src/learning/fragile.test.ts`

Expected: all transition and fragile tests PASS.

```powershell
git add src/learning
git commit -m "feat: add explainable mastery progression"
```

## Task 5: Answer normalization, hints and question generation

**Files:**
- Create: `src/learning/normalizeAnswer.ts`, `src/learning/normalizeAnswer.test.ts`
- Create: `src/learning/hints.ts`, `src/learning/hints.test.ts`
- Create: `src/learning/questions.ts`, `src/learning/questions.test.ts`

**Interfaces:**
- Consumes: `ContentPack`, `Entity`, `Skill`.
- Produces: `AnswerSpec`, `normalizeAnswer`, `isAcceptedAnswer`, `Hint`, `buildHint`, `Question` discriminated union, `generateQuestion`.

- [ ] **Step 1: Write normalization tests with real bilingual cases**

Assert that `上海市`, `上海`, `Shanghai`, `shanghai`, `New York`, `new-york` and declared aliases normalize as intended; `shang hai` is not accepted as an undeclared pinyin substitute for `上海`; `Los Angles` is rejected while `Los Angeles` is accepted.

- [ ] **Step 2: Write hint tests**

For map questions, compute one of eight compass sectors from selected and target centroids. For typed identification, reveal one Unicode grapheme or English initial. For choice questions, eliminate exactly one distractor that is not the correct answer.

- [ ] **Step 3: Run the red tests**

Run: `pnpm vitest run src/learning/normalizeAnswer.test.ts src/learning/hints.test.ts src/learning/questions.test.ts`

Expected: FAIL because the modules are absent.

- [ ] **Step 4: Implement discriminated questions**

```ts
export type Question =
  | Readonly<{ kind: 'locate_region'; entityId: string; promptName: string }>
  | Readonly<{ kind: 'identify_region'; entityId: string; answer: AnswerSpec; choices?: readonly string[] }>
  | Readonly<{ kind: 'associate_capital'; entityId: string; capitalId: string; choices?: readonly string[] }>
  | Readonly<{ kind: 'locate_place'; entityId: string; coordinate: readonly [number, number]; choices: readonly string[] }>
  | Readonly<{ kind: 'identify_place'; entityId: string; answer: AnswerSpec; choices?: readonly string[] }>;
```

Question generation must refuse capability/entity combinations that lack required geometry or relationships.

- [ ] **Step 5: Verify and commit**

Run: `pnpm vitest run src/learning/normalizeAnswer.test.ts src/learning/hints.test.ts src/learning/questions.test.ts`

Expected: all answer, hint and generation tests PASS.

```powershell
git add src/learning
git commit -m "feat: generate bilingual geography questions"
```

## Task 6: Smart-session scheduler and quick placement

**Files:**
- Create: `src/learning/scheduler.ts`, `src/learning/scheduler.test.ts`
- Create: `src/practice/session.ts`, `src/practice/session.test.ts`

**Interfaces:**
- Consumes: `ContentPack`, `MasteryRecord`, `Question`, fragile status.
- Produces: `SessionRequest`, `PracticeSession`, `scheduleSmartSession`, `schedulePlacement`, `insertDelayedRetry`.

- [ ] **Step 1: Write invariant-based scheduler tests**

Construct a deterministic fixture with overdue, weak, fragile, mastered and new records. Assert 12 base questions, at most 6 questions of one kind, at most 3 fragile questions, 4 new entities when normal review inventory exists, due-before-weak ordering, introductions excluded from the base count, delayed retry insertion 3–5 positions after reveal, a 15-question hard cap and carryover retry debt when the legal gap cannot fit.

- [ ] **Step 2: Add seeded randomness contract**

```ts
export interface RandomSource {
  next(): number;
}

export type SessionRequest = Readonly<{
  mode: 'smart' | 'custom' | 'placement';
  packId: string;
  questionCount: number;
  entityIds?: readonly string[];
  skills?: readonly Skill[];
}>;

export type PracticeSession = Readonly<{
  sessionId: string;
  learnerId: string;
  request: SessionRequest;
  baseQuestionCount: number;
  introductions: readonly string[];
  introductionCursor: number;
  questions: readonly Question[];
  questionCursor: number;
  carryoverRetryEntityIds: readonly string[];
  startedAt: string;
  accumulatedPauseMs: number;
}>;
```

All random ordering consumes `RandomSource`; production uses crypto randomness and tests use a fixed sequence.

- [ ] **Step 3: Run the red test**

Run: `pnpm vitest run src/learning/scheduler.test.ts src/practice/session.test.ts`

Expected: FAIL because scheduling functions are absent.

- [ ] **Step 4: Implement weighted queues and placement coverage**

Use separate due, weak, fragile, new and maintenance queues. Fill by priority while enforcing caps after each candidate insertion. Placement selects broad entity/skill coverage without hints or mastery penalties; its result seeds records no higher than `familiar`.

- [ ] **Step 5: Verify deterministic snapshots and commit**

Run: `pnpm vitest run src/learning/scheduler.test.ts src/practice/session.test.ts`

Expected: all invariants pass for at least 100 seeded schedules.

```powershell
git add src/learning src/practice
git commit -m "feat: schedule adaptive practice sessions"
```

## Task 7: Repository ports and atomic SQLite persistence

**Files:**
- Create: `src/persistence/ProgressRepository.ts`, `src/persistence/InMemoryProgressRepository.ts`, `src/persistence/InMemoryProgressRepository.test.ts`
- Create: `src/persistence/TauriProgressRepository.ts`
- Create: `src/app/settings.ts`
- Create: `src-tauri/migrations/0001_initial.sql`, `src-tauri/src/db.rs`, `src-tauri/src/progress.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: `MasteryRecord`, `AttemptOutcome`, `PracticeSession`.
- Produces: `AppSettings`, `ProgressRepository.loadSnapshot`, `saveAttempt`, `saveSession`, `loadResumableSession`; Tauri commands with typed DTOs.

- [ ] **Step 1: Define the repository contract and in-memory behavior tests**

```ts
export type SoundPackId = 'crisp' | 'soft' | 'minimal';
export type AudioSettings = Readonly<{ enabled: boolean; packId: SoundPackId; volume: number }>;
export type AppSettings = Readonly<{ audio: AudioSettings }>;

export interface ProgressRepository {
  loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]>;
  saveAttempt(input: Readonly<{ attemptId: string; session: PracticeSession; mastery: MasteryRecord; outcome: AttemptOutcome }>): Promise<void>;
  saveSession(session: PracticeSession): Promise<void>;
  loadResumableSession(learnerId: string, packId: string, now: string): Promise<PracticeSession | null>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
}
```

Assert attempt ID idempotency, per-question and introduction cursor updates, one-day resume limit, settings persistence and immutable returned snapshots.

- [ ] **Step 2: Run the red repository test**

Run: `pnpm vitest run src/persistence/InMemoryProgressRepository.test.ts`

Expected: FAIL because adapters are absent.

- [ ] **Step 3: Implement the in-memory adapter and pass tests**

Use maps keyed by learner/pack/entity/skill and clone values on read/write. Run the focused test and expect PASS before starting Rust.

- [ ] **Step 4: Write the forward-only SQLite migration**

Create tables `learner`, `mastery`, `attempt_event`, `practice_session`, `app_setting`, `content_migration` and `schema_migration`. Add unique constraints for mastery natural keys and attempt IDs; enable foreign keys; store timestamps as ISO-8601 UTC text.

- [ ] **Step 5: Implement Rust transaction tests**

Use an in-memory rusqlite connection. Assert `save_attempt` atomically inserts the attempt, upserts mastery and advances the session cursor; force the final update to fail and assert the first two writes roll back.

- [ ] **Step 6: Implement narrow Tauri commands**

Expose only `load_progress_snapshot`, `save_attempt_transaction`, `save_practice_session`, `load_resumable_session`, `load_settings` and `save_settings`. Deserialize DTOs with serde, validate IDs and timestamps, and map internal errors to stable codes. Do not expose generic SQL execution.

- [ ] **Step 7: Verify both adapters and commit**

Run:

```powershell
pnpm vitest run src/persistence/InMemoryProgressRepository.test.ts
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Expected: all persistence and rollback tests PASS; clippy exits 0.

```powershell
git add src/persistence src-tauri
git commit -m "feat: persist practice progress atomically"
```

## Task 8: Versioned backup export, merge and replacement

**Files:**
- Create: `src/persistence/backup.ts`, `src/persistence/backup.test.ts`
- Create: `src-tauri/src/backup.rs`, `src-tauri/tests/backup.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`

**Interfaces:**
- Consumes: persistence DTOs from Task 7.
- Produces: `BackupManifest`, `mergeBackupRecords`, Tauri commands `choose_and_export_backup`, `choose_and_inspect_backup`, `import_staged_backup`.

- [ ] **Step 1: Write merge-semantics tests**

```ts
export type BackupManifest = Readonly<{
  format: 'geolearn-backup';
  version: 1;
  exportedAt: string;
  learnerId: string;
  packVersions: Readonly<Record<string, string>>;
}>;
```

Assert newer mastery wins, equal timestamps prefer the record with more independent successes, attempts deduplicate by `attemptId`, and settings from the imported file apply only when explicitly requested.

- [ ] **Step 2: Run the red TypeScript test**

Run: `pnpm vitest run src/persistence/backup.test.ts`

Expected: FAIL because merge functions are absent.

- [ ] **Step 3: Implement and pass deterministic merges**

Sort output by natural keys so repeated imports produce byte-equivalent JSON. Run the focused test and expect PASS.

- [ ] **Step 4: Write Rust archive and rollback tests**

Create an in-memory ZIP with `manifest.json`, `progress.json`, `sessions.json` and `settings.json`. Test valid inspection, missing file, corrupt JSON, unsupported version, checksum mismatch, merge transaction rollback and replace transaction rollback.

- [ ] **Step 5: Implement safe native commands**

Add `tauri-plugin-dialog` on the Rust side. `choose_and_export_backup` opens the native save dialog itself, writes a temporary file, fsyncs and renames it to `.geolearn-backup`. `choose_and_inspect_backup` opens the picker itself, validates without writing and returns a summary plus a short-lived staging ID. `import_staged_backup` accepts only that ID, first creates an automatic safety backup, then applies `merge` or `replace` in one transaction. No command accepts an arbitrary frontend-supplied filesystem path.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
pnpm vitest run src/persistence/backup.test.ts
cargo test --manifest-path src-tauri/Cargo.toml backup
```

Expected: all merge, corruption and rollback cases PASS.

```powershell
git add src/persistence src-tauri
git commit -m "feat: add transactional progress backups"
```

## Task 9: Accessible SVG map engine

**Files:**
- Create: `src/map/types.ts`, `src/map/project.ts`, `src/map/project.test.ts`
- Create: `src/map/MapViewport.tsx`, `src/map/MapViewport.test.tsx`, `src/map/map.css`
- Create: `src/map/LabelLayer.tsx`, `src/map/HydroLayer.tsx`, `src/map/PlaceLayer.tsx`

**Interfaces:**
- Consumes: validated pack topology and entities from Tasks 2–3.
- Produces: `ProjectedMap`, `MapSelection`, `MapViewport` callbacks `onRegionSelect`, `onPlaceSelect`, `onViewportChange`.

- [ ] **Step 1: Write projection and hit-target tests**

Use the minimal pack topology. Assert a stable SVG path is produced, city coordinates project inside the view box, invalid geometry is rejected, and shared TopoJSON borders are rendered once.

- [ ] **Step 2: Write keyboard and label-strategy tests**

Render three regions and assert the map has one Tab stop, arrow keys move to the nearest centroid in the requested direction, Enter selects the active region, selected state is announced, quiz/first-retry mode hides answer labels, correct/reveal mode shows the answer, and explore mode can show all labels.

- [ ] **Step 3: Run red tests**

Run: `pnpm vitest run src/map`

Expected: FAIL because map modules are absent.

- [ ] **Step 4: Implement projection and stateless layers**

```ts
export type MapMode = 'quiz' | 'reveal' | 'explore';
export type MapSelection =
  | Readonly<{ kind: 'region'; entityId: string }>
  | Readonly<{ kind: 'place'; entityId: string }>;
```

Use `d3-geo` for projection and `topojson-client` for features/mesh. Cache projected geometry by `packId + contentVersion + viewportSize`; do not project during answer submission.

- [ ] **Step 5: Add pan/zoom and reduced-motion behavior**

Pointer drag pans, wheel/pinch zooms within pack limits, Home resets viewport, and focus remains on the selected entity after reveal. Reduced motion disables animated viewport interpolation and uses immediate state changes.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run src/map`

Expected: all projection, interaction, label and accessibility tests PASS.

```powershell
git add src/map
git commit -m "feat: render accessible offline geography maps"
```

## Task 10: Practice question state machine

**Files:**
- Create: `src/practice/reducer.ts`, `src/practice/reducer.test.ts`, `src/practice/actions.ts`, `src/practice/selectors.ts`

**Interfaces:**
- Consumes: `PracticeSession`, `Question`, hints, `updateMastery`, `ProgressRepository`.
- Produces: `PracticeState`, `PracticeAction`, `practiceReducer`, `commitCurrentAttempt` use case.

- [ ] **Step 1: Write state-transition tests for the full answer loop**

Test `presenting → answering → completed`, first error to `first_retry`, second error to `revealed`, active hint to non-promoting completion, delayed retry insertion, carryover retry debt when a legal 3–5 gap cannot fit under the 15-question cap, and refusal to submit without a selection.

- [ ] **Step 2: Encode actions as a closed union**

```ts
export type PracticeAction =
  | Readonly<{ type: 'INTRO_CONTINUED' }>
  | Readonly<{ type: 'ANSWER_SELECTED'; value: string }>
  | Readonly<{ type: 'ANSWER_TYPED'; value: string }>
  | Readonly<{ type: 'HINT_REQUESTED' }>
  | Readonly<{ type: 'ANSWER_SUBMITTED'; now: string }>
  | Readonly<{ type: 'ATTEMPT_SAVED'; attemptId: string }>
  | Readonly<{ type: 'ATTEMPT_SAVE_FAILED'; code: string }>
  | Readonly<{ type: 'CONTINUED' }>
  | Readonly<{ type: 'PAUSED'; now: string }>
  | Readonly<{ type: 'RESUMED'; now: string }>;
```

- [ ] **Step 3: Run the red test**

Run: `pnpm vitest run src/practice/reducer.test.ts`

Expected: FAIL because the reducer is absent.

- [ ] **Step 4: Implement pure transitions and persistence gating**

The reducer computes feedback immediately, then marks it `saving`. `commitCurrentAttempt` calls the repository transaction and dispatches `ATTEMPT_SAVED`; selectors disable continue until saved. Persistence failure keeps the current feedback visible and exposes retry.

- [ ] **Step 5: Verify exhaustive handling and commit**

Run:

```powershell
pnpm vitest run src/practice/reducer.test.ts
pnpm typecheck
```

Expected: all state paths PASS and TypeScript reports no unhandled union branch.

```powershell
git add src/practice
git commit -m "feat: model the practice answer lifecycle"
```

## Task 11: Five question views and unified controls

**Files:**
- Create: `src/practice/PracticeScreen.tsx`, `src/practice/PracticeScreen.test.tsx`, `src/practice/practice.css`
- Create: `src/practice/questions/LocateRegionQuestion.tsx`, `IdentifyRegionQuestion.tsx`, `AssociateCapitalQuestion.tsx`, `LocatePlaceQuestion.tsx`, `IdentifyPlaceQuestion.tsx`
- Create: `src/practice/PracticeActions.tsx`, `src/practice/FeedbackPanel.tsx`, `src/practice/IntroductionCard.tsx`

**Interfaces:**
- Consumes: reducer/selectors from Task 10 and `MapViewport` from Task 9.
- Produces: complete 62/38 practice screen with the fixed left Hint/right Check-or-Continue action row.

- [ ] **Step 1: Write parameterized component tests for all question kinds**

For each kind assert prompt rendering, pointer selection, valid submit, correct feedback, first-error hint without answer labels, second-error reveal and focus placement. Locate-region/locate-place use maps; identify/association questions use choices at `new/learning` and typed input from `weak`. Prompts/choices use the pack primary language and reveal is bilingual. For typed questions assert Space remains text input and Enter submits/continues.

- [ ] **Step 2: Write global shortcut tests**

Assert Space checks/continues non-input questions, H requests a hint only outside editable fields, 1–4 chooses a candidate, Enter handles typed questions, Esc opens pause, and shortcuts do not fire while a native dialog, answer input or IME composition has focus.

- [ ] **Step 3: Run red component tests**

Run: `pnpm vitest run src/practice/PracticeScreen.test.tsx`

Expected: FAIL because the screen components are absent.

- [ ] **Step 4: Implement the stable layout and controls**

At 860 CSS px and wider use Grid columns `minmax(0, 62fr) minmax(340px, 38fr)`. Below that breakpoint stack map then panel, allow vertical scrolling and keep the action row sticky without horizontal page overflow. Keep feedback inside the fixed panel. The action row uses an amber high-contrast hint button on the left and a marine-blue primary button on the right; the primary button includes a visible `Space` or `Enter` keycap.

- [ ] **Step 5: Implement original micro-feedback**

Use 180–240ms fill/stroke/transform transitions for ordinary answers and a separate session-complete animation. Add text/icon/outline feedback and a reduced-motion branch with no scale or shake.

- [ ] **Step 6: Verify 200% zoom and commit**

Run component tests, then use Playwright at 1024×700 with device scale factor 2 to assert prompt, map selection and both action buttons remain reachable without horizontal page scrolling.

```powershell
git add src/practice src/ui
git commit -m "feat: build responsive five-mode practice UI"
```

## Task 12: Application shell, pause stack and original audio packs

**Files:**
- Create: `src/app/AppState.ts`, `src/app/appReducer.ts`, `src/app/appReducer.test.ts`
- Create: `src/app/HomeScreen.tsx`, `src/app/PauseDialog.tsx`, `src/app/OptionsPanel.tsx`, `src/app/AppErrorBoundary.tsx`, `src/app/AppErrorBoundary.test.tsx`
- Create: `src/audio/types.ts`, `src/audio/AudioService.ts`, `src/audio/WebAudioService.ts`, `src/audio/AudioService.test.ts`
- Create: `src/audio/assets/crisp/`, `src/audio/assets/soft/`, `src/audio/assets/minimal/`

**Interfaces:**
- Consumes: content packs, sessions and practice screen.
- Produces: `AppState` page/pause stack, `AudioService`, persisted `AudioSettings`.

- [ ] **Step 1: Test the pause stack and reversible home navigation**

Assert practice Esc opens `pause`, pause Esc resumes, options Esc returns to pause without resuming, a second Esc resumes, window blur/minimize pauses and freezes response time, foreground return stays paused, and returning home waits for any in-flight save without confirmation.

- [ ] **Step 2: Test audio settings and graceful failure**

```ts
import type { AudioSettings, SoundPackId } from '../app/settings';

export interface AudioService {
  preload(packId: SoundPackId): Promise<void>;
  preview(packId: SoundPackId, volume: number): Promise<void>;
  play(event: 'correct' | 'incorrect' | 'hint' | 'reveal' | 'complete', settings: AudioSettings): Promise<void>;
}
```

Assert default `crisp` at volume `0.7`, preview on pack selection, no preview when disabled, volume clamp 0–1, the five specified event mappings and silent fallback after decode failure.

- [ ] **Step 3: Run red tests**

Run: `pnpm vitest run src/app/appReducer.test.ts src/app/AppErrorBoundary.test.tsx src/audio/AudioService.test.ts`

Expected: FAIL because state/audio modules are absent.

- [ ] **Step 4: Test the global error boundary**

Render a child that throws and assert the fallback offers restart and diagnostic export, uses a stable error code, omits personal filesystem paths and does not expose a stack trace in user-visible copy.

- [ ] **Step 5: Implement the centered pause card and options**

Dim and lightly blur practice behind the dialog. Menu actions are 继续, 选项, 返回主菜单. Options contain only 音效, 音效方案 and 音量. Persist settings immediately through `ProgressRepository` settings methods.

- [ ] **Step 6: Create and license original sound assets**

Generate short original tones in-repository or record them specifically for this project. Store a `LICENSE.md` beside each pack stating original authorship and prohibited use of copied Duolingo assets. Keep common-answer sounds under 250ms and session completion under 900ms.

- [ ] **Step 7: Verify and commit**

Run: `pnpm vitest run src/app src/audio`

Expected: pause, option and audio tests PASS including decode failure.

```powershell
git add src/app src/audio
git commit -m "feat: add pause controls and original feedback audio"
```

## Task 13: Home, custom practice, exploration and session summary

**Files:**
- Create: `src/app/PackCard.tsx`, `src/app/HomeScreen.test.tsx`, `src/app/DataManagementScreen.tsx`, `src/app/DataManagementScreen.test.tsx`
- Create: `src/practice/CustomPracticeForm.tsx`, `src/practice/SessionSummary.tsx`, `src/practice/SessionSummary.test.tsx`
- Create: `src/explore/ExploreScreen.tsx`, `src/explore/PlaceLearningPanel.tsx`, `src/explore/ExploreScreen.test.tsx`

**Interfaces:**
- Consumes: content, mastery snapshots, scheduler, map and app shell.
- Produces: all non-practice MVP screens and navigation into focused practice.

- [ ] **Step 1: Test pack cards and resumable session state**

Assert each card shows title, overall mastery, due count, fragile count and Smart/Custom/Explore actions. When a resumable session exists, display “继续上次练习” as the primary action.

- [ ] **Step 2: Test custom-practice filters**

Select multiple entities, skills, status including fragile and question count. Assert the generated `SessionRequest` uses mode `custom`, updates real mastery and does not apply the 4–6 new-place cap.

- [ ] **Step 3: Test exploration and focused practice**

Assert explore shows full labels and optional hydrography, displays bilingual learning data/skill status on entity click, shows the aggregated fragile marker, and launches a custom session scoped to that entity.

- [ ] **Step 4: Test summary metrics**

Given attempt events, assert answer rate, independent correct, hints, new entities, mastery changes and fragile transitions. “再练薄弱项” creates a scoped custom request; no XP, rank or punitive score is rendered.

- [ ] **Step 5: Test the home data-management flow**

Open “数据管理” from the home toolbar, export through the native dialog, display the resulting filename, inspect an import without writing, show export date/learner/record counts, default to merge, and require an explicit warning confirmation for replace. Assert cancellation leaves current data unchanged.

- [ ] **Step 6: Run red tests, implement, then pass**

Run: `pnpm vitest run src/app/HomeScreen.test.tsx src/app/DataManagementScreen.test.tsx src/practice/SessionSummary.test.tsx src/explore/ExploreScreen.test.tsx`

Expected before implementation: FAIL. Implement the screens with the marine-mist/cartographic token system, then rerun and expect PASS.

- [ ] **Step 7: Commit the complete navigation surface**

```powershell
git add src/app src/practice src/explore
git commit -m "feat: complete learning and exploration flows"
```

## Task 14: Reproducible content pipeline and compliance ledger

**Files:**
- Create: `scripts/content/README.md`, `scripts/content/fetch-source.ps1`, `scripts/content/transform.ts`, `scripts/content/validate.ts`, `scripts/content/validate.test.ts`
- Create: `scripts/content/lib/hash.ts`, `scripts/content/lib/topology.ts`, `scripts/content/lib/pointInRegion.ts`
- Create: `src-tauri/resources/content/README.md`, `docs/compliance/map-release-checklist.md`

**Interfaces:**
- Consumes: content schema from Task 2.
- Produces: `pnpm content:validate`, deterministic TopoJSON and `sources.json` processing ledgers.

- [ ] **Step 1: Write pipeline tests with a tiny GeoJSON fixture**

Assert stable IDs survive transformation, shared boundaries become a TopoJSON mesh, point-in-region validation catches an outside capital, repeated transforms produce identical hashes and source metadata records each operation.

- [ ] **Step 2: Run the red pipeline test**

Run: `pnpm vitest run scripts/content/validate.test.ts`

Expected: FAIL because pipeline modules are absent.

- [ ] **Step 3: Implement explicit source acquisition**

`fetch-source.ps1` requires an HTTPS URL, expected SHA-256 and destination inside `scripts/content/raw/`; it refuses a hash mismatch. Source files are never silently refreshed. Document the responsible institution, retrieval date, license/use terms and exact input hash.

- [ ] **Step 4: Implement deterministic transformation and validation**

Normalize longitude/latitude, preserve stable IDs, quantize/simplify with recorded parameters, generate TopoJSON, then run schema, counts, references, topology, bounds, point-in-region, capabilities and source-ledger checks.

- [ ] **Step 5: Write the release checklist**

The checklist requires source/processing review, actual-render comparison with the current official standard map, Hong Kong/Macau/Taiwan representation review, required statutory map-review decision, approval/standard-map identifier verification, third-party license review and a named human sign-off. Automated success cannot check the human boxes.

- [ ] **Step 6: Verify and commit**

Run: `pnpm vitest run scripts/content/validate.test.ts` and `pnpm content:validate -- --fixture`.

Expected: tests and fixture validation PASS with identical hashes on two runs.

```powershell
git add scripts src-tauri/resources/content/README.md docs/compliance
git commit -m "build: add reproducible map content pipeline"
```

## Task 15: Three validated launch content packs

**Files:**
- Create: `src-tauri/resources/content/cn-provincial-divisions/{manifest.json,entities.json,map.topojson,sources.json}`
- Create: `src-tauri/resources/content/cn-shanghai-districts/{manifest.json,entities.json,map.topojson,sources.json}`
- Create: `src-tauri/resources/content/us-states/{manifest.json,entities.json,map.topojson,sources.json}`
- Create: `scripts/content/launch-packs.test.ts`

**Interfaces:**
- Consumes: Task 14 pipeline and official sources.
- Produces: three built-in packs accepted by `loadAvailablePacks`.

- [ ] **Step 1: Add failing entity-count and relationship tests**

Assert 34 Chinese provincial-level regions, 16 Shanghai districts and 50 US states. Assert unique stable IDs, complete zh/en names, all declared capital relationships resolve, every region has geometry, every declared city has a point, and each point lies within its intended parent when that relation is geographically valid.

- [ ] **Step 2: Acquire and hash authoritative sources**

For China and Shanghai, start from official standard-map/authorized public-map sources and record review identifiers and processing limits. For the United States use Census Bureau Cartographic Boundary Files and official state-capital data with explicit public-domain metadata. Do not use the user's low-resolution reference image as an asset or geometry source.

- [ ] **Step 3: Build the China and Shanghai packs**

Use official classification for 23 provinces including Taiwan, 5 autonomous regions, 4 municipalities and 2 special administrative regions. Do not create absent capital relationships. Add major rivers/lakes only as background layers with provenance.

- [ ] **Step 4: Build the US states pack**

Set `primaryAnswerLanguage` to `en`, include all 50 states and state-capital points, and add common postal abbreviations as declared aliases while retaining Chinese names for introduction/reveal and accepted typed answers.

- [ ] **Step 5: Run pack validation twice**

Run:

```powershell
pnpm vitest run scripts/content/launch-packs.test.ts
pnpm content:validate -- --all
pnpm content:validate -- --all
```

Expected: all count/relation/geometry/source checks PASS and the two validation reports contain identical content hashes.

- [ ] **Step 6: Perform the development-only compliance review and commit**

Complete all non-statutory fields in `docs/compliance/map-release-checklist.md`; leave public-release approval unchecked because public distribution is out of scope. Commit only after the actual render has been compared by a human with the official reference.

```powershell
git add src-tauri/resources/content scripts/content/launch-packs.test.ts docs/compliance/map-release-checklist.md
git commit -m "feat: add validated launch geography packs"
```

## Task 16: End-to-end hardening and personal installers

**Files:**
- Create: `tests/e2e/practice-flow.spec.ts`, `tests/e2e/resume-flow.spec.ts`, `tests/e2e/backup-flow.spec.ts`, `tests/e2e/explore-flow.spec.ts`, `tests/e2e/accessibility.spec.ts`
- Create: `scripts/check-offline.ps1`, `docs/release/personal-build-checklist.md`, `THIRD_PARTY_NOTICES.md`
- Modify: `src-tauri/tauri.conf.json`, `.github/workflows/quality.yml`

**Interfaces:**
- Consumes: the full application and three launch packs.
- Produces: verified Windows x64 installer and macOS arm64/x86_64 personal builds; no public-release claim.

- [ ] **Step 1: Write the failing end-to-end journeys**

Cover home → placement or smart session → introduction → first error → hint → reveal → delayed retry → summary → restart persistence; custom practice; explore-to-focused-practice; pause/options Esc stack; backup export/merge/replace; corrupt backup rejection.

- [ ] **Step 2: Add accessibility and shortcut journeys**

Run the five question types without a mouse where the map permits focus navigation. Assert visible focus, accessible names, 200% zoom completion, reduced-motion behavior, text/icon/outline correctness and no shortcut activation inside unrelated inputs.

- [ ] **Step 3: Add offline and performance instrumentation**

`check-offline.ps1` launches the packaged app with outbound network blocked and scans source/bundle configuration for HTTP clients or remote asset URLs. Record cold-start-to-home, answer-to-feedback, next-question and map frame timings; fail thresholds above 2s, 100ms, 200ms and sustained frame time above 20ms in the benchmark fixture.

- [ ] **Step 4: Run the full quality matrix**

Run:

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

Expected: every command exits 0; coverage includes every learning-domain branch and each practice reducer state.

- [ ] **Step 5: Build and smoke-test personal installers**

On Windows run `pnpm tauri build --bundles nsis`; on macOS run `pnpm tauri build --bundles app,dmg --target universal-apple-darwin`. Test install, first launch, Chinese input, audio, file dialog, database creation, backup round-trip and uninstall/reinstall data behavior on the minimum OS versions.

- [ ] **Step 6: Complete notices and the personal-build checklist**

Record dependency licenses, content-source terms, unsigned/unnotarized macOS launch instructions, WebView2 bootstrap behavior and known personal-build limitations. Mark public map review, signing, notarization, updater and store distribution as excluded release gates rather than completed work.

- [ ] **Step 7: Commit the release-ready personal build work**

```powershell
git add tests scripts/check-offline.ps1 docs/release THIRD_PARTY_NOTICES.md src-tauri/tauri.conf.json .github/workflows/quality.yml
git commit -m "test: harden cross-platform personal release"
```

## Implementation order and review gates

Execute Tasks 1–8 first to prove content, learning and persistence without UI coupling. Tasks 9–13 deliver a complete vertical user flow using fixtures. Task 14 establishes the governed content pipeline before any production map is admitted. Task 15 adds real content only after the validator is trusted. Task 16 is the final personal-release gate.

After each task, run its focused tests and request a code review before starting a dependent task. After Tasks 7, 13, 15 and 16, run the full accumulated suite because those tasks close persistence, product-flow, real-data and release milestones respectively.

## Execution handoff

Recommended execution method: `subagent-driven-development`, one fresh implementation agent per task with specification and code-quality review between tasks. If execution must remain in one task, use `executing-plans` in batches of no more than two tasks and stop at the four milestone gates above.

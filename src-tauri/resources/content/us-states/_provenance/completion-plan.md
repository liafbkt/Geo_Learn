# US resource completion implementation plan

> **For agentic workers:** use the existing task-7 execution workflow with test-first fixes and independent read-only review. This plan stays inside the user's explicitly owned paths; no app/renderer design changes are authorized.

**Goal:** make the existing 50-state/50-capital development package independently verifiable and reproducible without leaving tools or temporary outputs in installable resources.

**Architecture:** retain all four converter-produced runtime files byte-for-byte. Add source-evidence checks before the existing converter is called; use an external temporary directory for both conversion passes, cleaned on success/failure. Keep source/reference artifacts and repeatable review instructions with the pack.

**Tech stack:** existing Node, TypeScript, Vitest, content converter/validator; no new project dependencies.

## Constraints

- Own only `us-states/`, `scripts/content/launch-packs.test.ts`, and the compliance record for this follow-up.
- No schema, converter, React application, Rust, dependency or handover changes.
- No copied screenshot geometry, invented relations, missing-state deletion, altered real point coordinates or public-release approval.
- Existing branch/worktree retained; don't claim the original three-pack task is complete or create its completion commit.

## 1. Source and scratch regression

Files: `scripts/content/launch-packs.test.ts`; `_provenance/source-checks.ts`; `_provenance/verify.ts`.

- [x] Write tests before implementation. Run the real CLI and assert its directory listing is unchanged and its dedicated external temp parent is empty afterwards. The current CLI must fail this assertion because it creates `generated-verification-*` under the pack.
- [x] Test `verifyRetainedSources(directory)` against the actual pinned files, and a private copied set with one raw file changed, one audit file changed, and an unsafe ledger filename. The new function must reject each changed copy; no original file may be edited.
- [x] Implement raw-hash/processing-ledger checks, checking simple filenames before any file access. Verify `regions.geojson`, `entities.input.json`, and `points-audit.json` against retained processing hashes.
- [x] Use `mkdtemp(join(tmpdir(), 'us-states-verification-'))`, assert its resolved parent/prefix before cleanup, and clean in `finally`. `--publish` remains explicit; unchanged converters validate produced files.
- [x] Run `node node_modules/vitest/vitest.mjs run scripts/content/launch-packs.test.ts -t 'us-states|all 50 real US'` and the verifier; all tests pass and the four original output hashes stay unchanged.

## 2. Resource handoff and reproduction

Files: `_provenance/README.md`, reproducible inspection templates under `_provenance/functional-review/`, `docs/compliance/map-release-checklist.md`.

- [x] Preserve the already executed map-mounting harness as text templates. Document copying into ignored workspace scratch and loading via Vite; use original `projectMap` / `MapViewport`, no replacement renderer.
- [x] Replace instructions installing optional Python tools under resources with workspace-external scratch instructions; retain the pinned versions. Keep provenance and screenshots as evidence, not executable dependencies.
- [x] Move only verified `generated-verification-*` duplicate-output directories to recoverable ignored task scratch after checking absolute source/destination paths and hashes of their eight files.
- [x] Update the dated completion record: source checks, scratch cleanup, human-repeatable inspection, tests and renderer limitations. Leave human/statutory sign-off unchecked.

## 3. Evidence and review

- [x] Run source/pack verification twice and record unchanged four runtime hashes.
- [x] Run US-focused tests, the 290-test existing baseline, TypeScript and targeted ESLint; inspect exit codes.
- [x] Read-only reviewer checks the new source verifier, cleanup safety, tests and honest data-vs-UI status. Address important findings and report the source package outcome separately from UI/installer release readiness.

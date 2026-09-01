# China and Shanghai Content Completion Plan

> For agentic workers: execute inline using executing-plans; use requesting-code-review for the independent final review.

**Goal:** Complete reproducible development packs for China 34 and Shanghai 16 alongside the existing US 50-state/50-capital pack.

**Architecture:** Keep the already tested geoBoundaries geometry and use the unchanged content transformer, validator, loader, projector and question generator. Each pack carries four runtime files and retained, hash-pinned provenance. No UI changes.

**Tech Stack:** Existing TypeScript/tsx/Vitest, GeoJSON/TopoJSON, Node filesystem/hash APIs.

## Global constraints

- Branch `codex/v1-launch-packs`, base `a3026a055e1ec6e25dcc3dc16d863eb8201188c9`.
- Own only the three requested pack directories, `scripts/content/launch-packs.test.ts`, and `docs/compliance/map-release-checklist.md`.
- Do not modify schema, converter, application React, Tauri Rust, dependencies or handover.
- China/Shanghai: `primaryAnswerLanguage=zh`, `distributionStatus=development-only`; no invented capitals, places, parent entities or hydrography.
- Functional teaching geometry is the accepted scope, not certified borders or a complete national standard map. Preserve and disclose absent South China Sea inset/island detail.
- Retain ODbL/OSM attribution for Shanghai, and geoBoundaries CC BY attribution plus the upstream author's public-domain declaration for China.
- Do not check named-human or statutory release gates.

## 1. Sources and expected failures

- [x] Read handover/content contract and inspect isolated branch.
- [x] Run `node node_modules/vitest/vitest.mjs run scripts/content/launch-packs.test.ts`: expected China/Shanghai missing-package failures; observed 13 failures and 11 US passes.
- [x] Resolve truncated China upstream URL using fixed-commit `sourceData/gbOpen/CHN_ADM1.zip/meta.txt` and the original author's license page.
- [ ] Retain raw geometry, licensing/metadata and authoritative name/code facts with URL/date/SHA-256 receipts.

## 2. Package assembly

Files: each China/Shanghai `_provenance/{roster.json,build.ts,raw/,README.md}`, four runtime JSON resources; shared reproduction implementation lives in China `_provenance/build.ts` and Shanghai documents its dependency.

- [ ] Add acceptance tests before writing preprocessing code: missing aliases, swapped region identities, source tampering, source-to-output geometry mismatch, repeated generation.
- [ ] Observe expected RED for newly specified missing resources/reproducer.
- [ ] Bind stable IDs and reviewed bilingual/alias facts to unique pinned `shapeID` values; retain source spelling corrections in audit.
- [ ] Normalize only ring winding and explicit CRS84 lon/lat contract; no coordinate shifts, repairs, dropped vertices or fabricated island geometry.
- [ ] Generate twice with `transformContent({sourceCrs:'EPSG:4326',simplificationTolerance:0,quantizationGridSize:1000000,...})`; validate twice and compare all four hashes.
- [ ] Keep scratch outside installable resources and remove only uniquely created scratch; refuse replacing existing differing runtime bytes.

## 3. Verification and visual evidence

Files: `scripts/content/launch-packs.test.ts`; each `_provenance/visual-review/`; compliance checklist.

- [ ] Run unfiltered three-pack regressions and whole existing Vitest suite; typecheck and targeted lint.
- [ ] Exercise unchanged actual map component from a retained copyable harness; save overview/reveal/explore screenshots and actual selection observations.
- [ ] Compare actual generated outlines to retained upstream/reference images, documenting simplification, missing inset and label collision instead of claiming visual/legal certification.
- [ ] Write human-repeatable steps and distinguish machine evidence, AI observation and unperformed human sign-off.

## 4. Review and requested commit

- [ ] Request independent read-only review of all owned changes relative to base (including untracked packs).
- [ ] Address Critical/Important in-scope findings; leave unrelated UI defects documented with ownership.
- [ ] Check newline-preserving attributes and four-file hashes; verify only owned paths changed.
- [ ] Commit `feat: add validated launch geography packs`; do not merge, push or publish.

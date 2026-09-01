# Map content release checklist

Complete one signed copy for each pack and release candidate. Automated validation supplies technical evidence only; it cannot complete or waive the human and legal checks below.

Pack ID: ____________________  Content version: ____________________

Release candidate commit: ____________________  Date: ____________________

## Automated evidence

- [ ] `pnpm content:validate -- <pack-directory>` exits successfully.
- [ ] A second transform from the same pinned inputs produces byte-identical files and SHA-256 values.
- [ ] Entity counts, references, capabilities, topology, bounds, points-in-regions and manifest checksums pass.
- [ ] Every raw source has an institution, direct URL, retrieval date, license/use terms, exact input hash and recorded processing chain.

## Required human review

- [ ] A reviewer compared the actual rendered map—not only source data—with the current authoritative standard map at all supported zoom levels.
- [ ] The representation, labels and boundaries involving Hong Kong, Macau and Taiwan were explicitly reviewed where applicable.
- [ ] A qualified reviewer documented whether statutory map review is required for the intended distribution channel and territory.
- [ ] When review or a standard-map identifier is required, its validity, displayed identifier and permitted scope were verified against the issuing authority.
- [ ] All third-party source licenses and attribution obligations were reviewed for redistribution inside the installer.
- [ ] Visual defects, disputed boundaries, missing islands/insets and label collisions were recorded and resolved or accepted by a named owner.

## Sign-off

Decision: [ ] approved for stated release  [ ] development-only  [ ] rejected

Reviewer name and role: ______________________________________________

Signature or auditable approval reference: _____________________________

Date: ____________________  Notes: ____________________________________

---

## Task 7 working evidence, 2026-08-30 (not a release approval)

Baseline: `a3026a055e1ec6e25dcc3dc16d863eb8201188c9` (`WAVE_A_SHA`).
Working branch: `codex/v1-launch-packs`.
Intended use: local development/user testing only. Public distribution is not approved.
Evidence preparer: Codex (AI assistant, **not a named human reviewer**).
Candidate commit: none; the three-pack task is incomplete and must not be represented by the requested completion commit yet.

### cn-provincial-divisions: source acquisition blocked

- Target: 34 regions, no capital/place claims until separately sourced; primary answer language `zh`.
- [Natural Resources Ministry standard map service](https://bzdt.tianditu.gov.cn/) and [legacy endpoint](https://bzdt.ch.mnr.gov.cn/) were investigated. After retrying outside the restricted network sandbox, legacy HTTP/HTTPS requests each timed out after 20 seconds; the new endpoint failed its TLS connection. No EPS source bytes were acquired or hashed. No certificate checks or access controls were bypassed.
- [NGCC 1:1,000,000 public dataset product description](https://www.webmap.cn/commres.do?method=result100W) describes CGCS2000 longitude/latitude data including administrative boundary polygons. This is only a candidate, not a source included in a pack. The [download agreement](https://www.webmap.cn/public/html/downLoad/downLoadDeal.html) restricts transferring data or including it in externally distributed products without permission. Its free-download label does not establish redistribution permission. No raw dataset was acquired.
- The accessible Beijing standard-map catalogue contained Beijing city/district resources, not the required nationwide map. No third-party mirror was substituted.
- Required unblock evidence: official nationwide geometry including all 34 region identities, original CRS/projection metadata, source version, and terms/authorization appropriate to the intended use. Retain exact input bytes and hashes before processing.
- Actual generated-map comparison: **not performed**; no generated China map exists. Hong Kong/Macau/Taiwan, small islands, insets and boundaries remain pending.

- [ ] Source acquired and processing chain verified.
- [ ] Generated pack passes automated checks.
- [ ] Named human completed actual-render comparison.
- [ ] Statutory public-distribution review and identifier verification completed.

### cn-shanghai-districts: coordinate-reference evidence blocked

- Target: 16 districts, no invented district-capital/place claims; primary answer language `zh`.
- [Official standard-map catalogue](https://shanghai.tianditu.gov.cn/map/views/standardMap.html), produced by Shanghai Surveying and Mapping Institute and hosted by Shanghai Municipal Bureau of Planning and Natural Resources.
- [Official Shanghai administrative divisions PDF](https://shanghai.tianditu.gov.cn/map/data/standardMap/上海市标准地图/17-上海市行政区划示意图.pdf), retrieved 2026-08-30. Original file: 926,169 bytes; SHA-256 `bbf0819a9b11b17194cb015a48dc77b530bc25330028e4bd1b547e6e117593d9`. Source labels: July 2025, `沪S（2025）049号`. This is the **source's** identifier, not an approval for a derived software map.
- The [site copyright statement](https://shanghai.tianditu.gov.cn/map/views/about.html?type=3) requires source attribution and the site URL. It does not itself resolve permission for extracted GIS geometry bundled in an installer; no public-release license approval has been recorded.
- Source inspection: `pdfinfo` reports one 1249×1618 pt page, PDF 1.4, CorelDRAW X6 / Acrobat Distiller, no custom metadata. Poppler rendered the full page at 2000 px for AI-assisted visual inspection. Visible: 16 district labels, district/township boundaries, Chongming/Changxing/Hengsha, additional island inset, source identifier and a warning that administrative boundaries are reference-only. No graticule, longitude/latitude control points or projection specification was visible. The page is not accepted as an EPSG:4326 input; no page-to-degree affine transform was invented.
- Public ArcGIS services linked from the official mapping site were also checked: their exposed layers were imagery/coverage extents, not the 16 district boundaries. Extent polygons were not substituted for district geometry. The open-data portal's security challenge was not bypassed.
- Required unblock evidence: official 16-district GIS polygons with CRS and version, or a source-authorized vector map with adequate projection/control-point information and allowed use. Include island components and a documented georeferencing error assessment if digitization is needed.
- Actual generated-map comparison: **not performed**; reviewing the source PDF is not reviewing an application-generated map.

- [x] Official reference PDF acquired, hashed and visually inspected by the AI assistant.
- [ ] Georeferenced geometry and applicable use permission verified.
- [ ] Generated pack passes automated checks.
- [ ] Named human completed actual-render comparison.
- [ ] Statutory public-distribution review and identifier verification completed.

### us-states: technical pass, actual-render defects open

Historical record from 2026-08-30: its temporary-page-only reproduction setup and scratch-directory status have been superseded by the **2026-08-31 US resource-completion follow-up** below. The recorded UI discrepancies and unapproved human/public-release gates remain open.

Pack version: `1.0.0-dev.1`; primary answer language: `en`; 50 states and 50 representative capital-city points. Distribution status remains `development-only`, not an approval. The [source README](../../src-tauri/resources/content/us-states/_provenance/README.md), pinned official archives, input hashes, per-point CRS audit and converter verification are retained inside the pack.

| Resource | SHA-256 |
| --- | --- |
| manifest.json | `3655366c800e2fb5dec3fa97c8e1eb9bf10112867f706e18edc0fcaad4b88b5b` |
| entities.json | `26bf9137cbfdffce6872750f6bb8eb636d41e8a1066d1045aa7dc7c7fad7e194` |
| map.topojson | `7ab140dec05bdd95d118da0ca51d66acde2895e4494a9de41df9b38a15b646c4` |
| sources.json | `de836d790a951460f60ea56c037fae4a2a5cb4293a379043d351595d00d23ae8` |

- [x] AI-run technical checks: US-specific tests 7 passed. Full regression at 20:56 local on 2026-08-30: **297 passed, 13 failed**; all failures concern the two absent China/Shanghai packs. Existing 290 tests remain passing; no missing-pack tests were skipped or weakened in the full run.
- [x] Two fresh existing-pipeline conversions and two complete validations passed with identical four-resource hashes (`pnpm exec tsx src-tauri/resources/content/us-states/_provenance/verify.ts`). The launch regression separately checks that two validations do not change any resource bytes; it does not claim to run two conversions itself.
- [x] Fresh temporary Git index/checkout with `core.autocrlf=true`: 21 then-existing package/source-evidence files were byte-identical. Package `.gitattributes` disables text conversion, including nested provenance. Nine visual screenshots were subsequently added as binary evidence.
- [x] Type checking and ESLint on the launch regression passed. Independent read-only review checked five official-input hashes and compared all 126 source rings / 13,547 vertices against the preprocessing output: no vertices or island rings removed.
- [ ] All-entity/all-zoom human visual acceptance completed.
- [ ] Small-scale source-use constraints and installer redistribution approved by a named reviewer.
- [ ] Statutory review, if applicable, and public-distribution sign-off completed.

#### Executed actual-render comparison (AI-assisted, incomplete acceptance)

The unchanged application `projectMap` and `MapViewport` components were mounted in a temporary local inspection page, not a replacement renderer. This tests their actual generated SVG and interactions, **not** an end-to-end packaged Tauri application. Baseline code `a3026a0`; generated pack hashes above. Browser CSS viewport 1280×720, reported devicePixelRatio 1.25 (OS display-setting value not independently inspected); SVG viewBox 1200×800, rendered CSS size about 1136×757.325. Modes exercised: quiz, explore and reveal. Recorded zoom values are **1**, **2.0736**, **4.29981696**, and **8** (the UI's wheel increments do not land on exactly 2/4).

The official [USGS general-reference map](https://store.usgs.gov/assets/yimages/PDF/101517.pdf) was downloaded and rendered for a coarse side-by-side outline/location comparison: source PDF metadata dates from 2005, 15,288,842 bytes, SHA-256 `001aa2cfe2b0edbc42e5ef40ddd2e22e88d79926435ed8c301dc5029e83977c5`. It is an older reference, **not** evidence certifying 2025 coastline detail or the current authoritative-map gate. The actual geometry source remains the pinned Census 2025 KML. Observed broad California/Florida/Texas shapes, western state layout, Great Lakes placement, Alaska and Hawaii are recognizable; no exhaustive coastline, all-island or all-50-label comparison was completed. No raster/reference map supplied geometry.

Unedited screenshots are retained in [visual-review/](../../src-tauri/resources/content/us-states/_provenance/visual-review/):

| Screenshot | Mode / zoom / observed result |
| --- | --- |
| `render-us-quiz-1x.png` | Full geometry overview; Alaska/Aleutians span both sides, continental states appear small. |
| `render-us-explore-1x.png` | Labels overlap heavily in the continental states. |
| `render-us-explore-2x.png`, `render-us-explore-2x-panned.png` | 2.0736× before/after pan; main content initially displaced, labels still overlap. |
| `render-us-explore-4x.png`, `render-us-explore-4x-panned.png` | 4.29981696× before/after pan; initially mostly empty viewport, enlarged labels obscure outlines. |
| `render-us-quiz-4x-panned.png` | Western states/Hawaii recognizable after pan; enlarged capital markers cover substantial areas. |
| `render-us-reveal-4x-panned.png` | California selected and revealed; only its answer label displayed, but greatly enlarged. |
| `render-us-reveal-8x.png` | 8×; selection remains California but viewport shifts to Alaska, selected answer offscreen. |

| Open discrepancy | Severity / required owner / resolution status |
| --- | --- |
| Mercator full-extent fit includes Aleutian ±180° components; the renderer ignores requested manifest viewport metadata, shrinking CONUS in the overview. | Important usability; map-renderer owner **not assigned**. Open; requires separate authorization outside task 7. Do not remove islands or move true coordinates. |
| Labels and point markers scale with geometry, causing collisions/occlusion at overview and higher zoom. | Important usability; map/label owner **not assigned**. Open; no named-owner acceptance. |
| Zoom scales around the current origin instead of retaining the inspected answer in view; large pans are needed at 4×/8×. | Important navigation; map-interaction owner **not assigned**. Open; no source-geometry workaround applied. |
| Census 20m metadata advises display at 1:20,000,000 or smaller, not precise geographic analysis. Application zoom currently has no geographic-scale gate. | Source-use/design review pending; product/compliance owner **not assigned**. Do not treat development-only or successful containment tests as a waiver. |

Local reproduction on this retained worktree: run `pnpm exec vite --host 127.0.0.1 --port 1437`, then open `http://127.0.0.1:1437/.superpowers/launch-task/render.html?pack=us-states`. The ignored `render.html`/`render.tsx` inspection harness remains in this worktree; it is **not** included in a fresh checkout or shipped in the installer. Use the three mode buttons; each upward wheel event multiplies zoom by 1.2, capped at 8; drag to pan and use Home on the focused map to reset. Select California and choose reveal to reproduce the selected-label case. For a fresh checkout, the map-component owner must provide equivalent inspection mounting or completed application integration before repeating this protocol; screenshots alone do not complete the manual gate.

Independent review outcome: **not ready to merge**. US content has no identified important data defect; two mandatory packs are absent and actual-render issues are unresolved. The inaccurate earlier README claim of an effective CONUS-focused initial viewport was corrected to metadata-only. No completion commit was made and no human/legal approval was checked.

### Manual comparison protocol (must be performed on the generated map)

#### 2026-08-31 US-only functional follow-up

Historical first follow-up: the 9-test count, missing fresh-checkout harness and retained scratch status are superseded by the subsequent **US resource-completion follow-up**. Its original click failures and retries remain valid retained observations.

This dated update concerns US development-data adoption under the user's relaxed teaching-geometry standard, not completion of the original three-pack task or public-distribution approval. Four runtime hashes above are unchanged. Detailed executed observations, screenshots, commands and an explicit human-repeatable procedure are in the [US functional review](../../src-tauri/resources/content/us-states/_provenance/functional-review/README.md).

- [x] AI-run refreshed US regressions: **9 passed / 13 other-pack tests skipped**. Checks now include source-audit/runtime point equality and 500 questions: 200 map, 150 choice, 150 text, with real name/alias answer acceptance and rejection checks.
- [x] Two fresh converter runs and two validators agree on all four hashes. Existing baseline separately passes **290 tests / 24 files**, explicitly excluding `launch-packs.test.ts`; all three TypeScript configurations and launch-test ESLint pass. This does not replace the unfiltered three-pack acceptance suite.
- [x] Actual unchanged map component exercised: first pointer selection succeeds for 42/50 states; eight remaining states selected with direction keys + Enter. Capital center clicks succeed for 42/50; visible-edge retargeting adds six, and 4.29981696× zoom/pan adds Hartford and Boston. Successful-selection sets cover all 50 states and all 50 capitals. First failures are retained, not counted as first-click successes.
- [x] Independent read-only review: five original-source hashes and four runtime hashes match; 50 states / 126 rings / 13,547 vertices match raw KML allowing winding reversal; all 50 capital points match pinned Gazetteer records and audited conversion. No Critical/Important data defect identified. Supplemental review agrees with **development data ready, default pointer UX incomplete**.
- [ ] Default mouse usability accepted: still open for viewport, marker occlusion, label collision and zoom-center behavior; these belong to the map-component owner outside task 7.
- [ ] Installer resource scope reviewed: `verify.ts` retains `generated-verification-*` beneath recursively bundled resources; move verification/tool scratch outside that tree or restrict the packaging allowlist before release. `.gitignore` does not exclude Tauri resources.
- [ ] Named human actual-render acceptance completed.
- [ ] Statutory/public-distribution sign-off completed.

No map coordinates, schema, converter, React application, Rust, dependencies or handover were changed in this follow-up. No requested three-pack completion commit was made.

#### 2026-08-31 US resource-completion follow-up

The subsequent request to complete the US resources closes the resource-provenance and repeatability gaps, not the previously recorded UI issues. See the [completion record](../../src-tauri/resources/content/us-states/_provenance/completion-record.json) and updated [source/reproduction instructions](../../src-tauri/resources/content/us-states/_provenance/README.md).

- [x] Automatic pre-conversion check of all five raw source files, exact raw/processing ledger agreement and all three geometry/entity/point-audit hashes. Changed raw bytes, changed point-audit bytes and unsafe source filenames are rejected in private-copy regression tests.
- [x] Verification now creates unique temporary outputs outside installable `resources/content`, and clears them in `finally` after validating the exact cleanup parent/name. Four earlier directories containing 32 byte-identical generated JSON copies were hash-checked and moved to recoverable ignored task scratch. Original sources remain intact; no Tauri configuration change was needed.
- [x] Source-verifier and scratch regressions recorded RED then GREEN. Latest US result: **11 passed, 0 failed, 13 other-pack tests skipped**. Existing baseline: **290 passed / 24 files**. Three project TypeScript configurations, explicit verifier typecheck and targeted ESLint with `--no-ignore` passed.
- [x] Two conversions and two validations still produce the original four runtime hashes; `verification.json` additionally records the eight source/intermediate hashes and successful external scratch cleanup.
- [x] Previously exercised actual-component harness retained as two text templates. A new scratch page was copied from those templates and actually loaded: 50 region options, 50 capital options, Alaska selection and Juneau selection/reveal successful, no recorded browser errors. This is a new-copy smoke test, not another full 100-object or packaged Tauri E2E run. Full previous interaction records and failures remain unchanged.
- [x] A local development ZIP containing exactly `us-states/{manifest.json,entities.json,map.topojson,sources.json}` was exported, extracted, hash-compared and passed the unchanged pack validator. The ZIP is a content handoff, not an installer or a public release; its receipt is in the completion record.
- [x] Independent read-only review found no Critical/Important source-code issues; templates equal the original harness, source hashes and four runtime hashes match. Dedicated tests for conversion-failure cleanup and content-local TMP refusal remain optional follow-up coverage, not claimed executed.
- [ ] Default viewport/marker/label/pointer UX completed — requires map-component changes outside the original authorization.
- [ ] Final installer resource listing and packaged application E2E completed.
- [ ] Named-human actual-render acceptance and applicable statutory/public-distribution approval completed.

The US resource dataset and its reproducible development handoff are complete within this scope. No schema, converter, application React, Rust, dependency or handover changes; no original three-pack completion commit or integration-branch merge.

#### Common manual protocol

1. Record the candidate commit and all four resource hashes for the selected pack. Run `pnpm content:validate -- src-tauri/resources/content/<pack-id>` twice and compare the resource hashes before/after; a successful validation alone is not visual or legal approval.
2. Open the actual application map, not only the original GIS file. Record screen dimensions, Windows display scale, application version, pack version, mode and zoom. Compare the overview (1×), intermediate zoom (2×/4×) and maximum zoom (8×), panning across every part of the data. Verify `quiz`, `reveal` and `explore` modes separately.
3. Compare side-by-side with the versioned official reference: region identity, outline, adjoining boundaries, holes, coastal/island components, point/parent relationships, labels, selected answer visibility and missing or overlapping labels. For China explicitly include Hong Kong, Macau, Taiwan and all required island/inset representations. For Shanghai include Chongming, Changxing, Hengsha and the source's island inset. For the US include Alaska/Aleutian antimeridian components, Hawaii, Great Lakes shorelines, small northeastern states and all 50 capital points.
4. Save unedited actual-render screenshots and reference identifiers; write each discrepancy, severity, location, responsible owner and resolution/acceptance. An AI-assisted inspection may supply evidence but cannot fill the named-human sign-off.
5. A qualified named human separately decides applicable statutory review, permitted distribution scope and identifier requirements. Only that person may complete the relevant boxes and auditable signature above. A development-only label never waives this gate.

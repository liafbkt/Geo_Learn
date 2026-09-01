# US states / capitals provenance

Development-only pack, assembled 2026-08-30. The four files one directory above are unedited output from the existing content converter. This directory is supporting source evidence, not a second runtime pack.

**2026-08-31 teaching-use acceptance update:** the US data layer is ready for development use under the user's functional teaching standard. All 50 states and 50 capitals were selected using the actual map component; this includes keyboard fallback for eight states and visible-edge/zoom retries for eight capital markers, not a claim of 100 default-pointer successes. Nine US regression tests now pass, including 500 question-generation/presentation cases and actual text-answer acceptance. See the [full functional report, screenshots and retained failures](functional-review/README.md). Default viewport and marker/label usability remain open; no new GIS source is needed for these fixes.

**Subsequent resource-completion update:** source evidence is now checked automatically before conversion; five raw files and three processing files must match their ledgers. Verification scratch is created outside installable resources and cleaned in `finally`. The earlier scratch directories have been hash-checked and recoverably archived outside resources. The US regression now has **11 passing tests**. Inspection-page templates are retained, so a fresh checkout can repeat the actual-component check using the commands below. Earlier 7/9-test and temporary-page-only statements describe the earlier review stages, not missing current deliverables.

The [completion record](completion-record.json) lists the final checks and the local development ZIP receipt. The ZIP contains only the four runtime files under `us-states/`, was extracted and validated, and is not an installer. All original data, processing inputs and inspection evidence remain in this source tree. Runtime data still represents exactly 50 states and 50 capital cities; DC and territories are intentionally not additional states. Resource readiness does not claim the known default-pointer UX is fixed.

## Sources and permissions

Exact URLs, acquisition dates, institutions, SHA-256 hashes, source CRS and use information are in `external-inputs.json`; preprocessing refuses changed source hashes. The same evidence is carried in the generated `sources.json` processing ledger.

- U.S. Census Bureau, **2025 Cartographic Boundary Files, states, KML, 1:20,000,000**: `cb_2025_us_state_20m.zip`. The [official download listing](https://www.census.gov/geographies/mapping-files/2025/geo/carto-boundary-file.html) links directly to the pinned archive. Its ISO metadata states that reuse in products/publications is free with Census acknowledgement, for appropriate small-scale visual display only. It specifies 1:20,000,000 or smaller scale, not precise geographic analysis, geocoding, or area/perimeter calculation. Source: U.S. Census Bureau. Do not interpret learning feedback as a surveyed administrative-boundary determination.
- U.S. Census Bureau, **2025 National Places Gazetteer**: `2025_Gaz_place_national.zip`, obtained from the [official 2025 listing](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2025.html). `INTPTLAT` / `INTPTLONG` are representative place points, not capitol-building coordinates. The [record layout](https://www.census.gov/programs-surveys/geography/technical-documentation/records-layout/gaz-record-layouts.html) defines the fields. Source coordinates are treated as the Census TIGER NAD83 geographic base; pinned `census-tiger2025-techdoc.pdf`, PDF page 22, documents that base CRS. The Gazetteer landing page itself does not restate its datum; this interpretation is explicit, not an assertion that decimal degrees inherently mean WGS84.
- U.S. Government Publishing Office, **2016 Style Manual, Chapter 18, States, capitals, and counties**: `gpo-states-capitals.pdf`. The preprocessing extracts all 50 state/capital associations directly from this official publication, rather than from memory or the test roster. Saint Paul is the canonical answer; the GPO form `St. Paul` is retained as an alias.
- The pinned GovInfo [about/copyright statement](https://www.govinfo.gov/about) documents general public-domain treatment of federal government works under 17 USC 105 and warns that third-party material can have separate rights. We use the federal factual table, not unrelated illustrations. Census archive-specific acknowledgement and display constraints are retained in the ledger. Public distribution remains a separate human review decision.

## Transformations

`preprocess.py` reads pinned ZIP members in memory and produces:

1. `regions.geojson`: select only the 50 USPS state codes, excluding DC/Puerto Rico. KML coordinates are WGS84 longitude/latitude. Despite the supplied ISO metadata's World Mercator label, these are KML angular coordinate tuples, not projected metres. All 126 rings and all source vertices remain. Each exterior is reversed to clockwise, each hole to counterclockwise for the app's D3 spherical polygon convention. No generalization, repair, coordinate shift, artificial island, or antimeridian wrap is introduced. Census's separate Aleutian parts remain on both sides of ±180°.
2. `entities.input.json`: 50 bilingual regions (`us-al` etc.) and 50 bilingual places (`us-al-capital` etc.). Each region explicitly supports locate/identify/associate-capital; each place explicitly supports locate/identify-place. English is the primary answer language. USPS abbreviations, common legal name variants and editorial Chinese translations are supplied. Every capital reference is bidirectional.
3. `points-audit.json`: exact chosen Gazetteer GEOID/name, GPO capital spelling, original coordinate, transformed coordinate, per-point PROJ operation/definition and stated accuracy. Pyproj 3.7.2 / PROJ 9.5.1 uses `EPSG:4269 -> EPSG:4326`, XY order, no ballpark operations and network disabled. NAD83-to-WGS84 (1) is a registered no-op with 4 m stated accuracy for 49 points; Honolulu uses NAD83-to-WGS84 (3), also 4 m. Coordinates round only to 9 decimals. No point was moved to make validation pass. Juneau's official representative municipal point is used as supplied and passes parent-state containment; it is not downtown Juneau.
4. The manifest/source processing inputs. Version `1.0.0-dev.1`, development-only, five capabilities. The manifest contains requested CONUS-focused viewport metadata, but the current renderer does **not** consume it: `projectMap` fits all geometry with Mercator. Alaska/Hawaii remain geographically positioned, not moved into inset boxes. The resulting overview and label/marker problems are recorded in the [actual-render review](../../../../../docs/compliance/map-release-checklist.md#us-states-technical-pass-actual-render-defects-open); this is not a claim of a usable default viewport.

Existing `scripts/content/transform.ts` then performs simplification tolerance **0**, quantization grid **1000000**, shared-arc topology generation, entity binding and complete validation. Quantization is the only post-preprocessing geometry coordinate reduction. Raw boundary display is generalized by Census at 20m already; enlarging it does not reveal more detail.

## Reproduce

From the repository root, using Node/pnpm versions in the project and Python 3.12 with `pypdf==6.10.0` and `pyproj==3.7.2` (PROJ 9.5.1):

```powershell
# Optional isolated tool environment, OUTSIDE installable resources.
# Do not reuse an existing path containing unrelated work.
python -m venv .superpowers/us-pack-python
.superpowers/us-pack-python/Scripts/python.exe -m pip install pypdf==6.10.0 pyproj==3.7.2
.superpowers/us-pack-python/Scripts/python.exe -X utf8 src-tauri/resources/content/us-states/_provenance/preprocess.py
pnpm exec tsx src-tauri/resources/content/us-states/_provenance/verify.ts
pnpm exec vitest run scripts/content/launch-packs.test.ts -t 'us-states|all 50 real US'
```

The Python commands are needed only to rebuild processing inputs from raw archives. Normal verification requires only existing Node dependencies, not Python or network access. `source-checks.ts` checks all five retained raw bytes against `external-inputs.json`, requires that ledger to match the processing ledger, and checks the geometry/entity/point-audit intermediate hashes. `verify.ts` then generates to two missing output directories inside a unique OS-temporary directory outside `resources/content`, compares all four runtime files against each other and the installed pack, and runs the validator twice while checking hashes remain unchanged. Its unique scratch directory is removed in `finally`, including error exits. `verification.json` is written only after successful cleanup. `--publish` intentionally copies the converter's four generated byte streams into the pack; never edit generated JSON manually.

Acquisition in this environment required approved network escalation; pip-installed binaries also required escalation because their Windows ACLs were not readable by the sandbox identity. Do not install tools under `_provenance`: Tauri's resource glob is recursive and does not honor `.gitignore`. No installed tool/runtime dependency remains in the current pack. Original archives, documents and review evidence remain intentionally retained. `.gitattributes` disables line-ending conversion for all pack/evidence bytes.

### Recreate the actual-render inspection page

Run from a checkout with the existing project dependencies installed. This mechanically copies the retained, previously exercised harness as a temporary page; it does not edit application components.

```powershell
if (Test-Path -LiteralPath '.superpowers/us-resource-review') { throw 'Review directory already exists; use it or choose another two-level scratch directory.' }
New-Item -ItemType Directory -Path '.superpowers/us-resource-review' | Out-Null
Copy-Item -LiteralPath 'src-tauri/resources/content/us-states/_provenance/functional-review/render.html.txt' -Destination '.superpowers/us-resource-review/render.html'
Copy-Item -LiteralPath 'src-tauri/resources/content/us-states/_provenance/functional-review/render.tsx.txt' -Destination '.superpowers/us-resource-review/render.tsx'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1441 --strictPort
```

Open `http://127.0.0.1:1441/.superpowers/us-resource-review/render.html?pack=us-states`. Follow the [50-state/capital visual protocol](functional-review/README.md). This is an actual-component inspection mount, not a packaged Tauri E2E test. No screenshot supplies geometry.

## Verification and review boundary

US-focused regression run: **7 passed, 13 skipped** on 2026-08-30. The parent task supplied the RED missing-file baseline before implementation. Raw preprocessing reproduced all six processing/audit files identically. Two converter runs and two validators passed with identical four-file SHA-256 values in `verification.json`.

This verifies data structure, actual geographic shapes, representative points inside parent states, relationships, aliases, capability-based question generation, source processing and checksums. It is not named human cartographic/legal release approval. Root task separately performs actual app-renderer inspection and cross-checks checkout bytes. Display-scale constraints, viewport/Alaska navigation, Chinese-name editorial review and any Mainland China public-release obligations require that review before distribution.

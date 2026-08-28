# Reproducible content pipeline

This directory turns pinned authoritative GeoJSON sources into the four immutable files consumed by the app. It does not contain the three launch packs; those are produced and reviewed separately.

## Acquire a source

Record the expected SHA-256 before downloading. The fetcher accepts HTTPS only, writes only below `scripts/content/raw/`, refuses an existing destination, and deletes bytes whose hash does not match.

```powershell
pwsh ./scripts/content/fetch-source.ps1 `
  -Url https://authority.example/data.geojson `
  -ExpectedSha256 <64-hex-digest> `
  -Destination ./scripts/content/raw/source-version.geojson
```

For every source, record the responsible organization, direct URL, retrieval date, license/use terms, input SHA-256, input CRS and any human review identifier. Raw source files are evidence and must never be silently refreshed.

## Transform

Run the transform with an EPSG:4326 GeoJSON FeatureCollection, stable-ID entities, a manifest template and one source metadata record:

```powershell
pnpm exec tsx ./scripts/content/transform.ts `
  --regions ./scripts/content/raw/regions.geojson `
  --entities ./path/to/entities.json `
  --manifest ./path/to/manifest.template.json `
  --source ./path/to/source.json `
  --output ./path/to/generated-pack `
  --source-crs EPSG:4326 `
  --simplification-tolerance 0 `
  --quantization-grid-size 100001
```

The transform verifies the raw map input hash, binds the raw and generated entity hashes into the source ledger, sorts stable IDs, normalizes longitude/latitude, records simplification and quantization, nodes differently segmented collinear borders, deduplicates shared boundary segments, and emits deterministic `manifest.json`, `entities.json`, `map.topojson` and `sources.json` bytes. Version 1 requires simplification tolerance `0`; non-zero simplification remains disabled until it can operate on shared arcs rather than independent region rings. The quantization grid must be between 2 and 1,000,000.

The output directory must be missing or empty. Generation happens in a sibling staging directory, runs the complete pack validator there, and publishes with one directory rename. A non-empty output is immutable and is never overwritten.

The pipeline deliberately refuses other CRSs. Reprojection must be an explicit, separately recorded preprocessing step rather than an implicit guess.

## Validate

```powershell
pnpm content:validate -- --fixture
pnpm content:validate -- path/to/one-pack
pnpm content:validate -- --all
```

Validation covers the frozen content schema, counts, references, declared capabilities, topology structure and bounds, point-in-parent-region checks, source processing metadata and all manifest checksums. The fixture command transforms twice and fails unless all output hashes match.

Automated validation does not approve a map for public distribution. Complete the human release checklist in `docs/compliance/map-release-checklist.md` for every release candidate.

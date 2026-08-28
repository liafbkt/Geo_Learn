# Built-in content resources

Each child directory is one immutable content pack containing exactly:

- `manifest.json`
- `entities.json`
- `map.topojson`
- `sources.json`

Generate these files through `scripts/content/transform.ts` and validate them with `pnpm content:validate -- <pack-directory>`. Do not hand-edit generated output. A changed byte requires a new `contentVersion` and regenerated checksums.

The application loads each pack independently and quarantines a pack that fails validation. `development-only` data may be used for local testing but is not evidence of public-distribution approval.

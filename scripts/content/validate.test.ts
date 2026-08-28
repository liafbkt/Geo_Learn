import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { compareOrdinal, sha256Bytes, sha256File, stableJsonBytes } from './lib/hash';
import { buildTopology } from './lib/topology';
import { parseTransformArguments, transformContent } from './transform';
import { parseValidationArguments, validateContentPack } from './validate';

const fixtureDirectory = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const regionsPath = join(fixtureDirectory, 'regions.geojson');
const entitiesPath = join(fixtureDirectory, 'entities.json');
const manifestPath = join(fixtureDirectory, 'manifest.template.json');
const temporaryDirectories: string[] = [];

type TopologyGeometry = Readonly<{ id?: string; arcs?: readonly (readonly number[])[] }>;
type FixtureTopology = Readonly<{
  arcs: readonly (readonly (readonly [number, number])[])[];
  objects: Readonly<{
    regions: Readonly<{ geometries: readonly TopologyGeometry[] }>;
  }>;
}>;

type ContentValidationResult = Awaited<ReturnType<typeof validateContentPack>>;

function expectInvalid(result: ContentValidationResult): asserts result is Extract<ContentValidationResult, { ok: false }> {
  if (result.ok) throw new Error(`Expected pack ${result.packId} to be rejected.`);
}

async function makeTemporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `content-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function writeSourceMetadata(directory: string): Promise<string> {
  const sourcePath = join(directory, 'source.json');
  await writeFile(
    sourcePath,
    stableJsonBytes({
      id: 'fixture-regions',
      organization: 'Fixture Authority',
      url: 'https://example.invalid/fixture.geojson',
      retrievedAt: '2026-08-28',
      license: 'test-only',
      sha256: await sha256File(regionsPath),
      coordinateReferenceSystem: 'EPSG:4326',
      processing: [],
      simplification: null,
      quantization: null,
      reviewIdentifier: null,
    }),
  );
  return sourcePath;
}

async function transformFixture(outputDirectory: string): Promise<void> {
  const metadataDirectory = await makeTemporaryDirectory('metadata');
  await transformContent({
    regionsPath,
    entitiesPath,
    manifestPath,
    sourcePath: await writeSourceMetadata(metadataDirectory),
    outputDirectory,
    sourceCrs: 'EPSG:4326',
    simplificationTolerance: 0,
    quantizationGridSize: 101,
  });
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function replaceGeneratedJson(
  outputDirectory: string,
  fileName: 'entities.json' | 'map.topojson' | 'sources.json',
  value: unknown,
): Promise<void> {
  const bytes = stableJsonBytes(value);
  await writeFile(join(outputDirectory, fileName), bytes);
  const checksumKey = fileName === 'map.topojson' ? 'topology' : fileName.slice(0, -'.json'.length);
  const manifestFile = join(outputDirectory, 'manifest.json');
  const manifest = await readJson<Record<string, unknown> & { checksums: Record<string, string> }>(manifestFile);
  await writeFile(
    manifestFile,
    stableJsonBytes({ ...manifest, checksums: { ...manifest.checksums, [checksumKey]: sha256Bytes(bytes) } }),
  );
}

function absoluteArcIndex(reference: number): number {
  return reference < 0 ? ~reference : reference;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('deterministic content transformation', () => {
  it('parses the complete transform command interface and rejects missing inputs', () => {
    expect(parseTransformArguments([
      '--regions', 'raw/regions.geojson', '--entities', 'entities.json', '--manifest', 'manifest.json',
      '--source', 'source.json', '--output', 'out', '--source-crs', 'EPSG:4326',
      '--simplification-tolerance', '0.01', '--quantization-grid-size', '100001',
    ])).toEqual({
      regionsPath: 'raw/regions.geojson', entitiesPath: 'entities.json', manifestPath: 'manifest.json',
      sourcePath: 'source.json', outputDirectory: 'out', sourceCrs: 'EPSG:4326',
      simplificationTolerance: 0.01, quantizationGridSize: 100001,
    });
    expect(() => parseTransformArguments(['--regions', 'raw/regions.geojson'])).toThrow('Missing required option');
  });

  it('serializes object keys with ordinal ordering', () => {
    expect(stableJsonBytes({ 'ä': 1, z: 2, a: 3 }).toString('utf8')).toBe(
      '{\n  "a": 3,\n  "z": 2,\n  "ä": 1\n}\n',
    );
  });

  it('sorts identifiers with locale-independent ordinal ordering', () => {
    expect(compareOrdinal('ä', 'z')).toBeGreaterThan(0);
    expect(['ä', 'z', 'a'].sort(compareOrdinal)).toEqual(['a', 'z', 'ä']);
  });

  it('preserves stable IDs and reuses the shared border arc', async () => {
    const outputDirectory = await makeTemporaryDirectory('topology');

    await transformFixture(outputDirectory);

    const topology = await readJson<FixtureTopology>(join(outputDirectory, 'map.topojson'));
    const geometries = topology.objects.regions.geometries;
    expect(geometries.map((geometry) => geometry.id)).toEqual(['region-a', 'region-b']);
    const regionAArcs = new Set((geometries[0]?.arcs?.[0] ?? []).map(absoluteArcIndex));
    const regionBArcs = new Set((geometries[1]?.arcs?.[0] ?? []).map(absoluteArcIndex));
    expect([...regionAArcs].filter((arc) => regionBArcs.has(arc))).toHaveLength(1);
  });

  it('nodes a shared boundary when adjacent regions use different segmentation', () => {
    const topology = buildTopology([
      {
        id: 'a',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 2], [0, 2], [0, 0]]] },
      },
      {
        id: 'b',
        geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 2], [1, 2], [1, 1], [1, 0]]] },
      },
    ], 0, 101) as FixtureTopology;
    const [a, b] = topology.objects.regions.geometries;
    const aArcs = new Set((a?.arcs?.[0] ?? []).map(absoluteArcIndex));
    const bArcs = new Set((b?.arcs?.[0] ?? []).map(absoluteArcIndex));

    expect([...aArcs].filter((arc) => bArcs.has(arc))).toHaveLength(2);
  });

  it('rejects empty, zero-area, self-intersecting, and quantization-collapsed rings', () => {
    expect(() => buildTopology([
      { id: 'empty', geometry: { type: 'Polygon', coordinates: [] } },
    ], 0, 101)).toThrow();
    expect(() => buildTopology([
      { id: 'line', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [2, 0], [0, 0]]] } },
    ], 0, 101)).toThrow('area');
    expect(() => buildTopology([
      { id: 'bow-tie', geometry: { type: 'Polygon', coordinates: [[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]] } },
    ], 0, 101)).toThrow('self-intersect');
    expect(() => buildTopology([
      { id: 'large', geometry: { type: 'Polygon', coordinates: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] } },
      { id: 'tiny', geometry: { type: 'Polygon', coordinates: [[[1, 1], [1.1, 1], [1.1, 1.1], [1, 1.1], [1, 1]]] } },
    ], 0, 2)).toThrow('quantization');
  });

  it('records CRS normalization, simplification, quantization, and topology operations', async () => {
    const outputDirectory = await makeTemporaryDirectory('ledger');

    await transformFixture(outputDirectory);

    const sources = await readJson<readonly Record<string, unknown>[]>(join(outputDirectory, 'sources.json'));
    expect(sources[0]).toMatchObject({
      coordinateReferenceSystem: 'EPSG:4326',
      simplification: { algorithm: 'douglas-peucker', tolerance: 0 },
      quantization: { gridSize: 101 },
      processing: [
        { operation: 'normalize-coordinate-reference-system', parameters: { from: 'EPSG:4326', to: 'EPSG:4326' } },
        { operation: 'normalize-longitude-latitude', parameters: { longitudeRange: '[-180,180]', latitudeRange: '[-90,90]' } },
        { operation: 'simplify-geometry', parameters: { algorithm: 'douglas-peucker', tolerance: 0 } },
        { operation: 'quantize-coordinates', parameters: { gridSize: 101 } },
        { operation: 'build-topology', parameters: { sharedBoundaryStrategy: 'node-collinear-segments-and-deduplicate' } },
        {
          operation: 'bind-entity-input',
          parameters: {
            inputSha256: await sha256File(entitiesPath),
            outputSha256: await sha256File(join(outputDirectory, 'entities.json')),
          },
        },
      ],
    });
  });

  it('rejects source metadata whose declared CRS differs from the transform input', async () => {
    const outputDirectory = await makeTemporaryDirectory('source-crs-output');
    const metadataDirectory = await makeTemporaryDirectory('source-crs-metadata');
    const sourcePath = await writeSourceMetadata(metadataDirectory);
    const source = await readJson<Record<string, unknown>>(sourcePath);
    await writeFile(sourcePath, stableJsonBytes({
      ...source,
      coordinateReferenceSystem: 'EPSG:3857',
    }));

    await expect(transformContent({
      regionsPath,
      entitiesPath,
      manifestPath,
      sourcePath,
      outputDirectory,
      sourceCrs: 'EPSG:4326',
      simplificationTolerance: 0,
      quantizationGridSize: 101,
    })).rejects.toThrow('coordinate reference system');
  });

  it('refuses to overwrite an existing generated pack', async () => {
    const outputDirectory = await makeTemporaryDirectory('immutable-output');
    await writeFile(join(outputDirectory, 'sentinel.txt'), 'keep');
    const metadataDirectory = await makeTemporaryDirectory('immutable-metadata');

    await expect(transformContent({
      regionsPath,
      entitiesPath,
      manifestPath,
      sourcePath: await writeSourceMetadata(metadataDirectory),
      outputDirectory,
      sourceCrs: 'EPSG:4326',
      simplificationTolerance: 0,
      quantizationGridSize: 101,
    })).rejects.toThrow('already exists');
    await expect(readFile(join(outputDirectory, 'sentinel.txt'), 'utf8')).resolves.toBe('keep');
  });

  it('produces byte-identical files and hashes for identical inputs', async () => {
    const firstOutput = await makeTemporaryDirectory('first');
    const secondOutput = await makeTemporaryDirectory('second');

    await transformFixture(firstOutput);
    await transformFixture(secondOutput);

    for (const fileName of ['manifest.json', 'entities.json', 'map.topojson', 'sources.json']) {
      const first = await readFile(join(firstOutput, fileName));
      const second = await readFile(join(secondOutput, fileName));
      expect(second.equals(first), fileName).toBe(true);
      expect(sha256Bytes(second), fileName).toBe(sha256Bytes(first));
    }
  });

  it('rejects source metadata whose input hash does not match the raw GeoJSON', async () => {
    const outputDirectory = await makeTemporaryDirectory('source-hash-output');
    const metadataDirectory = await makeTemporaryDirectory('source-hash-metadata');
    const sourcePath = await writeSourceMetadata(metadataDirectory);
    const source = await readJson<Record<string, unknown>>(sourcePath);
    await writeFile(sourcePath, stableJsonBytes({ ...source, sha256: '0'.repeat(64) }));

    await expect(transformContent({
      regionsPath,
      entitiesPath,
      manifestPath,
      sourcePath,
      outputDirectory,
      sourceCrs: 'EPSG:4326',
      simplificationTolerance: 0,
      quantizationGridSize: 101,
    })).rejects.toThrow('input SHA-256');
  });

  it('rejects longitude and latitude outside EPSG:4326 bounds', async () => {
    const outputDirectory = await makeTemporaryDirectory('bounds-output');
    const inputDirectory = await makeTemporaryDirectory('bounds-input');
    const invalidRegionsPath = join(inputDirectory, 'regions.geojson');
    const regions = await readJson<Record<string, unknown> & { features: Array<Record<string, unknown>> }>(regionsPath);
    const invalidFeatures = regions.features.map((feature, index) => index === 0
      ? { ...feature, geometry: { type: 'Polygon', coordinates: [[[181, 0], [182, 0], [182, 1], [181, 1], [181, 0]]] } }
      : feature);
    await writeFile(invalidRegionsPath, stableJsonBytes({ ...regions, features: invalidFeatures }));
    const sourcePath = join(inputDirectory, 'source.json');
    await writeFile(sourcePath, stableJsonBytes({
      id: 'invalid-bounds', organization: 'Fixture Authority', url: 'https://example.invalid/invalid.geojson',
      retrievedAt: '2026-08-28', license: 'test-only', sha256: await sha256File(invalidRegionsPath),
      coordinateReferenceSystem: 'EPSG:4326', processing: [], simplification: null, quantization: null,
      reviewIdentifier: null,
    }));

    await expect(transformContent({
      regionsPath: invalidRegionsPath,
      entitiesPath,
      manifestPath,
      sourcePath,
      outputDirectory,
      sourceCrs: 'EPSG:4326',
      simplificationTolerance: 0,
      quantizationGridSize: 101,
    })).rejects.toThrow('longitude/latitude');
  });
});

describe('content pack validation', () => {
  it('accepts a generated fixture and exposes stable topology IDs', async () => {
    const outputDirectory = await makeTemporaryDirectory('valid');
    await transformFixture(outputDirectory);

    const result = await validateContentPack(outputDirectory);

    expect(result).toEqual({ ok: true, packId: 'content-pipeline-fixture' });
  });

  it('rejects a point outside its parent region', async () => {
    const outputDirectory = await makeTemporaryDirectory('outside');
    await transformFixture(outputDirectory);
    const entitiesFile = join(outputDirectory, 'entities.json');
    const entities = await readJson<Array<Record<string, unknown>>>(entitiesFile);
    const outsideEntities = entities.map((entity) => entity.id === 'city-a' ? { ...entity, coordinate: [5, 5] } : entity);
    await replaceGeneratedJson(outputDirectory, 'entities.json', outsideEntities);

    const result = await validateContentPack(outputDirectory);

    expect(result.ok).toBe(false);
    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'point_outside_region', path: 'entities.0.coordinate' }));
  });

  it('rejects broken references and declared capabilities that cannot generate questions', async () => {
    const outputDirectory = await makeTemporaryDirectory('references');
    await transformFixture(outputDirectory);
    const entities = await readJson<Array<Record<string, unknown>>>(join(outputDirectory, 'entities.json'));
    await replaceGeneratedJson(
      outputDirectory,
      'entities.json',
      entities.map((entity) => {
        if (entity.id === 'region-a') return { ...entity, capitalId: 'missing-place' };
        if (entity.kind === 'place') return { ...entity, capabilities: [] };
        return { ...entity, capabilities: [] };
      }),
    );

    const result = await validateContentPack(outputDirectory);

    expect(result.ok).toBe(false);
    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'missing_reference' }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'capability_mismatch' }));
  });

  it('rejects malformed topology arc references', async () => {
    const outputDirectory = await makeTemporaryDirectory('invalid-topology');
    await transformFixture(outputDirectory);
    const topology = await readJson<FixtureTopology>(join(outputDirectory, 'map.topojson'));
    const geometries = topology.objects.regions.geometries.map((geometry, index) =>
      index === 0 ? { ...geometry, arcs: [[999]] } : geometry,
    );
    await replaceGeneratedJson(outputDirectory, 'map.topojson', {
      ...topology,
      objects: { ...topology.objects, regions: { ...topology.objects.regions, geometries } },
    });

    const result = await validateContentPack(outputDirectory);

    expect(result.ok).toBe(false);
    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_topology' }));
  });

  it('rejects a discontinuous arc chain even when its endpoints form a closed ring', async () => {
    const outputDirectory = await makeTemporaryDirectory('discontinuous-topology');
    await transformFixture(outputDirectory);
    const topology = await readJson<FixtureTopology>(join(outputDirectory, 'map.topojson'));
    const geometries = topology.objects.regions.geometries.map((geometry, index) => {
      if (index !== 0) return geometry;
      const references = geometry.arcs?.[0] ?? [];
      return { ...geometry, arcs: [[references[0], references[2], references[1], ...references.slice(3)]] };
    });
    await replaceGeneratedJson(outputDirectory, 'map.topojson', {
      ...topology,
      objects: { ...topology.objects, regions: { ...topology.objects.regions, geometries } },
    });

    const result = await validateContentPack(outputDirectory);

    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'invalid_topology',
      message: expect.stringContaining('continuous'),
    }));
  });

  it('rejects non-integer TopoJSON delta coordinates', async () => {
    const outputDirectory = await makeTemporaryDirectory('fractional-topology');
    await transformFixture(outputDirectory);
    const topology = await readJson<FixtureTopology>(join(outputDirectory, 'map.topojson'));
    const arcs = topology.arcs.map((arc, arcIndex) => arc.map((position, positionIndex) =>
      arcIndex === 0 && positionIndex === 0 ? [position[0] + 0.5, position[1]] : position,
    ));
    await replaceGeneratedJson(outputDirectory, 'map.topojson', { ...topology, arcs });

    const result = await validateContentPack(outputDirectory);

    expect(result.ok).toBe(false);
    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'invalid_topology', path: 'map.topojson.arcs' }));
  });

  it('rejects incomplete source processing ledgers', async () => {
    const outputDirectory = await makeTemporaryDirectory('source-ledger');
    await transformFixture(outputDirectory);
    const sources = await readJson<Array<Record<string, unknown>>>(join(outputDirectory, 'sources.json'));
    await replaceGeneratedJson(outputDirectory, 'sources.json', sources.map((source) => ({ ...source, processing: [] })));

    const result = await validateContentPack(outputDirectory);

    expect(result.ok).toBe(false);
    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'source_metadata', path: 'sources.0.processing' }));
  });

  it('rejects source ledger parameters that disagree with generated content', async () => {
    const outputDirectory = await makeTemporaryDirectory('source-ledger-parameters');
    await transformFixture(outputDirectory);
    const sources = await readJson<Array<Record<string, unknown> & { processing: Array<Record<string, unknown>> }>>(join(outputDirectory, 'sources.json'));
    await replaceGeneratedJson(outputDirectory, 'sources.json', sources.map((source) => ({
      ...source,
      processing: source.processing.map((step) => step.operation === 'quantize-coordinates'
        ? { ...step, parameters: { gridSize: 999 } }
        : step),
    })));

    const result = await validateContentPack(outputDirectory);

    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'source_metadata' }));
  });

  it('rejects a manifest checksum that does not match generated bytes', async () => {
    const outputDirectory = await makeTemporaryDirectory('checksum');
    await transformFixture(outputDirectory);
    const manifestFile = join(outputDirectory, 'manifest.json');
    const manifest = await readJson<Record<string, unknown> & { checksums: Record<string, string> }>(manifestFile);
    await writeFile(manifestFile, stableJsonBytes({ ...manifest, checksums: { ...manifest.checksums, topology: '0'.repeat(64) } }));

    const result = await validateContentPack(outputDirectory);

    expect(result.ok).toBe(false);
    expectInvalid(result);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'checksum_mismatch', path: 'manifest.checksums.topology' }));
  });
});

describe('fetch-source.ps1', () => {
  const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'fetch-source.ps1');

  it('rejects non-HTTPS source URLs before downloading', () => {
    const result = spawnSync('pwsh', ['-NoProfile', '-File', scriptPath, '-Url', 'http://example.invalid/source', '-ExpectedSha256', '0'.repeat(64), '-Destination', join(dirname(scriptPath), 'raw', 'source.bin')], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('HTTPS');
  });

  it('rejects destinations outside scripts/content/raw before downloading', () => {
    const result = spawnSync('pwsh', ['-NoProfile', '-File', scriptPath, '-Url', 'https://example.invalid/source', '-ExpectedSha256', '0'.repeat(64), '-Destination', join(dirname(scriptPath), 'outside.bin')], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('raw');
  });

  it('fails closed and leaves no destination when downloaded bytes have the wrong hash', async () => {
    const destination = join(dirname(scriptPath), 'raw', `mismatch-${process.pid}.bin`);
    const command = `. '${scriptPath.split("'").join("''")}'; Invoke-VerifiedSourceFetch -Url 'https://example.invalid/source' -ExpectedSha256 '${'0'.repeat(64)}' -Destination '${destination.split("'").join("''")}' -DownloadAction { param($Uri, $Path) [IO.File]::WriteAllText($Path, 'wrong bytes') }`;

    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('SHA-256 mismatch');
    await expect(readFile(destination)).rejects.toThrow();
  });

  it('rejects a destination whose parent traverses a Windows junction', () => {
    const unique = `reparse-${process.pid}-${Date.now()}`;
    const scriptDirectory = dirname(scriptPath);
    const command = `. '${scriptPath.split("'").join("''")}'; $outside = Join-Path ([IO.Path]::GetTempPath()) '${unique}-outside'; $link = Join-Path (Join-Path '${scriptDirectory.split("'").join("''")}' 'raw') '${unique}-link'; New-Item -ItemType Directory -Path $outside -Force | Out-Null; New-Item -ItemType Directory -Path (Split-Path $link) -Force | Out-Null; New-Item -ItemType Junction -Path $link -Target $outside | Out-Null; try { Assert-SafeRawDestination -Destination (Join-Path $link 'payload.bin') } finally { Remove-Item -LiteralPath $link -Force; Remove-Item -LiteralPath $outside -Recurse -Force }`;

    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('reparse point');
  });
});

describe('validate CLI arguments', () => {
  it('rejects unknown and conflicting validation modes', () => {
    expect(() => parseValidationArguments(['--typo'])).toThrow('Unknown');
    expect(() => parseValidationArguments(['--fixture', '--all'])).toThrow('Choose exactly one');
  });

  it('accepts exactly one validation mode', () => {
    expect(parseValidationArguments(['--fixture'])).toEqual({ mode: 'fixture' });
    expect(parseValidationArguments(['--all'])).toEqual({ mode: 'all' });
    expect(parseValidationArguments(['pack-a', 'pack-b'])).toEqual({
      mode: 'directories',
      directories: ['pack-a', 'pack-b'],
    });
  });
});

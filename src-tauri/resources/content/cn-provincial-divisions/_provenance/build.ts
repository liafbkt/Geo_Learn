/** Pack-local preprocessing only: the shared project pipeline stays unchanged. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { geoArea } from 'd3-geo';
import type { ContentSource } from '../../../../../src/content/types';
import { transformContent } from '../../../../../scripts/content/transform';
import { validateContentPack } from '../../../../../scripts/content/validate';
import { sha256Bytes, stableJsonBytes } from '../../../../../scripts/content/lib/hash';
import { signedDoubleArea, validateSimpleClosedRing } from '../../../../../scripts/content/lib/ringGeometry';

type Position = [number, number];
type Geometry = { type: 'Polygon'; coordinates: Position[][] } | { type: 'MultiPolygon'; coordinates: Position[][][] };
type RosterRow = { id: string; names: { zh: string; en: string }; aliases: string[]; shapeID: string; sourceName: string; bbox: number[] };
type Receipt = { file: string; url: string; retrievedAt: string; bytes: number; sha256: string; role: string; uncompressedSha256?: string; uncompressedBytes?: number };
type Config = {
  packId: string; contentVersion: string; title: { zh: string; en: string }; count: number; rawFeatureCount: number;
  geometryFile: string; metadataFile: string; rosterSha256: string; receiptSha256: string; upstreamCommit: string;
  sourceYear: string; center: Position; organization: string; license: string; attribution: string; limitations: string[];
};
const files = ['manifest.json', 'entities.json', 'map.topojson', 'sources.json'] as const;
const capabilities = ['locate_region', 'identify_region'] as const;
const polygons = (geometry: Geometry) => geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
const bounds = (geometry: Geometry) => polygons(geometry).flat(2).reduce((box, p) => [
  Math.min(box[0]!, p[0]), Math.min(box[1]!, p[1]), Math.max(box[2]!, p[0]), Math.max(box[3]!, p[1]),
], [Infinity, Infinity, -Infinity, -Infinity]);
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;
function safeFilename(name: string): void {
  assert(typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name), `Unsafe source filename: ${name}`);
}

export async function verifySources(provenance: string): Promise<Receipt[]> {
  const receipts = await json<Receipt[]>(join(provenance, 'source-receipts.json'));
  assert(Array.isArray(receipts) && receipts.length > 0, 'Missing source receipts');
  // Validate the entire path list before touching any receipt-named file.
  receipts.forEach(row => safeFilename(row.file));
  assert.equal(new Set(receipts.map(row => row.file)).size, receipts.length, 'Duplicate source receipt');
  for (const row of receipts) {
    assert(/^[a-f0-9]{64}$/.test(row.sha256), 'Invalid source SHA-256');
    assert(row.url.startsWith('https://'), 'Source URL must use HTTPS');
    const bytes = await readFile(join(provenance, 'raw', row.file));
    assert.equal(sha256Bytes(bytes), row.sha256, `Source hash mismatch: ${row.file}`);
    assert.equal(bytes.length, row.bytes, `Source length mismatch: ${row.file}`);
    if (row.file.endsWith('.gz')) {
      const raw = gunzipSync(bytes);
      assert.equal(sha256Bytes(raw), row.uncompressedSha256, `Uncompressed source hash mismatch: ${row.file}`);
      assert.equal(raw.length, row.uncompressedBytes, 'Uncompressed source length mismatch');
    }
  }
  return receipts;
}

export async function resourceHashes(directory: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(files.map(async file => [file, sha256Bytes(await readFile(join(directory, file)))])));
}

/** Writes only to a new output directory; verifies original bytes before emitting anything. */
export async function reproducePack(packDirectory: string, outputDirectory: string) {
  const provenance = join(packDirectory, '_provenance');
  const configBytes = await readFile(join(provenance, 'config.json'));
  const config = JSON.parse(configBytes.toString('utf8')) as Config;
  assert(['cn-provincial-divisions', 'cn-shanghai-districts'].includes(config.packId), 'Unsupported pack');
  safeFilename(config.geometryFile);
  safeFilename(config.metadataFile);
  assert.equal(sha256Bytes(await readFile(join(provenance, 'source-receipts.json'))), config.receiptSha256, 'Source receipt pin mismatch');
  const receipts = await verifySources(provenance);
  const geometryReceipt = receipts.find(row => row.file === config.geometryFile && row.role === 'geometry');
  assert(geometryReceipt, 'Geometry must be bound to a pinned source');
  assert(receipts.some(row => row.file === config.metadataFile), 'Metadata must be pinned');
  const rosterBytes = await readFile(join(provenance, 'roster.json'));
  assert.equal(sha256Bytes(rosterBytes), config.rosterSha256, 'Roster hash mismatch');
  const roster = JSON.parse(rosterBytes.toString('utf8')) as RosterRow[];
  assert.equal(roster.length, config.count, 'Unexpected roster size');
  assert.equal(new Set(roster.map(row => row.id)).size, config.count, 'Duplicate stable ID');
  assert.equal(new Set(roster.map(row => row.shapeID)).size, config.count, 'Duplicate source identity');
  const stored = await readFile(join(provenance, 'raw', config.geometryFile));
  const rawBytes = config.geometryFile.endsWith('.gz') ? gunzipSync(stored) : stored;
  const raw = JSON.parse(rawBytes.toString('utf8')) as {
    crs: { properties: { name: string } };
    features: { properties: { shapeID: string; shapeName: string }; geometry: Geometry }[];
  };
  assert.equal(raw.crs.properties.name, 'urn:ogc:def:crs:OGC:1.3:CRS84', 'Declared WGS84 lon/lat required');
  assert.equal(raw.features.length, config.rawFeatureCount, 'Unexpected raw source count');
  const metadata = await json<{ boundaryYearRepresented: string }>(join(provenance, 'raw', config.metadataFile));
  assert.equal(metadata.boundaryYearRepresented, config.sourceYear);
  const geometry = { regions: config.count, rings: 0, vertices: 0, reversedRings: 0, removedVertices: 0, movedCoordinates: 0 };
  const regions = { type: 'FeatureCollection' as const, features: roster.map(row => {
    const matches = raw.features.filter(f => f.properties.shapeID === row.shapeID);
    assert.equal(matches.length, 1, `Source identity must be unique: ${row.id}`);
    const original = matches[0]!;
    assert.equal(original.properties.shapeName, row.sourceName, `Source label mismatch: ${row.id}`);
    assert.deepEqual(bounds(original.geometry), row.bbox, `Source bbox mismatch: ${row.id}`);
    const feature = { type: 'Feature' as const, id: row.id, properties: { sourceShapeID: row.shapeID }, geometry: structuredClone(original.geometry) };
    for (const polygon of polygons(feature.geometry)) for (const [index, ring] of polygon.entries()) {
      validateSimpleClosedRing(ring, row.id);
      for (const point of ring) assert(point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
      geometry.rings++;
      geometry.vertices += ring.length;
      if ((index === 0 && signedDoubleArea(ring) > 0) || (index > 0 && signedDoubleArea(ring) < 0)) {
        ring.reverse();
        geometry.reversedRings++;
      }
    }
    assert(geoArea(feature) > 0 && geoArea(feature) < 1, `Wrong spherical winding: ${row.id}`);
    return feature;
  }) };
  const entities = roster.map(row => ({ id: row.id, kind: 'region', names: row.names, aliases: row.aliases, capabilities }));
  const regionBytes = stableJsonBytes(regions);
  const source: ContentSource = {
    id: `${config.packId}-geoboundaries`, organization: config.organization, url: geometryReceipt.url,
    retrievedAt: geometryReceipt.retrievedAt, license: config.license, sha256: sha256Bytes(regionBytes),
    coordinateReferenceSystem: 'EPSG:4326', simplification: null, quantization: null, reviewIdentifier: null,
    processing: [
      { operation: 'pin-original-sources-and-permissions', parameters: { commit: config.upstreamCommit, receiptSha256: config.receiptSha256 } },
      ...receipts.map(row => ({ operation: 'pin-source-file', parameters: {
        file: row.file, url: row.url, retrievedAt: row.retrievedAt, bytes: row.bytes, sha256: row.sha256, role: row.role,
        uncompressedSha256: row.uncompressedSha256 ?? null, uncompressedBytes: row.uncompressedBytes ?? null,
      } })),
      { operation: 'bind-reviewed-roster', parameters: { rosterSha256: config.rosterSha256, configSha256: sha256Bytes(configBytes), count: config.count, selection: 'unique shapeID plus exact original name and bbox', naming: 'Official Chinese/English facts; explicit geographic short names. Guangdong and Ningxia source typos corrected, not accepted as aliases.' } },
      { operation: 'select-source-features', parameters: { originalFileSha256: sha256Bytes(rawBytes), originalFeatureCount: config.rawFeatureCount, selectedFeatureCount: config.count, yearRepresented: config.sourceYear } },
      { operation: 'adapt-declared-crs84-to-project-wgs84-lonlat', parameters: { input: raw.crs.properties.name, output: 'EPSG:4326 longitude,latitude array contract', coordinateValuesUnchanged: true, reference: 'https://www.rfc-editor.org/rfc/rfc7946#section-4' } },
      { operation: 'normalize-d3-ring-winding', parameters: geometry },
      { operation: 'retain-attribution-and-limitations', parameters: { attribution: config.attribution, limitations: config.limitations.join(' '), geometryInputSha256: sha256Bytes(regionBytes), entityInputSha256: sha256Bytes(stableJsonBytes(entities)), reviewStatus: 'development-only; no named-human or statutory public-release approval' } },
    ],
  };
  const manifest = { schemaVersion: 1, contentVersion: config.contentVersion, packId: config.packId, title: config.title,
    primaryAnswerLanguage: 'zh', expectedEntityCounts: { region: config.count, place: 0 }, capabilities,
    defaultViewport: { center: config.center, scale: 800 }, distributionStatus: 'development-only' };
  await mkdir(outputDirectory); // No overwrite of existing generation/evidence directories.
  const inputs = join(outputDirectory, 'inputs');
  await mkdir(inputs);
  for (const [name, value] of Object.entries({ 'regions.geojson': regions, 'entities.input.json': entities, 'manifest.template.json': manifest, 'source.input.json': source })) {
    await writeFile(join(inputs, name), stableJsonBytes(value));
  }
  const output = join(outputDirectory, 'pack');
  await transformContent({ regionsPath: join(inputs, 'regions.geojson'), entitiesPath: join(inputs, 'entities.input.json'),
    manifestPath: join(inputs, 'manifest.template.json'), sourcePath: join(inputs, 'source.input.json'), outputDirectory: output,
    sourceCrs: 'EPSG:4326', simplificationTolerance: 0, quantizationGridSize: 1000000 });
  const firstHashes = await resourceHashes(output);
  const firstValidation = await validateContentPack(output);
  assert.deepEqual(firstValidation, { ok: true, packId: config.packId });
  assert.deepEqual(await validateContentPack(output), firstValidation);
  assert.deepEqual(await resourceHashes(output), firstHashes);
  return { packId: config.packId, geometry, rawSourceFiles: receipts.length, hashes: firstHashes,
    validations: [firstValidation, firstValidation], unchangedAfterValidation: true };
}

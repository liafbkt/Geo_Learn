import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentSource, Entity } from '../../src/content/types';
import { entitySchema } from '../../src/content/schema';
import { compareOrdinal, sha256Bytes, sha256File, stableJsonBytes } from './lib/hash';
import { buildTopology, type RegionFeature, type SupportedGeometry } from './lib/topology';

type FeatureCollection = Readonly<{
  type: 'FeatureCollection';
  features: readonly Readonly<{
    type: 'Feature';
    id?: string | number;
    properties?: Readonly<Record<string, unknown>> | null;
    geometry: SupportedGeometry;
  }>[];
}>;

export type TransformContentOptions = Readonly<{
  regionsPath: string;
  entitiesPath: string;
  manifestPath: string;
  sourcePath: string;
  outputDirectory: string;
  sourceCrs: string;
  simplificationTolerance: number;
  quantizationGridSize: number;
}>;

const transformOptionNames = {
  '--regions': 'regionsPath',
  '--entities': 'entitiesPath',
  '--manifest': 'manifestPath',
  '--source': 'sourcePath',
  '--output': 'outputDirectory',
  '--source-crs': 'sourceCrs',
  '--simplification-tolerance': 'simplificationTolerance',
  '--quantization-grid-size': 'quantizationGridSize',
} as const;

export function parseTransformArguments(args: readonly string[]): TransformContentOptions {
  const values = new Map<keyof TransformContentOptions, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === undefined || !(option in transformOptionNames)) {
      throw new Error(`Unknown transform option: ${option ?? ''}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for transform option: ${option}`);
    }
    const key = transformOptionNames[option as keyof typeof transformOptionNames];
    if (values.has(key)) throw new Error(`Duplicate transform option: ${option}`);
    values.set(key, value);
  }
  for (const key of Object.values(transformOptionNames)) {
    if (!values.has(key)) throw new Error(`Missing required option: ${key}`);
  }
  const required = (key: keyof TransformContentOptions): string => {
    const value = values.get(key);
    if (value === undefined) throw new Error(`Missing required option: ${key}`);
    return value;
  };
  const simplificationTolerance = Number(required('simplificationTolerance'));
  const quantizationGridSize = Number(required('quantizationGridSize'));
  if (!Number.isFinite(simplificationTolerance)) {
    throw new Error('Simplification tolerance must be a finite number.');
  }
  if (!Number.isInteger(quantizationGridSize)) {
    throw new Error('Quantization grid size must be an integer.');
  }
  return {
    regionsPath: required('regionsPath'),
    entitiesPath: required('entitiesPath'),
    manifestPath: required('manifestPath'),
    sourcePath: required('sourcePath'),
    outputDirectory: required('outputDirectory'),
    sourceCrs: required('sourceCrs'),
    simplificationTolerance,
    quantizationGridSize,
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part));
}

function parseRing(value: unknown, regionId: string): readonly (readonly [number, number])[] {
  if (!Array.isArray(value) || !value.every(isPosition)) {
    throw new Error(`Region ${regionId} rings must contain numeric longitude/latitude pairs.`);
  }
  value.forEach(([longitude, latitude]) => {
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      throw new Error(`Region ${regionId} has a longitude/latitude value outside EPSG:4326 bounds.`);
    }
  });
  return value;
}

function parseGeometry(value: unknown, regionId: string): SupportedGeometry {
  if (!isRecord(value) || (value.type !== 'Polygon' && value.type !== 'MultiPolygon') || !Array.isArray(value.coordinates)) {
    throw new Error(`Region ${regionId} must use Polygon or MultiPolygon geometry.`);
  }
  if (value.type === 'Polygon') {
    return { type: 'Polygon', coordinates: value.coordinates.map((ring) => parseRing(ring, regionId)) };
  }
  return {
    type: 'MultiPolygon',
    coordinates: value.coordinates.map((polygon) => {
      if (!Array.isArray(polygon)) throw new Error(`Region ${regionId} multipolygons must contain polygons.`);
      return polygon.map((ring) => parseRing(ring, regionId));
    }),
  };
}

function parseRegions(input: unknown): readonly RegionFeature[] {
  if (!isRecord(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('Regions input must be a GeoJSON FeatureCollection.');
  }
  const collection = input as FeatureCollection;
  const regions = collection.features.map((feature, index) => {
    const propertyId = feature.properties?.id;
    const rawId = feature.id ?? propertyId;
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      throw new Error(`Region feature ${index} must have a stable string ID.`);
    }
    return { id: rawId, geometry: parseGeometry(feature.geometry, rawId) };
  });
  const ids = new Set<string>();
  regions.forEach(({ id }) => {
    if (ids.has(id)) throw new Error(`Duplicate region feature ID: ${id}.`);
    ids.add(id);
  });
  return regions;
}

function parseEntities(input: unknown): readonly Entity[] {
  if (!Array.isArray(input)) throw new Error('Entities input must be an array.');
  return input.map((entity, index) => {
    const parsed = entitySchema.safeParse(entity);
    if (!parsed.success) throw new Error(`Invalid entity ${index}: ${parsed.error.message}`);
    return parsed.data;
  }).sort((left, right) => compareOrdinal(left.id, right.id));
}

function parseSource(input: unknown, options: TransformContentOptions): ContentSource {
  if (!isRecord(input)) throw new Error('Source metadata must be an object.');
  const processing = [
    { operation: 'normalize-coordinate-reference-system', parameters: { from: options.sourceCrs, to: 'EPSG:4326' } },
    { operation: 'normalize-longitude-latitude', parameters: { longitudeRange: '[-180,180]', latitudeRange: '[-90,90]' } },
    { operation: 'simplify-geometry', parameters: { algorithm: 'douglas-peucker', tolerance: options.simplificationTolerance } },
    { operation: 'quantize-coordinates', parameters: { gridSize: options.quantizationGridSize } },
    { operation: 'build-topology', parameters: { sharedBoundaryStrategy: 'deduplicate-directed-segments' } },
  ] as const;
  return {
    id: String(input.id ?? ''),
    organization: String(input.organization ?? ''),
    url: String(input.url ?? ''),
    retrievedAt: String(input.retrievedAt ?? ''),
    license: String(input.license ?? ''),
    sha256: String(input.sha256 ?? ''),
    coordinateReferenceSystem: options.sourceCrs,
    processing,
    simplification: { algorithm: 'douglas-peucker', tolerance: options.simplificationTolerance },
    quantization: { gridSize: options.quantizationGridSize },
    reviewIdentifier: typeof input.reviewIdentifier === 'string' ? input.reviewIdentifier : null,
  };
}

export async function transformContent(options: TransformContentOptions): Promise<void> {
  if (options.sourceCrs !== 'EPSG:4326') {
    throw new Error('Only EPSG:4326 input is supported; reproject authoritative source data explicitly before transformation.');
  }
  if (!Number.isFinite(options.simplificationTolerance) || options.simplificationTolerance < 0) {
    throw new Error('Simplification tolerance must be a non-negative finite number.');
  }

  const [regionsInput, entitiesInput, manifestInput, sourceInput] = await Promise.all([
    readJson(options.regionsPath),
    readJson(options.entitiesPath),
    readJson(options.manifestPath),
    readJson(options.sourcePath),
  ]);
  if (!isRecord(manifestInput)) throw new Error('Manifest template must be an object.');

  const regions = parseRegions(regionsInput);
  const entities = parseEntities(entitiesInput);
  const topology = buildTopology(regions, options.simplificationTolerance, options.quantizationGridSize);
  const sources = [parseSource(sourceInput, options)];
  const inputHash = await sha256File(options.regionsPath);
  if (sources[0]?.sha256.toLowerCase() !== inputHash) {
    throw new Error(`Source metadata input SHA-256 does not match ${options.regionsPath}.`);
  }
  const entityBytes = stableJsonBytes(entities);
  const topologyBytes = stableJsonBytes(topology);
  const sourceBytes = stableJsonBytes(sources);
  const manifest = {
    ...manifestInput,
    checksums: {
      entities: sha256Bytes(entityBytes),
      topology: sha256Bytes(topologyBytes),
      sources: sha256Bytes(sourceBytes),
    },
  };

  await mkdir(options.outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(join(options.outputDirectory, 'entities.json'), entityBytes),
    writeFile(join(options.outputDirectory, 'map.topojson'), topologyBytes),
    writeFile(join(options.outputDirectory, 'sources.json'), sourceBytes),
    writeFile(join(options.outputDirectory, 'manifest.json'), stableJsonBytes(manifest)),
  ]);
}

async function main(): Promise<void> {
  const options = parseTransformArguments(process.argv.slice(2).filter((argument) => argument !== '--'));
  await transformContent(options);
  console.log(`Generated deterministic content pack files in ${options.outputDirectory}.`);
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

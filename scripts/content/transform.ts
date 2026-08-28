import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ContentSource, Entity } from '../../src/content/types';
import { contentSourceSchema, entitySchema } from '../../src/content/schema';
import { validatePack } from '../../src/content/validatePack';
import { compareOrdinal, sha256Bytes, sha256File, stableJsonBytes } from './lib/hash';
import { buildTopology, type RegionFeature, type SupportedGeometry } from './lib/topology';
import { validateSimpleClosedRing } from './lib/ringGeometry';

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
  validateSimpleClosedRing(value, `Region ${regionId} ring`);
  return value;
}

function parseGeometry(value: unknown, regionId: string): SupportedGeometry {
  if (!isRecord(value) || (value.type !== 'Polygon' && value.type !== 'MultiPolygon') || !Array.isArray(value.coordinates)) {
    throw new Error(`Region ${regionId} must use Polygon or MultiPolygon geometry.`);
  }
  if (value.type === 'Polygon') {
    if (value.coordinates.length === 0) throw new Error(`Region ${regionId} Polygon must contain at least one ring.`);
    return { type: 'Polygon', coordinates: value.coordinates.map((ring) => parseRing(ring, regionId)) };
  }
  if (value.coordinates.length === 0) throw new Error(`Region ${regionId} MultiPolygon must contain at least one polygon.`);
  return {
    type: 'MultiPolygon',
    coordinates: value.coordinates.map((polygon) => {
      if (!Array.isArray(polygon) || polygon.length === 0) throw new Error(`Region ${regionId} multipolygons must contain non-empty polygons.`);
      return polygon.map((ring) => parseRing(ring, regionId));
    }),
  };
}

function parseRegions(input: unknown): readonly RegionFeature[] {
  if (!isRecord(input) || input.type !== 'FeatureCollection' || !Array.isArray(input.features)) {
    throw new Error('Regions input must be a GeoJSON FeatureCollection.');
  }
  if (input.features.length === 0) throw new Error('Regions input must contain at least one feature.');
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

function parseSource(
  input: unknown,
  options: TransformContentOptions,
  entityInputSha256: string,
  entityOutputSha256: string,
): ContentSource {
  const parsed = contentSourceSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Invalid source metadata: ${parsed.error.message}`);
  if (parsed.data.coordinateReferenceSystem !== options.sourceCrs) {
    throw new Error(
      `Source coordinate reference system ${parsed.data.coordinateReferenceSystem} does not match ${options.sourceCrs}.`,
    );
  }
  if (parsed.data.simplification !== null || parsed.data.quantization !== null) {
    throw new Error('Source metadata must describe the pinned raw input before this pipeline simplifies or quantizes it.');
  }
  const processing = [
    { operation: 'normalize-coordinate-reference-system', parameters: { from: options.sourceCrs, to: 'EPSG:4326' } },
    { operation: 'normalize-longitude-latitude', parameters: { longitudeRange: '[-180,180]', latitudeRange: '[-90,90]' } },
    { operation: 'simplify-geometry', parameters: { algorithm: 'douglas-peucker', tolerance: options.simplificationTolerance } },
    { operation: 'quantize-coordinates', parameters: { gridSize: options.quantizationGridSize } },
    { operation: 'build-topology', parameters: { sharedBoundaryStrategy: 'node-collinear-segments-and-deduplicate' } },
    { operation: 'bind-entity-input', parameters: { inputSha256: entityInputSha256, outputSha256: entityOutputSha256 } },
  ] as const;
  return {
    ...parsed.data,
    processing: [...parsed.data.processing, ...processing],
    simplification: { algorithm: 'douglas-peucker', tolerance: options.simplificationTolerance },
    quantization: { gridSize: options.quantizationGridSize },
  };
}

async function inspectOutputDirectory(path: string): Promise<'missing' | 'empty'> {
  try {
    const information = await lstat(path);
    if (information.isSymbolicLink()) throw new Error(`Output directory cannot be a symbolic link: ${path}`);
    if (!information.isDirectory()) throw new Error(`Output path already exists and is not a directory: ${path}`);
    if ((await readdir(path)).length > 0) throw new Error(`Output directory already exists and is not empty: ${path}`);
    return 'empty';
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return 'missing';
    throw error;
  }
}

export async function transformContent(options: TransformContentOptions): Promise<void> {
  if (options.sourceCrs !== 'EPSG:4326') {
    throw new Error('Only EPSG:4326 input is supported; reproject authoritative source data explicitly before transformation.');
  }
  if (options.simplificationTolerance !== 0) {
    throw new Error('Version 1 requires simplification tolerance 0 so shared boundaries remain topologically identical.');
  }

  const resolvedOutputDirectory = resolve(options.outputDirectory);
  const outputState = await inspectOutputDirectory(resolvedOutputDirectory);
  const [regionsInput, entitiesInput, manifestInput, sourceInput, inputHash, entityInputHash] = await Promise.all([
    readJson(options.regionsPath),
    readJson(options.entitiesPath),
    readJson(options.manifestPath),
    readJson(options.sourcePath),
    sha256File(options.regionsPath),
    sha256File(options.entitiesPath),
  ]);
  if (!isRecord(manifestInput)) throw new Error('Manifest template must be an object.');

  const regions = parseRegions(regionsInput);
  const entities = parseEntities(entitiesInput);
  const topology = buildTopology(regions, options.simplificationTolerance, options.quantizationGridSize);
  if (!isRecord(sourceInput) || typeof sourceInput.sha256 !== 'string' || sourceInput.sha256.toLowerCase() !== inputHash) {
    throw new Error(`Source metadata input SHA-256 does not match ${options.regionsPath}.`);
  }
  const entityBytes = stableJsonBytes(entities);
  const topologyBytes = stableJsonBytes(topology);
  const sources = [parseSource(sourceInput, options, entityInputHash, sha256Bytes(entityBytes))];
  const sourceBytes = stableJsonBytes(sources);
  const manifest = {
    ...manifestInput,
    checksums: {
      entities: sha256Bytes(entityBytes),
      topology: sha256Bytes(topologyBytes),
      sources: sha256Bytes(sourceBytes),
    },
  };
  const validation = validatePack({
    manifest,
    entities,
    sources,
    topologyObjectIds: regions.map(({ id }) => id),
    topologyPoints: [],
  });
  if (!validation.ok) {
    throw new Error(`Generated pack failed validation: ${validation.issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`);
  }

  const outputParent = dirname(resolvedOutputDirectory);
  await mkdir(outputParent, { recursive: true });
  const stagingDirectory = await mkdtemp(join(outputParent, `.${basename(resolvedOutputDirectory)}-staging-`));
  try {
    await Promise.all([
      writeFile(join(stagingDirectory, 'entities.json'), entityBytes),
      writeFile(join(stagingDirectory, 'map.topojson'), topologyBytes),
      writeFile(join(stagingDirectory, 'sources.json'), sourceBytes),
      writeFile(join(stagingDirectory, 'manifest.json'), stableJsonBytes(manifest)),
    ]);
    const { validateContentPack } = await import('./validate');
    const stagedValidation = await validateContentPack(stagingDirectory);
    if (!stagedValidation.ok) {
      throw new Error(`Staged pack failed validation: ${stagedValidation.issues.map((entry) => `${entry.path}: ${entry.message}`).join('; ')}`);
    }
    if (outputState === 'empty') await rm(resolvedOutputDirectory, { recursive: true });
    await rename(stagingDirectory, resolvedOutputDirectory);
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
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

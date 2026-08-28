import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Entity, PackValidationIssue } from '../../src/content/types';
import { validatePack } from '../../src/content/validatePack';
import { compareOrdinal, sha256Bytes, sha256File, stableJsonBytes } from './lib/hash';
import { pointInMultiPolygon, pointInPolygon, type MultiPolygonCoordinates, type PolygonCoordinates, type Position } from './lib/pointInRegion';
import { samePosition, validateSimpleClosedRing } from './lib/ringGeometry';
import { transformContent } from './transform';

type ValidationResult =
  | Readonly<{ ok: true; packId: string }>
  | Readonly<{ ok: false; issues: readonly PackValidationIssue[] }>;

type TopologyTransform = Readonly<{ scale: Position; translate: Position }>;
type TopologyGeometry = Readonly<{ type: string; id?: unknown; arcs?: unknown; geometries?: unknown }>;
type ParsedTopology = Readonly<{
  type: 'Topology';
  transform: TopologyTransform;
  arcs: readonly (readonly Position[])[];
  objects: Readonly<Record<string, TopologyGeometry>>;
}>;

function issue(code: PackValidationIssue['code'], path: string, message: string): PackValidationIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPosition(value: unknown): value is Position {
  return Array.isArray(value) && value.length === 2 && value.every((number) => typeof number === 'number' && Number.isFinite(number));
}

function parseTopology(value: unknown): ParsedTopology | PackValidationIssue {
  if (!isRecord(value) || value.type !== 'Topology' || !isRecord(value.transform) || !Array.isArray(value.arcs) || !isRecord(value.objects)) {
    return issue('invalid_topology', 'map.topojson', 'Expected a TopoJSON Topology with transform, objects, and arcs.');
  }
  if (!isPosition(value.transform.scale) || !isPosition(value.transform.translate) || value.transform.scale.some((part) => part <= 0)) {
    return issue('invalid_topology', 'map.topojson.transform', 'Topology transform must contain positive scale and finite translate pairs.');
  }
  if (!value.arcs.every((arc) => Array.isArray(arc) && arc.length >= 2 && arc.every((position) =>
    isPosition(position) && position.every(Number.isInteger)))) {
    return issue('invalid_topology', 'map.topojson.arcs', 'Every topology arc must contain at least two integer delta positions.');
  }
  return value as ParsedTopology;
}

function decodeArcGrid(topology: ParsedTopology, reference: number): readonly Position[] | undefined {
  const arcIndex = reference < 0 ? ~reference : reference;
  const encoded = topology.arcs[arcIndex];
  if (encoded === undefined) return undefined;
  let x = 0;
  let y = 0;
  const decoded: Position[] = encoded.map(([deltaX, deltaY]) => {
    x += deltaX;
    y += deltaY;
    return [x, y] as const;
  });
  return reference < 0 ? decoded.reverse() : decoded;
}

function decodeRing(topology: ParsedTopology, references: unknown, path: string, issues: PackValidationIssue[]): readonly Position[] | undefined {
  if (!Array.isArray(references) || references.length === 0 || !references.every(Number.isInteger)) {
    issues.push(issue('invalid_topology', path, 'Polygon ring must contain integer arc references.'));
    return undefined;
  }
  const gridRing: Position[] = [];
  for (const [index, reference] of references.entries()) {
    const decoded = decodeArcGrid(topology, reference as number);
    if (decoded === undefined) {
      issues.push(issue('invalid_topology', `${path}.${index}`, `Arc reference ${String(reference)} is out of range.`));
      return undefined;
    }
    if (gridRing.length > 0 && !samePosition(gridRing[gridRing.length - 1]!, decoded[0]!)) {
      issues.push(issue('invalid_topology', `${path}.${index}`, 'Polygon arc references must form a continuous chain.'));
      return undefined;
    }
    gridRing.push(...(gridRing.length === 0 ? decoded : decoded.slice(1)));
  }
  try {
    validateSimpleClosedRing(gridRing, 'Decoded polygon ring');
  } catch (error) {
    issues.push(issue('invalid_topology', path, error instanceof Error ? error.message : String(error)));
    return undefined;
  }
  const ring = gridRing.map(([x, y]) => [
    x * topology.transform.scale[0] + topology.transform.translate[0],
    y * topology.transform.scale[1] + topology.transform.translate[1],
  ] as const);
  const invalidIndex = ring.findIndex(([longitude, latitude]) => longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90);
  if (invalidIndex >= 0) {
    issues.push(issue('invalid_topology', `${path}.${invalidIndex}`, 'Decoded coordinates must be valid longitude/latitude values.'));
    return undefined;
  }
  return ring;
}

type RegionShape = Readonly<{ type: 'Polygon'; coordinates: PolygonCoordinates }> | Readonly<{ type: 'MultiPolygon'; coordinates: MultiPolygonCoordinates }>;

function extractRegions(topology: ParsedTopology, issues: PackValidationIssue[]): ReadonlyMap<string, RegionShape> {
  const regions = new Map<string, RegionShape>();
  const visit = (geometry: TopologyGeometry, path: string): void => {
    if (geometry.type === 'GeometryCollection') {
      if (!Array.isArray(geometry.geometries)) {
        issues.push(issue('invalid_topology', `${path}.geometries`, 'GeometryCollection must contain geometries.'));
        return;
      }
      geometry.geometries.forEach((child, index) => {
        if (!isRecord(child) || typeof child.type !== 'string') {
          issues.push(issue('invalid_topology', `${path}.geometries.${index}`, 'Geometry must be an object.'));
        } else visit(child as TopologyGeometry, `${path}.geometries.${index}`);
      });
      return;
    }
    if (typeof geometry.id !== 'string' || geometry.id.length === 0 || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) {
      issues.push(issue('invalid_topology', path, 'Region geometries require a stable string ID and Polygon or MultiPolygon type.'));
      return;
    }
    if (regions.has(geometry.id)) {
      issues.push(issue('invalid_topology', `${path}.id`, `Duplicate topology geometry ID: ${geometry.id}.`));
      return;
    }
    if (!Array.isArray(geometry.arcs) || geometry.arcs.length === 0) {
      issues.push(issue('invalid_topology', `${path}.arcs`, 'Region geometry must contain at least one polygon ring.'));
      return;
    }
    if (geometry.type === 'Polygon') {
      const rings = geometry.arcs.map((references, index) => decodeRing(topology, references, `${path}.arcs.${index}`, issues));
      if (rings.every((ring) => ring !== undefined)) regions.set(geometry.id, { type: 'Polygon', coordinates: rings as PolygonCoordinates });
      return;
    }
    const polygons = geometry.arcs.map((polygon, polygonIndex) => {
      if (!Array.isArray(polygon) || polygon.length === 0) {
        issues.push(issue('invalid_topology', `${path}.arcs.${polygonIndex}`, 'MultiPolygon member must contain at least one ring.'));
        return undefined;
      }
      const rings = polygon.map((references, ringIndex) => decodeRing(topology, references, `${path}.arcs.${polygonIndex}.${ringIndex}`, issues));
      return rings.every((ring) => ring !== undefined) ? rings as PolygonCoordinates : undefined;
    });
    if (polygons.every((polygon) => polygon !== undefined)) regions.set(geometry.id, { type: 'MultiPolygon', coordinates: polygons as MultiPolygonCoordinates });
  };
  Object.entries(topology.objects).sort(([left], [right]) => compareOrdinal(left, right)).forEach(([objectId, geometry]) => visit(geometry, `map.topojson.objects.${objectId}`));
  return regions;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function validateSourceLedger(sources: unknown, entityHash: string, issues: PackValidationIssue[]): void {
  if (!Array.isArray(sources)) return;
  sources.forEach((source, index) => {
    if (!isRecord(source) || !Array.isArray(source.processing)) return;
    const simplification = isRecord(source.simplification) ? source.simplification : null;
    const quantization = isRecord(source.quantization) ? source.quantization : null;
    const expected = [
      { operation: 'normalize-coordinate-reference-system', parameters: { from: 'EPSG:4326', to: 'EPSG:4326' } },
      { operation: 'normalize-longitude-latitude', parameters: { longitudeRange: '[-180,180]', latitudeRange: '[-90,90]' } },
      { operation: 'simplify-geometry', parameters: { algorithm: 'douglas-peucker', tolerance: simplification?.tolerance } },
      { operation: 'quantize-coordinates', parameters: { gridSize: quantization?.gridSize } },
      { operation: 'build-topology', parameters: { sharedBoundaryStrategy: 'node-collinear-segments-and-deduplicate' } },
    ];
    const suffix = source.processing.slice(-6);
    const entityBinding = suffix[5];
    const metadataMatches = source.coordinateReferenceSystem === 'EPSG:4326' &&
      simplification?.algorithm === 'douglas-peucker' && typeof simplification.tolerance === 'number' &&
      typeof quantization?.gridSize === 'number' &&
      expected.every((step, stepIndex) => stableJsonBytes(suffix[stepIndex]).equals(stableJsonBytes(step))) &&
      isRecord(entityBinding) && entityBinding.operation === 'bind-entity-input' &&
      isRecord(entityBinding.parameters) &&
      typeof entityBinding.parameters.inputSha256 === 'string' && /^[a-f0-9]{64}$/i.test(entityBinding.parameters.inputSha256) &&
      entityBinding.parameters.outputSha256 === entityHash;
    if (!metadataMatches) {
      issues.push(issue('source_metadata', `sources.${index}.processing`, 'Source processing parameters do not match the generated pack.'));
    }
  });
}

function validatePlaces(entities: readonly Entity[], regions: ReadonlyMap<string, RegionShape>, issues: PackValidationIssue[]): void {
  entities.forEach((entity, index) => {
    if (entity.kind !== 'place' || entity.parentId === undefined) return;
    const region = regions.get(entity.parentId);
    if (region === undefined) return;
    const inside = region.type === 'Polygon'
      ? pointInPolygon(entity.coordinate, region.coordinates)
      : pointInMultiPolygon(entity.coordinate, region.coordinates);
    if (!inside) issues.push(issue('point_outside_region', `entities.${index}.coordinate`, `Place ${entity.id} is outside parent region ${entity.parentId}.`));
  });
}

export async function validateContentPack(directory: string): Promise<ValidationResult> {
  const [manifest, entities, sources, topologyValue, entityHash, topologyHash, sourceHash] = await Promise.all([
    readJson(join(directory, 'manifest.json')),
    readJson(join(directory, 'entities.json')),
    readJson(join(directory, 'sources.json')),
    readJson(join(directory, 'map.topojson')),
    sha256File(join(directory, 'entities.json')),
    sha256File(join(directory, 'map.topojson')),
    sha256File(join(directory, 'sources.json')),
  ]);
  const topology = parseTopology(topologyValue);
  if ('code' in topology) return { ok: false, issues: [topology] };
  const topologyIssues: PackValidationIssue[] = [];
  const regions = extractRegions(topology, topologyIssues);
  const core = validatePack({ manifest, entities, sources, topologyObjectIds: [...regions.keys()], topologyPoints: [] });
  const issues = core.ok ? [...topologyIssues] : [...core.issues, ...topologyIssues];

  if (isRecord(manifest) && isRecord(manifest.checksums)) {
    const checksums = manifest.checksums;
    const actual = { entities: entityHash, topology: topologyHash, sources: sourceHash };
    (Object.keys(actual) as Array<keyof typeof actual>).forEach((key) => {
      if (checksums[key] !== actual[key]) issues.push(issue('checksum_mismatch', `manifest.checksums.${key}`, `Expected ${String(checksums[key])} but found ${actual[key]}.`));
    });
  }
  validateSourceLedger(sources, entityHash, issues);
  if (core.ok) validatePlaces(core.pack.entities, regions, issues);
  return issues.length === 0
    ? { ok: true, packId: core.ok ? core.pack.manifest.packId : '' }
    : { ok: false, issues };
}

async function validateFixture(): Promise<void> {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const fixtureDirectory = join(scriptDirectory, 'fixtures');
  const first = await mkdtemp(join(tmpdir(), 'geolearn-content-first-'));
  const second = await mkdtemp(join(tmpdir(), 'geolearn-content-second-'));
  try {
    const sourcePath = join(fixtureDirectory, 'source.json');
    const options = {
      regionsPath: join(fixtureDirectory, 'regions.geojson'),
      entitiesPath: join(fixtureDirectory, 'entities.json'),
      manifestPath: join(fixtureDirectory, 'manifest.template.json'),
      sourcePath,
      sourceCrs: 'EPSG:4326',
      simplificationTolerance: 0,
      quantizationGridSize: 101,
    } as const;
    await transformContent({ ...options, outputDirectory: first });
    await transformContent({ ...options, outputDirectory: second });
    for (const fileName of ['manifest.json', 'entities.json', 'map.topojson', 'sources.json']) {
      const [left, right] = await Promise.all([readFile(join(first, fileName)), readFile(join(second, fileName))]);
      if (sha256Bytes(left) !== sha256Bytes(right)) throw new Error(`Fixture output is not deterministic: ${fileName}.`);
    }
    const result = await validateContentPack(first);
    if (!result.ok) throw new Error(result.issues.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join('\n'));
    console.log(`Validated fixture pack ${result.packId}; repeated output hashes are identical.`);
  } finally {
    await Promise.all([rm(first, { recursive: true, force: true }), rm(second, { recursive: true, force: true })]);
  }
}

async function main(): Promise<void> {
  const parsed = parseValidationArguments(process.argv.slice(2));
  if (parsed.mode === 'fixture') {
    await validateFixture();
    return;
  }
  const directories = parsed.mode === 'all'
    ? (await readdir(resolve('src-tauri/resources/content'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => resolve('src-tauri/resources/content', entry.name))
    : parsed.directories.map((directory) => resolve(directory));
  let failed = false;
  for (const directory of directories.sort(compareOrdinal)) {
    const result = await validateContentPack(directory);
    if (result.ok) console.log(`Validated ${result.packId}: ${directory}`);
    else {
      failed = true;
      console.error(`${directory}\n${result.issues.map((entry) => `  ${entry.code} ${entry.path}: ${entry.message}`).join('\n')}`);
    }
  }
  if (failed) process.exitCode = 1;
}

export type ValidationArguments =
  | Readonly<{ mode: 'fixture' }>
  | Readonly<{ mode: 'all' }>
  | Readonly<{ mode: 'directories'; directories: readonly string[] }>;

export function parseValidationArguments(input: readonly string[]): ValidationArguments {
  const args = input.filter((argument) => argument !== '--');
  const flags = args.filter((argument) => argument.startsWith('--'));
  const unknown = flags.find((flag) => flag !== '--fixture' && flag !== '--all');
  if (unknown !== undefined) throw new Error(`Unknown validation option: ${unknown}`);
  const hasFixture = flags.includes('--fixture');
  const hasAll = flags.includes('--all');
  const directories = args.filter((argument) => !argument.startsWith('--'));
  const selectedModes = Number(hasFixture) + Number(hasAll) + Number(directories.length > 0);
  if (selectedModes !== 1) {
    throw new Error('Choose exactly one validation mode: --fixture, --all, or one or more directories.');
  }
  if (hasFixture) return { mode: 'fixture' };
  if (hasAll) return { mode: 'all' };
  return { mode: 'directories', directories };
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

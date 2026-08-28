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
    const previous = gridRing[gridRing.length - 1];
    const first = decoded[0];
    if (previous !== undefined && (first === undefined || !samePosition(previous, first))) {
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

type TopologyPoint = Readonly<{ id: string; coordinate: Position }>;
type TopologyExtraction = Readonly<{
  regions: ReadonlyMap<string, RegionShape>;
  points: readonly TopologyPoint[];
}>;

function decodePointCoordinate(
  topology: ParsedTopology,
  value: unknown,
  path: string,
  issues: PackValidationIssue[],
): Position | undefined {
  if (!isPosition(value) || !value.every(Number.isInteger)) {
    issues.push(issue('invalid_topology', path, 'Quantized TopoJSON points must contain integer coordinate pairs.'));
    return undefined;
  }
  const coordinate: Position = [
    value[0] * topology.transform.scale[0] + topology.transform.translate[0],
    value[1] * topology.transform.scale[1] + topology.transform.translate[1],
  ];
  if (coordinate[0] < -180 || coordinate[0] > 180 || coordinate[1] < -90 || coordinate[1] > 90) {
    issues.push(issue('invalid_topology', path, 'Decoded coordinates must be valid longitude/latitude values.'));
    return undefined;
  }
  return coordinate;
}

function decodeLine(
  topology: ParsedTopology,
  references: unknown,
  path: string,
  issues: PackValidationIssue[],
): readonly Position[] | undefined {
  if (!Array.isArray(references) || references.length === 0 || !references.every(Number.isInteger)) {
    issues.push(issue('invalid_topology', path, 'LineString must contain integer arc references.'));
    return undefined;
  }
  const gridLine: Position[] = [];
  for (const [index, reference] of references.entries()) {
    const decoded = decodeArcGrid(topology, reference as number);
    if (decoded === undefined) {
      issues.push(issue('invalid_topology', `${path}.${index}`, `Arc reference ${String(reference)} is out of range.`));
      return undefined;
    }
    const previous = gridLine[gridLine.length - 1];
    const first = decoded[0];
    if (previous !== undefined && (first === undefined || !samePosition(previous, first))) {
      issues.push(issue('invalid_topology', `${path}.${index}`, 'LineString arc references must form a continuous chain.'));
      return undefined;
    }
    gridLine.push(...(gridLine.length === 0 ? decoded : decoded.slice(1)));
  }
  const line = gridLine.map(([x, y]) => [
    x * topology.transform.scale[0] + topology.transform.translate[0],
    y * topology.transform.scale[1] + topology.transform.translate[1],
  ] as const);
  if (line.some(([longitude, latitude]) => longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90)) {
    issues.push(issue('invalid_topology', path, 'Decoded coordinates must be valid longitude/latitude values.'));
    return undefined;
  }
  return line;
}

function extractTopology(topology: ParsedTopology, issues: PackValidationIssue[]): TopologyExtraction {
  const regions = new Map<string, RegionShape>();
  const points: TopologyPoint[] = [];
  const pointIds = new Set<string>();
  const visit = (geometry: TopologyGeometry, path: string, regionLayer: boolean): void => {
    if (geometry.type === 'GeometryCollection') {
      if (!Array.isArray(geometry.geometries)) {
        issues.push(issue('invalid_topology', `${path}.geometries`, 'GeometryCollection must contain geometries.'));
        return;
      }
      geometry.geometries.forEach((child, index) => {
        if (!isRecord(child) || typeof child.type !== 'string') {
          issues.push(issue('invalid_topology', `${path}.geometries.${index}`, 'Geometry must be an object.'));
        } else visit(child as TopologyGeometry, `${path}.geometries.${index}`, regionLayer);
      });
      return;
    }

    if (geometry.type === 'Point') {
      if (regionLayer) {
        issues.push(issue('invalid_topology', `${path}.type`, 'The regions layer may contain only Polygon or MultiPolygon geometry.'));
        return;
      }
      const coordinate = decodePointCoordinate(topology, (geometry as Record<string, unknown>).coordinates, `${path}.coordinates`, issues);
      if (geometry.id === undefined) return;
      if (typeof geometry.id !== 'string' || geometry.id.length === 0) {
        issues.push(issue('invalid_topology', `${path}.id`, 'TopoJSON point IDs must be non-empty strings.'));
      } else if (pointIds.has(geometry.id)) {
        issues.push(issue('invalid_topology', `${path}.id`, `Duplicate topology point ID: ${geometry.id}.`));
      } else if (coordinate !== undefined) {
        pointIds.add(geometry.id);
        points.push({ id: geometry.id, coordinate });
      }
      return;
    }

    if (geometry.type === 'MultiPoint') {
      if (regionLayer || !Array.isArray((geometry as Record<string, unknown>).coordinates)) {
        issues.push(issue('invalid_topology', `${path}.coordinates`, 'MultiPoint geometry must contain coordinate pairs outside the regions layer.'));
        return;
      }
      ((geometry as Record<string, unknown>).coordinates as unknown[]).forEach((coordinate, index) => {
        decodePointCoordinate(topology, coordinate, `${path}.coordinates.${index}`, issues);
      });
      return;
    }

    if (geometry.type === 'LineString') {
      if (regionLayer) {
        issues.push(issue('invalid_topology', `${path}.type`, 'The regions layer may contain only Polygon or MultiPolygon geometry.'));
        return;
      }
      decodeLine(topology, geometry.arcs, `${path}.arcs`, issues);
      return;
    }

    if (geometry.type === 'MultiLineString') {
      if (regionLayer || !Array.isArray(geometry.arcs)) {
        issues.push(issue('invalid_topology', `${path}.arcs`, 'MultiLineString geometry must contain line arc arrays outside the regions layer.'));
        return;
      }
      geometry.arcs.forEach((references, index) => decodeLine(topology, references, `${path}.arcs.${index}`, issues));
      return;
    }

    if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') {
      issues.push(issue('invalid_topology', `${path}.type`, `Unsupported TopoJSON geometry type: ${geometry.type}.`));
      return;
    }
    if (regionLayer && (typeof geometry.id !== 'string' || geometry.id.length === 0)) {
      issues.push(issue('invalid_topology', `${path}.id`, 'Region geometries require a stable string ID.'));
      return;
    }
    if (!Array.isArray(geometry.arcs) || geometry.arcs.length === 0) {
      issues.push(issue('invalid_topology', `${path}.arcs`, 'Region geometry must contain at least one polygon ring.'));
      return;
    }
    if (geometry.type === 'Polygon') {
      const rings = geometry.arcs.map((references, index) => decodeRing(topology, references, `${path}.arcs.${index}`, issues));
      if (regionLayer && typeof geometry.id === 'string' && rings.every((ring) => ring !== undefined)) {
        if (regions.has(geometry.id)) {
          issues.push(issue('invalid_topology', `${path}.id`, `Duplicate topology geometry ID: ${geometry.id}.`));
        } else {
          regions.set(geometry.id, { type: 'Polygon', coordinates: rings as PolygonCoordinates });
        }
      }
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
    if (regionLayer && typeof geometry.id === 'string' && polygons.every((polygon) => polygon !== undefined)) {
      if (regions.has(geometry.id)) {
        issues.push(issue('invalid_topology', `${path}.id`, `Duplicate topology geometry ID: ${geometry.id}.`));
      } else {
        regions.set(geometry.id, { type: 'MultiPolygon', coordinates: polygons as MultiPolygonCoordinates });
      }
    }
  };
  Object.entries(topology.objects)
    .sort(([left], [right]) => compareOrdinal(left, right))
    .forEach(([objectId, geometry]) => visit(geometry, `map.topojson.objects.${objectId}`, objectId === 'regions'));
  return { regions, points };
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

function validateTopologyPoints(
  entities: readonly Entity[],
  points: readonly TopologyPoint[],
  issues: PackValidationIssue[],
): void {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity] as const));
  points.forEach((point) => {
    const entity = entitiesById.get(point.id);
    if (entity === undefined || entity.kind !== 'place') {
      issues.push(issue('missing_reference', `map.topojson.points.${point.id}`, `Topology point ${point.id} does not reference a place entity.`));
      return;
    }
    if (Math.abs(entity.coordinate[0] - point.coordinate[0]) > 1e-6 ||
        Math.abs(entity.coordinate[1] - point.coordinate[1]) > 1e-6) {
      issues.push(issue('coordinate_mismatch', `map.topojson.points.${point.id}`, `Topology point ${point.id} does not match its entity coordinate within 1e-6 degrees.`));
    }
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
  const extracted = extractTopology(topology, topologyIssues);
  const core = validatePack({
    manifest,
    entities,
    sources,
    topologyObjectIds: [...extracted.regions.keys()],
    topologyPoints: extracted.points,
  });
  const issues = core.ok ? [...topologyIssues] : [...core.issues, ...topologyIssues];

  if (isRecord(manifest) && isRecord(manifest.checksums)) {
    const checksums = manifest.checksums;
    const actual = { entities: entityHash, topology: topologyHash, sources: sourceHash };
    (Object.keys(actual) as Array<keyof typeof actual>).forEach((key) => {
      if (checksums[key] !== actual[key]) issues.push(issue('checksum_mismatch', `manifest.checksums.${key}`, `Expected ${String(checksums[key])} but found ${actual[key]}.`));
    });
  }
  validateSourceLedger(sources, entityHash, issues);
  if (core.ok) {
    validateTopologyPoints(core.pack.entities, extracted.points, issues);
    validatePlaces(core.pack.entities, extracted.regions, issues);
  }
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

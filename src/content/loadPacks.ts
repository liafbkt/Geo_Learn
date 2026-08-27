import type { ContentFileName, ContentSource } from './ContentSource';
import type { ContentPack, PackValidationIssue } from './types';
import { validatePack } from './validatePack';

export type RejectedPack = Readonly<{
  packId: string;
  issues: readonly PackValidationIssue[];
}>;

export type AvailablePacks = Readonly<{
  available: readonly ContentPack[];
  rejected: readonly RejectedPack[];
}>;

function issue(
  path: string,
  message: string,
  code: PackValidationIssue['code'] = 'schema',
): PackValidationIssue {
  return { code, path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCoordinate(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function isNumericPair(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1])
  );
}

type TopologyExtraction = Readonly<{
  topologyObjectIds: readonly string[];
  topologyPoints: readonly Readonly<{ id: string; coordinate: readonly [number, number] }>[];
}>;

type TopologyTransform = Readonly<{
  scale: readonly [number, number];
  translate: readonly [number, number];
}>;

function topologyIssue(path: string, message: string): PackValidationIssue {
  return issue(path, message, 'invalid_topology');
}

function readSummaryTopology(value: Record<string, unknown>): TopologyExtraction | PackValidationIssue | undefined {
  const hasObjectIds = 'topologyObjectIds' in value;
  const hasPoints = 'topologyPoints' in value;
  if (!hasObjectIds && !hasPoints) return undefined;
  if (!Array.isArray(value.topologyObjectIds) || !Array.isArray(value.topologyPoints)) {
    return topologyIssue('map.topojson', 'Topology summary must include both object IDs and points.');
  }

  for (const [index, id] of value.topologyObjectIds.entries()) {
    if (typeof id !== 'string' || id.length === 0) {
      return topologyIssue(
        `map.topojson.topologyObjectIds.${index}`,
        'Topology object IDs must be non-empty strings.',
      );
    }
  }
  for (const [index, point] of value.topologyPoints.entries()) {
    if (!isRecord(point) || typeof point.id !== 'string' || point.id.length === 0) {
      return topologyIssue(`map.topojson.topologyPoints.${index}`, 'Topology points must have string IDs.');
    }
    if (!isCoordinate(point.coordinate)) {
      return topologyIssue(
        `map.topojson.topologyPoints.${index}.coordinate`,
        'Topology point coordinates must be longitude/latitude pairs.',
      );
    }
  }

  return {
    topologyObjectIds: value.topologyObjectIds,
    topologyPoints: value.topologyPoints as readonly Readonly<{
      id: string;
      coordinate: readonly [number, number];
    }>[],
  };
}

function readTransform(value: Record<string, unknown>): TopologyTransform | PackValidationIssue | undefined {
  if (!('transform' in value)) return undefined;
  if (!isRecord(value.transform) || !isNumericPair(value.transform.scale) || !isNumericPair(value.transform.translate)) {
    return topologyIssue('map.topojson.transform', 'TopoJSON transform must contain numeric scale and translate pairs.');
  }
  return { scale: value.transform.scale, translate: value.transform.translate };
}

function decodePoint(
  coordinate: readonly [number, number],
  transform: TopologyTransform | undefined,
  path: string,
): readonly [number, number] | PackValidationIssue {
  const decoded: readonly [number, number] = transform === undefined
    ? coordinate
    : [
        coordinate[0] * transform.scale[0] + transform.translate[0],
        coordinate[1] * transform.scale[1] + transform.translate[1],
      ];
  return isCoordinate(decoded)
    ? decoded
    : topologyIssue(path, 'Decoded TopoJSON point must be a valid longitude/latitude pair.');
}

function isIntegerArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}

function isNestedIntegerArray(value: unknown, depth: number): boolean {
  return depth === 0
    ? isIntegerArray(value)
    : Array.isArray(value) && value.every((item) => isNestedIntegerArray(item, depth - 1));
}

function extractTopology(value: unknown): TopologyExtraction | PackValidationIssue {
  if (!isRecord(value)) {
    return issue('map.topojson', 'TopoJSON resource must be an object.');
  }

  const summary = readSummaryTopology(value);
  if (summary !== undefined) return summary;

  if (value.type !== 'Topology' || !isRecord(value.objects)) {
    return issue('map.topojson', 'TopoJSON resource must contain a Topology and objects.');
  }

  const transform = readTransform(value);
  if (transform !== undefined && 'code' in transform) return transform;

  const objectIds: string[] = [];
  const points: Array<Readonly<{ id: string; coordinate: readonly [number, number] }>> = [];

  const visit = (geometry: unknown, path: string): PackValidationIssue | undefined => {
    if (!isRecord(geometry) || typeof geometry.type !== 'string') {
      return topologyIssue(path, 'TopoJSON geometry must be an object with a type.');
    }
    const kind = geometry.type;
    if ('id' in geometry && (typeof geometry.id !== 'string' || geometry.id.length === 0)) {
      return topologyIssue(`${path}.id`, 'TopoJSON geometry IDs must be non-empty strings.');
    }
    const id = typeof geometry.id === 'string' ? geometry.id : undefined;
    if (id !== undefined && kind !== 'Point' && kind !== 'MultiPoint' && !objectIds.includes(id)) {
      objectIds.push(id);
    }
    if (kind === 'GeometryCollection') {
      if (!Array.isArray(geometry.geometries)) {
        return topologyIssue(`${path}.geometries`, 'Geometry collections must contain geometries.');
      }
      for (const [index, child] of geometry.geometries.entries()) {
        const childIssue = visit(child, `${path}.geometries.${index}`);
        if (childIssue !== undefined) return childIssue;
      }
      return undefined;
    }
    if (kind === 'Point') {
      if (!isNumericPair(geometry.coordinates)) {
        return topologyIssue(`${path}.coordinates`, 'TopoJSON points must contain numeric coordinate pairs.');
      }
      const decoded = decodePoint(geometry.coordinates, transform, `${path}.coordinates`);
      if ('code' in decoded) return decoded;
      if (id !== undefined) points.push({ id, coordinate: decoded });
      return undefined;
    }
    if (kind === 'MultiPoint') {
      if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.every(isNumericPair)) {
        return topologyIssue(`${path}.coordinates`, 'TopoJSON multi-points must contain numeric coordinate pairs.');
      }
      return undefined;
    }
    const arcDepth = kind === 'LineString' ? 0 : kind === 'MultiLineString' || kind === 'Polygon' ? 1 : kind === 'MultiPolygon' ? 2 : undefined;
    if (arcDepth === undefined) {
      return topologyIssue(`${path}.type`, `Unsupported TopoJSON geometry type: ${kind}.`);
    }
    return isNestedIntegerArray(geometry.arcs, arcDepth)
      ? undefined
      : topologyIssue(`${path}.arcs`, 'TopoJSON geometry arcs have an invalid shape.');
  };

  for (const [objectId, geometry] of Object.entries(value.objects)) {
    const geometryIssue = visit(geometry, `map.topojson.objects.${objectId}`);
    if (geometryIssue !== undefined) return geometryIssue;
  }
  return { topologyObjectIds: objectIds, topologyPoints: points };
}

async function readPack(source: ContentSource, packId: string): Promise<ContentPack | RejectedPack> {
  try {
    const fileNames: readonly ContentFileName[] = [
      'manifest.json',
      'entities.json',
      'sources.json',
      'map.topojson',
    ];
    const [manifest, entities, sources, map] = await Promise.all(
      fileNames.map((fileName) => source.readJson(packId, fileName)),
    );
    const topology = extractTopology(map);
    if ('code' in topology) return { packId, issues: [topology] };

    const result = validatePack({
      manifest,
      entities,
      sources,
      topologyObjectIds: topology.topologyObjectIds,
      topologyPoints: topology.topologyPoints,
    });
    if (!result.ok) return { packId, issues: result.issues };
    return result.pack.manifest.packId === packId
      ? result.pack
      : {
          packId,
          issues: [issue('manifest.packId', 'Manifest pack ID must match the content source directory.')],
        };
  } catch (error) {
    return {
      packId,
      issues: [
        issue(
          '$',
          error instanceof Error ? error.message : 'Unable to read content pack resources.',
        ),
      ],
    };
  }
}

export async function loadAvailablePacks(source: ContentSource): Promise<AvailablePacks> {
  const ids = [...(await source.readPackIds())].sort();
  const loaded = await Promise.all(ids.map((packId) => readPack(source, packId)));
  const available: ContentPack[] = [];
  const rejected: RejectedPack[] = [];
  loaded.forEach((result) => (result && 'issues' in result ? rejected.push(result) : available.push(result)));
  return { available, rejected };
}

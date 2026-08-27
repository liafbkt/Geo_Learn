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

function issue(path: string, message: string): PackValidationIssue {
  return { code: 'schema', path, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCoordinate(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

type TopologyExtraction = Readonly<{
  topologyObjectIds: readonly string[];
  topologyPoints: readonly Readonly<{ id: string; coordinate: readonly [number, number] }>[];
}>;

function extractTopology(value: unknown): TopologyExtraction | PackValidationIssue {
  if (!isRecord(value)) {
    return issue('map.topojson', 'TopoJSON resource must be an object.');
  }

  // This shape is useful to the in-memory source and remains compatible with
  // generated TopoJSON fixtures that have already been summarized.
  if (Array.isArray(value.topologyObjectIds) && Array.isArray(value.topologyPoints)) {
    return {
      topologyObjectIds: value.topologyObjectIds.filter((id): id is string => typeof id === 'string'),
      topologyPoints: value.topologyPoints.filter(
        (point): point is { id: string; coordinate: readonly [number, number] } =>
          isRecord(point) && typeof point.id === 'string' && isCoordinate(point.coordinate),
      ),
    };
  }

  if (value.type !== 'Topology' || !isRecord(value.objects)) {
    return issue('map.topojson', 'TopoJSON resource must contain a Topology and objects.');
  }

  const objectIds: string[] = [];
  const points: Array<Readonly<{ id: string; coordinate: readonly [number, number] }>> = [];

  const visit = (geometry: unknown): void => {
    if (!isRecord(geometry)) return;
    const kind = geometry.type;
    const id = typeof geometry.id === 'string' ? geometry.id : undefined;
    if (id !== undefined && kind !== 'Point' && kind !== 'MultiPoint' && !objectIds.includes(id)) {
      objectIds.push(id);
    }
    if (kind === 'Point' && id !== undefined && isCoordinate(geometry.coordinates)) {
      points.push({ id, coordinate: geometry.coordinates });
    }
    if (Array.isArray(geometry.geometries)) {
      geometry.geometries.forEach(visit);
    }
  };

  Object.values(value.objects).forEach(visit);
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
    return result.ok ? result.pack : { packId, issues: result.issues };
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

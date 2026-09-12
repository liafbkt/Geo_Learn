import { geoAlbersUsa, geoMercator, geoPath } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { ContentPack } from '../content/types';
import type {
  MapProjectionError,
  MapSize,
  ProjectedMap,
  ProjectedPlace,
  ProjectedRegion,
  ProjectMapResult,
} from './types';

type Topology = Parameters<typeof feature>[0];
type GeometryObject = Exclude<Parameters<typeof feature>[1], string>;
type GeometryCollection = Extract<GeometryObject, { type: 'GeometryCollection' }>;

const projectionCache = new Map<string, ProjectedMap>();
const padding = 16;

function projectionError(
  code: MapProjectionError['code'],
  message: string,
): ProjectMapResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTopology(value: unknown): value is Topology {
  return (
    isRecord(value) &&
    value.type === 'Topology' &&
    isRecord(value.objects) &&
    Array.isArray(value.arcs)
  );
}

function arcIndexIsValid(value: unknown, arcCount: number): boolean {
  if (!Number.isInteger(value)) return false;
  const index = value as number;
  const normalized = index < 0 ? ~index : index;
  return normalized >= 0 && normalized < arcCount;
}

function nestedArcIndexesAreValid(
  value: unknown,
  depth: number,
  arcCount: number,
): boolean {
  if (depth === 0) return arcIndexIsValid(value, arcCount);
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((child) => nestedArcIndexesAreValid(child, depth - 1, arcCount))
  );
}

function coordinateIsValid(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  );
}

function geometryIsValid(geometry: unknown, arcCount: number): geometry is GeometryObject {
  if (!isRecord(geometry) || typeof geometry.type !== 'string') return false;
  switch (geometry.type) {
    case 'GeometryCollection':
      return (
        Array.isArray(geometry.geometries) &&
        geometry.geometries.every((child) => geometryIsValid(child, arcCount))
      );
    case 'Point':
      return coordinateIsValid(geometry.coordinates);
    case 'MultiPoint':
      return (
        Array.isArray(geometry.coordinates) &&
        geometry.coordinates.every(coordinateIsValid)
      );
    case 'LineString':
      return nestedArcIndexesAreValid(geometry.arcs, 1, arcCount);
    case 'MultiLineString':
    case 'Polygon':
      return nestedArcIndexesAreValid(geometry.arcs, 2, arcCount);
    case 'MultiPolygon':
      return nestedArcIndexesAreValid(geometry.arcs, 3, arcCount);
    default:
      return false;
  }
}

function topologyArcsAreValid(topology: Topology): boolean {
  return topology.arcs.every(
    (arc) =>
      Array.isArray(arc) &&
      arc.length > 0 &&
      arc.every(coordinateIsValid),
  );
}

function topologyMatchesPack(topology: Topology, pack: ContentPack): MapProjectionError | null {
  if (
    !topologyArcsAreValid(topology) ||
    !Object.values(topology.objects).every((object) =>
      geometryIsValid(object, topology.arcs.length),
    )
  ) {
    return {
      code: 'invalid-geometry',
      message: 'Map topology could not be projected.',
    };
  }

  const regionIds = new Set(
    pack.entities.flatMap((entity) => (entity.kind === 'region' ? [entity.id] : [])),
  );
  const regionGeometries: GeometryObject[] = [];
  Object.values(topology.objects).forEach((object) =>
    collectRegionGeometries(object, regionIds, regionGeometries),
  );
  if (regionGeometries.length !== regionIds.size) {
    return {
      code: 'missing-region-geometry',
      message: 'Map topology does not contain every configured region.',
    };
  }
  return null;
}

function geometryId(geometry: GeometryObject): string | undefined {
  return typeof geometry.id === 'string' ? geometry.id : undefined;
}

function collectRegionGeometries(
  geometry: GeometryObject,
  regionIds: ReadonlySet<string>,
  destination: GeometryObject[],
): void {
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((child) =>
      collectRegionGeometries(child, regionIds, destination),
    );
    return;
  }
  const id = geometryId(geometry);
  if (
    id !== undefined &&
    regionIds.has(id) &&
    (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon')
  ) {
    destination.push(geometry);
  }
}

function featureList(value: ReturnType<typeof feature>) {
  return value.type === 'FeatureCollection' ? value.features : [value];
}

function collectHydroPaths(
  topology: Topology,
  path: ReturnType<typeof geoPath>,
): readonly string[] {
  const result: string[] = [];
  Object.entries(topology.objects).forEach(([objectName, object]) => {
    const properties = object.properties as Record<string, unknown> | undefined;
    const isHydro =
      /hydro|water|river|lake/i.test(objectName) || properties?.layer === 'hydro';
    if (!isHydro) return;
    featureList(feature(topology, object)).forEach((item) => {
      const projected = path(item);
      if (projected !== null) result.push(projected);
    });
  });
  return result;
}

function projectUncached(
  pack: ContentPack,
  topology: Topology,
  size: MapSize,
  cacheKey: string,
): ProjectMapResult {
  try {
    const regionEntities = pack.entities.filter((entity) => entity.kind === 'region');
    const regionIds = new Set(regionEntities.map(({ id }) => id));
    const regionGeometries: GeometryObject[] = [];
    Object.values(topology.objects).forEach((object) =>
      collectRegionGeometries(object, regionIds, regionGeometries),
    );
    if (regionGeometries.length !== regionEntities.length) {
      return projectionError(
        'missing-region-geometry',
        'Map topology does not contain every configured region.',
      );
    }

    const collection: GeometryCollection = {
      type: 'GeometryCollection',
      geometries: regionGeometries,
    };
    const regionFeatures = feature(topology, collection);
    // US insets keep Alaska's antimeridian islands from shrinking the mainland.
    const projection = (pack.manifest.packId === 'us-states' ? geoAlbersUsa() : geoMercator()).fitExtent(
      [
        [padding, padding],
        [size.width - padding, size.height - padding],
      ],
      regionFeatures,
    );
    const path = geoPath(projection);
    const featuresById = new Map(
      regionFeatures.features.map((item) => [String(item.id), item] as const),
    );
    const regions: ProjectedRegion[] = [];
    regionEntities.forEach((entity) => {
      const item = featuresById.get(entity.id);
      if (item === undefined) throw new Error('missing projected feature');
      const projectedPath = path(item);
      const [x, y] = path.centroid(item);
      if (
        projectedPath === null ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        throw new Error('invalid projected region');
      }
      regions.push({ entityId: entity.id, path: projectedPath, centroid: [x, y] });
    });

    const places: ProjectedPlace[] = [];
    pack.entities.forEach((entity) => {
      if (entity.kind !== 'place') return;
      const projected = projection([entity.coordinate[0], entity.coordinate[1]]);
      if (
        projected === null ||
        !Number.isFinite(projected[0]) ||
        !Number.isFinite(projected[1])
      ) {
        throw new Error('invalid projected point');
      }
      places.push({ entityId: entity.id, point: projected });
    });

    const sharedMesh = mesh(
      topology,
      collection as Parameters<typeof mesh>[1],
    );
    const boundaryPath = sharedMesh.coordinates.length === 0 ? null : path(sharedMesh);
    const projected: ProjectedMap = {
      cacheKey,
      packId: pack.manifest.packId,
      contentVersion: pack.manifest.contentVersion,
      size,
      viewBox: `0 0 ${size.width} ${size.height}`,
      regions,
      places,
      hydroPaths: collectHydroPaths(topology, path),
      boundaryPath,
      zoomLimits: { min: 1, max: 8 },
    };
    projectionCache.set(cacheKey, projected);
    return { ok: true, map: projected };
  } catch {
    return projectionError('invalid-geometry', 'Map topology could not be projected.');
  }
}

export function projectMap(
  pack: ContentPack,
  topologyValue: unknown,
  size: MapSize,
): ProjectMapResult {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= padding * 2 ||
    size.height <= padding * 2
  ) {
    return projectionError('invalid-viewport', 'Map viewport dimensions must be positive.');
  }
  if (!isTopology(topologyValue)) {
    return projectionError('invalid-geometry', 'Map topology could not be projected.');
  }
  const topologyError = topologyMatchesPack(topologyValue, pack);
  if (topologyError !== null) {
    return { ok: false, error: topologyError };
  }
  const cacheKey = `${pack.manifest.packId}@${pack.manifest.contentVersion}:${size.width}x${size.height}`;
  const cached = projectionCache.get(cacheKey);
  return cached === undefined
    ? projectUncached(pack, topologyValue, size, cacheKey)
    : { ok: true, map: cached };
}

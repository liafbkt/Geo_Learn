import type { Position } from './pointInRegion';
import { compareOrdinal } from './hash';
import {
  removeConsecutiveDuplicates,
  validateSimpleClosedRing,
} from './ringGeometry';

type GeoJsonPolygon = Readonly<{ type: 'Polygon'; coordinates: readonly (readonly Position[])[] }>;
type GeoJsonMultiPolygon = Readonly<{ type: 'MultiPolygon'; coordinates: readonly (readonly (readonly Position[])[])[] }>;
export type SupportedGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;
export type RegionFeature = Readonly<{ id: string; geometry: SupportedGeometry }>;

type Quantization = Readonly<{
  scale: readonly [number, number];
  translate: readonly [number, number];
  quantize: (position: Position) => readonly [number, number];
}>;

function forEachPosition(geometry: SupportedGeometry, visit: (position: Position) => void): void {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  polygons.forEach((polygon) => polygon.forEach((ring) => ring.forEach(visit)));
}

function createQuantization(features: readonly RegionFeature[], gridSize: number): Quantization {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  features.forEach((feature) => forEachPosition(feature.geometry, ([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }));
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) throw new Error('No valid region coordinates were found.');
  const denominator = gridSize - 1;
  const scale: readonly [number, number] = [
    maxX === minX ? 1 : (maxX - minX) / denominator,
    maxY === minY ? 1 : (maxY - minY) / denominator,
  ];
  const translate: readonly [number, number] = [minX, minY];
  return {
    scale,
    translate,
    quantize: ([x, y]) => [Math.round((x - minX) / scale[0]), Math.round((y - minY) / scale[1])],
  };
}

function perpendicularDistance(point: Position, start: Position, end: Position): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const ratio = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point[0] - (start[0] + ratio * dx), point[1] - (start[1] + ratio * dy));
}

function simplifyLine(points: readonly Position[], tolerance: number): readonly Position[] {
  if (tolerance <= 0 || points.length <= 2) return points;
  const start = points[0];
  const end = points[points.length - 1];
  if (start === undefined || end === undefined) return points;
  let greatestDistance = 0;
  let greatestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const candidate = points[index];
    if (candidate === undefined) continue;
    const distance = perpendicularDistance(candidate, start, end);
    if (distance > greatestDistance) {
      greatestDistance = distance;
      greatestIndex = index;
    }
  }
  if (greatestDistance <= tolerance) return [start, end];
  return [
    ...simplifyLine(points.slice(0, greatestIndex + 1), tolerance).slice(0, -1),
    ...simplifyLine(points.slice(greatestIndex), tolerance),
  ];
}

function normalizeRing(ring: readonly Position[], tolerance: number, label: string): readonly Position[] {
  validateSimpleClosedRing(ring, label);
  const simplified = simplifyLine(ring, tolerance);
  validateSimpleClosedRing(simplified, `${label} after simplification`);
  return simplified;
}

function positionKey(position: readonly [number, number]): string {
  return `${position[0]},${position[1]}`;
}

function pointOnSourceSegment(point: Position, start: Position, end: Position): boolean {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const pointDx = point[0] - start[0];
  const pointDy = point[1] - start[1];
  const crossProduct = dx * pointDy - dy * pointDx;
  const arithmeticScale = Math.max(1, Math.abs(dx * pointDy) + Math.abs(dy * pointDx));
  const tolerance = Number.EPSILON * 32 * arithmeticScale;
  if (Math.abs(crossProduct) > tolerance) return false;
  const projection = pointDx * dx + pointDy * dy;
  const squaredLength = dx * dx + dy * dy;
  return projection >= -tolerance && projection <= squaredLength + tolerance;
}

function deltaEncode(points: readonly (readonly [number, number])[]): readonly (readonly [number, number])[] {
  let previousX = 0;
  let previousY = 0;
  return points.map(([x, y]) => {
    const encoded: readonly [number, number] = [x - previousX, y - previousY];
    previousX = x;
    previousY = y;
    return encoded;
  });
}

export function buildTopology(features: readonly RegionFeature[], tolerance: number, gridSize: number): unknown {
  if (!Number.isInteger(gridSize) || gridSize < 2 || gridSize > 1_000_000) {
    throw new Error('Quantization grid size must be an integer from 2 through 1,000,000.');
  }
  const sorted = [...features].sort((left, right) => compareOrdinal(left.id, right.id));
  const quantization = createQuantization(sorted, gridSize);
  const normalized = sorted.map((feature) => {
    if (feature.geometry.type === 'Polygon') {
      if (feature.geometry.coordinates.length === 0) {
        throw new Error(`Region ${feature.id} Polygon must contain at least one ring.`);
      }
      return {
        id: feature.id,
        geometry: {
          type: 'Polygon' as const,
          coordinates: feature.geometry.coordinates.map((ring, index) =>
            normalizeRing(ring, tolerance, `Region ${feature.id} ring ${index}`)),
        },
      };
    }
    if (feature.geometry.coordinates.length === 0 || feature.geometry.coordinates.some((polygon) => polygon.length === 0)) {
      throw new Error(`Region ${feature.id} MultiPolygon must contain non-empty polygons.`);
    }
    return {
      id: feature.id,
      geometry: {
        type: 'MultiPolygon' as const,
        coordinates: feature.geometry.coordinates.map((polygon, polygonIndex) =>
          polygon.map((ring, ringIndex) =>
            normalizeRing(ring, tolerance, `Region ${feature.id} polygon ${polygonIndex} ring ${ringIndex}`))),
      },
    };
  });

  const sourceVertices = new Map<string, Position>();
  const registerRing = (ring: readonly Position[]): void => {
    ring.slice(0, -1).forEach((position) => sourceVertices.set(positionKey(position), position));
  };
  normalized.forEach(({ geometry }) => {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => polygon.forEach(registerRing));
  });

  const nodeAndQuantizeRing = (ring: readonly Position[], label: string): readonly Position[] => {
    const noded: Position[] = [];
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (start === undefined || end === undefined) continue;
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const segmentVertices = [...sourceVertices.values()]
        .filter((point) => pointOnSourceSegment(point, start, end))
        .sort((left, right) =>
          ((left[0] - start[0]) * dx + (left[1] - start[1]) * dy) -
          ((right[0] - start[0]) * dx + (right[1] - start[1]) * dy));
      noded.push(...(noded.length === 0 ? segmentVertices : segmentVertices.slice(1)));
    }
    const quantized = removeConsecutiveDuplicates(noded.map(quantization.quantize));
    try {
      validateSimpleClosedRing(quantized, `${label} after quantization`);
    } catch (error) {
      throw new Error(`Geometry collapsed during quantization: ${error instanceof Error ? error.message : String(error)}`);
    }
    return quantized;
  };

  const prepared = normalized.map((feature) => {
    if (feature.geometry.type === 'Polygon') {
      return {
        id: feature.id,
        geometry: {
          type: 'Polygon' as const,
          coordinates: feature.geometry.coordinates.map((ring, index) =>
            nodeAndQuantizeRing(ring, `Region ${feature.id} ring ${index}`)),
        },
      };
    }
    return {
      id: feature.id,
      geometry: {
        type: 'MultiPolygon' as const,
        coordinates: feature.geometry.coordinates.map((polygon, polygonIndex) =>
          polygon.map((ring, ringIndex) =>
            nodeAndQuantizeRing(ring, `Region ${feature.id} polygon ${polygonIndex} ring ${ringIndex}`))),
      },
    };
  });

  const arcs: Array<readonly (readonly [number, number])[]> = [];
  const arcByDirection = new Map<string, number>();

  const encodeRing = (ring: readonly Position[]): readonly number[] => {
    const references: number[] = [];
    for (let index = 0; index < ring.length - 1; index += 1) {
      const segmentStart = ring[index];
      const segmentEnd = ring[index + 1];
      if (segmentStart === undefined || segmentEnd === undefined) continue;
      const forward = `${positionKey(segmentStart)}>${positionKey(segmentEnd)}`;
      const reverse = `${positionKey(segmentEnd)}>${positionKey(segmentStart)}`;
      const forwardIndex = arcByDirection.get(forward);
      const reverseIndex = arcByDirection.get(reverse);
      if (forwardIndex !== undefined) references.push(forwardIndex);
      else if (reverseIndex !== undefined) references.push(~reverseIndex);
      else {
        const arcIndex = arcs.length;
        arcs.push(deltaEncode([segmentStart, segmentEnd]));
        arcByDirection.set(forward, arcIndex);
        references.push(arcIndex);
      }
    }
    if (references.length < 3) throw new Error('Polygon rings must retain at least three edges.');
    return references;
  };

  const geometries = prepared.map((feature) => {
    if (feature.geometry.type === 'Polygon') {
      return { type: 'Polygon', id: feature.id, arcs: feature.geometry.coordinates.map(encodeRing) };
    }
    return {
      type: 'MultiPolygon',
      id: feature.id,
      arcs: feature.geometry.coordinates.map((polygon) => polygon.map(encodeRing)),
    };
  });

  return {
    type: 'Topology',
    bbox: [quantization.translate[0], quantization.translate[1],
      quantization.translate[0] + quantization.scale[0] * (gridSize - 1),
      quantization.translate[1] + quantization.scale[1] * (gridSize - 1)],
    transform: { scale: quantization.scale, translate: quantization.translate },
    objects: { regions: { type: 'GeometryCollection', geometries } },
    arcs,
  };
}

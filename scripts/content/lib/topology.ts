import type { Position } from './pointInRegion';
import { compareOrdinal } from './hash';

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

function normalizeRing(ring: readonly Position[], tolerance: number): readonly Position[] {
  if (ring.length < 4) throw new Error('Polygon rings must contain at least four positions.');
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first === undefined || last === undefined || first[0] !== last[0] || first[1] !== last[1]) {
    throw new Error('Polygon rings must be closed.');
  }
  const simplified = simplifyLine(ring, tolerance);
  return simplified.length >= 4 ? simplified : ring;
}

function positionKey(position: readonly [number, number]): string {
  return `${position[0]},${position[1]}`;
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
  if (!Number.isInteger(gridSize) || gridSize < 2) throw new Error('Quantization grid size must be an integer of at least 2.');
  const sorted = [...features].sort((left, right) => compareOrdinal(left.id, right.id));
  const quantization = createQuantization(sorted, gridSize);
  const arcs: Array<readonly (readonly [number, number])[]> = [];
  const arcByDirection = new Map<string, number>();

  const encodeRing = (ring: readonly Position[]): readonly number[] => {
    const quantized = normalizeRing(ring, tolerance).map(quantization.quantize);
    const references: number[] = [];
    for (let index = 0; index < quantized.length - 1; index += 1) {
      const start = quantized[index];
      const end = quantized[index + 1];
      if (start === undefined || end === undefined || (start[0] === end[0] && start[1] === end[1])) continue;
      const forward = `${positionKey(start)}>${positionKey(end)}`;
      const reverse = `${positionKey(end)}>${positionKey(start)}`;
      const forwardIndex = arcByDirection.get(forward);
      const reverseIndex = arcByDirection.get(reverse);
      if (forwardIndex !== undefined) references.push(forwardIndex);
      else if (reverseIndex !== undefined) references.push(~reverseIndex);
      else {
        const arcIndex = arcs.length;
        arcs.push(deltaEncode([start, end]));
        arcByDirection.set(forward, arcIndex);
        references.push(arcIndex);
      }
    }
    if (references.length < 3) throw new Error('Polygon rings must retain at least three edges.');
    return references;
  };

  const geometries = sorted.map((feature) => {
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

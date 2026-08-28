export type Position = readonly [number, number];
export type PolygonCoordinates = readonly (readonly Position[])[];
export type MultiPolygonCoordinates = readonly PolygonCoordinates[];

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  const lengthSquared = (end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]) <= 1e-10;
  }
  const cross = (point[1] - start[1]) * (end[0] - start[0]) - (point[0] - start[0]) * (end[1] - start[1]);
  if (Math.abs(cross) > 1e-10) return false;
  const dot = (point[0] - start[0]) * (end[0] - start[0]) + (point[1] - start[1]) * (end[1] - start[1]);
  return dot >= 0 && dot <= lengthSquared;
}

function pointInRing(point: Position, ring: readonly Position[]): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (currentPoint === undefined || previousPoint === undefined) continue;
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    const crosses =
      (currentPoint[1] > point[1]) !== (previousPoint[1] > point[1]) &&
      point[0] <
        ((previousPoint[0] - currentPoint[0]) * (point[1] - currentPoint[1])) /
          (previousPoint[1] - currentPoint[1]) +
          currentPoint[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(point: Position, polygon: PolygonCoordinates): boolean {
  const outer = polygon[0];
  if (outer === undefined || !pointInRing(point, outer)) return false;
  return polygon.slice(1).every((hole) => !pointInRing(point, hole));
}

export function pointInMultiPolygon(point: Position, polygons: MultiPolygonCoordinates): boolean {
  return polygons.some((polygon) => pointInPolygon(point, polygon));
}

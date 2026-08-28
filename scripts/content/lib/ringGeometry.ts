import type { Position } from './pointInRegion';

export function samePosition(left: Position, right: Position): boolean {
  return left[0] === right[0] && left[1] === right[1];
}

export function removeConsecutiveDuplicates(ring: readonly Position[]): readonly Position[] {
  return ring.filter((position, index) => index === 0 || !samePosition(position, ring[index - 1]!));
}

export function signedDoubleArea(ring: readonly Position[]): number {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const current = ring[index]!;
    const next = ring[index + 1]!;
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area;
}

function orientation(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  return orientation(start, end, point) === 0 &&
    point[0] >= Math.min(start[0], end[0]) && point[0] <= Math.max(start[0], end[0]) &&
    point[1] >= Math.min(start[1], end[1]) && point[1] <= Math.max(start[1], end[1]);
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (abC === 0 && pointOnSegment(c, a, b)) return true;
  if (abD === 0 && pointOnSegment(d, a, b)) return true;
  if (cdA === 0 && pointOnSegment(a, c, d)) return true;
  if (cdB === 0 && pointOnSegment(b, c, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

export function validateSimpleClosedRing(ring: readonly Position[], label: string): void {
  if (ring.length < 4) throw new Error(`${label} must contain at least three vertices and a closing position.`);
  if (!samePosition(ring[0]!, ring[ring.length - 1]!)) throw new Error(`${label} must be closed.`);
  const unique = new Set(ring.slice(0, -1).map(([x, y]) => `${x},${y}`));
  if (unique.size < 3) throw new Error(`${label} must retain at least three distinct vertices.`);
  const edgeCount = ring.length - 1;
  for (let left = 0; left < edgeCount; left += 1) {
    for (let right = left + 1; right < edgeCount; right += 1) {
      const adjacent = right === left + 1 || (left === 0 && right === edgeCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[left]!, ring[left + 1]!, ring[right]!, ring[right + 1]!)) {
        throw new Error(`${label} is self-intersecting.`);
      }
    }
  }
  if (signedDoubleArea(ring) === 0) throw new Error(`${label} has zero area.`);
}

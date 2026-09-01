export const PERFORMANCE_THRESHOLDS = Object.freeze({
  coldStartMs: 2_000,
  feedbackMs: 100,
  questionTransitionMs: 200,
  mapFrameMs: 20,
});

export type GeoPerformanceMark =
  | 'geo:home-ready'
  | 'geo:answer-submitted'
  | 'geo:feedback-visible'
  | 'geo:continue-requested'
  | 'geo:question-ready';

type MarkEntry = Readonly<{ name: string; startTime: number }>;

export function markGeoPerformance(name: GeoPerformanceMark): void {
  if (typeof globalThis.performance?.mark !== 'function') return;
  globalThis.performance.mark(name);
}

export function durationBetween(
  entries: readonly MarkEntry[],
  startName: GeoPerformanceMark,
  endName: GeoPerformanceMark,
): number | null {
  const start = [...entries].reverse().find(({ name }) => name === startName);
  const end = [...entries].reverse().find(({ name }) => name === endName);
  if (start === undefined || end === undefined || end.startTime < start.startTime) return null;
  return end.startTime - start.startTime;
}


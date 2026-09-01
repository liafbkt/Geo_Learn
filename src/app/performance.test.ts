import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERFORMANCE_THRESHOLDS,
  durationBetween,
  markGeoPerformance,
} from './performance';

afterEach(() => vi.unstubAllGlobals());

describe('performance release instrumentation', () => {
  it('keeps the approved thresholds immutable and exact', () => {
    expect(PERFORMANCE_THRESHOLDS).toEqual({
      coldStartMs: 2_000,
      feedbackMs: 100,
      questionTransitionMs: 200,
      mapFrameMs: 20,
    });
    expect(Object.isFrozen(PERFORMANCE_THRESHOLDS)).toBe(true);
  });

  it('records a named mark when the Performance API is available', () => {
    const mark = vi.fn();
    vi.stubGlobal('performance', { mark });

    markGeoPerformance('geo:home-ready');

    expect(mark).toHaveBeenCalledWith('geo:home-ready');
  });

  it('is safe when performance.mark is unavailable', () => {
    vi.stubGlobal('performance', {});
    expect(() => markGeoPerformance('geo:question-ready')).not.toThrow();
  });

  it('derives durations from the latest monotonic marks and rejects reversed samples', () => {
    expect(durationBetween([
      { name: 'geo:answer-submitted', startTime: 10 },
      { name: 'geo:feedback-visible', startTime: 14 },
      { name: 'geo:answer-submitted', startTime: 20 },
      { name: 'geo:feedback-visible', startTime: 27 },
    ], 'geo:answer-submitted', 'geo:feedback-visible')).toBe(7);
    expect(durationBetween([
      { name: 'geo:continue-requested', startTime: 30 },
      { name: 'geo:question-ready', startTime: 29 },
    ], 'geo:continue-requested', 'geo:question-ready')).toBeNull();
  });
});

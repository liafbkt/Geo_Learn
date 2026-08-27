import { describe, expect, it } from 'vitest';
import { updateMastery } from './updateMastery';
import type { AttemptOutcome, MasteryRecord, MasteryStage } from './types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = '2026-08-27T00:00:00.000Z';

function record(
  stage: MasteryStage,
  scheduledIntervalMs = 0,
  smoothedResponseMs: number | null = null,
): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'fixture-pack',
    entityId: 'region-a',
    skill: 'identify_region',
    stage,
    scheduledIntervalMs,
    dueAt: '2026-08-26T00:00:00.000Z',
    smoothedResponseMs,
    updatedAt: '2026-08-26T00:00:00.000Z',
  };
}

function outcome(overrides: Partial<AttemptOutcome> = {}): AttemptOutcome {
  return {
    mode: 'smart',
    correct: true,
    independentCorrect: true,
    usedHint: false,
    answerAttemptCount: 1,
    responseMs: 1_000,
    ...overrides,
  };
}

describe('updateMastery', () => {
  it.each([
    ['new', 'learning', 10 * MINUTE],
    ['learning', 'weak', DAY],
    ['weak', 'familiar', 3 * DAY],
    ['familiar', 'solid', 7 * DAY],
    ['solid', 'mastered', 21 * DAY],
  ] satisfies readonly (readonly [MasteryStage, MasteryStage, number])[])(
    'promotes an independent correct answer from %s to %s with the promoted interval',
    (from, to, interval) => {
      const result = updateMastery(record(from), outcome(), NOW);

      expect(result.stage).toBe(to);
      expect(result.scheduledIntervalMs).toBe(interval);
      expect(result.dueAt).toBe(new Date(Date.parse(NOW) + interval).toISOString());
    },
  );

  it.each([
    ['new', 0],
    ['learning', 10 * MINUTE],
    ['weak', DAY],
    ['familiar', DAY],
    ['solid', DAY],
    ['mastered', DAY],
  ] satisfies readonly (readonly [MasteryStage, number])[])(
    'keeps %s and caps the interval after a hinted correct answer',
    (stage, interval) => {
      const result = updateMastery(
        record(stage, 21 * DAY),
        outcome({ independentCorrect: false, usedHint: true }),
        NOW,
      );

      expect(result.stage).toBe(stage);
      expect(result.scheduledIntervalMs).toBe(interval);
      expect(result.dueAt).toBe(new Date(Date.parse(NOW) + interval).toISOString());
    },
  );

  it('keeps the stage after a correct second attempt', () => {
    const result = updateMastery(
      record('solid', 7 * DAY),
      outcome({ independentCorrect: false, answerAttemptCount: 2 }),
      NOW,
    );

    expect(result.stage).toBe('solid');
    expect(result.scheduledIntervalMs).toBe(DAY);
  });

  it.each([
    ['new', 'new'],
    ['learning', 'new'],
    ['weak', 'learning'],
    ['familiar', 'weak'],
    ['solid', 'familiar'],
    ['mastered', 'solid'],
  ] satisfies readonly (readonly [MasteryStage, MasteryStage])[])(
    'demotes a fully failed %s record to %s and schedules ten minutes',
    (from, to) => {
      const result = updateMastery(
        record(from),
        outcome({ correct: false, independentCorrect: false, answerAttemptCount: 2 }),
        NOW,
      );

      expect(result.stage).toBe(to);
      expect(result.scheduledIntervalMs).toBe(10 * MINUTE);
      expect(result.dueAt).toBe('2026-08-27T00:10:00.000Z');
    },
  );

  it.each([
    [DAY, 21 * DAY],
    [21 * DAY, 42 * DAY],
    [60 * DAY, 90 * DAY],
  ])('keeps mastered and doubles interval %i with floor and cap', (previous, expected) => {
    const result = updateMastery(record('mastered', previous), outcome(), NOW);

    expect(result.stage).toBe('mastered');
    expect(result.scheduledIntervalMs).toBe(expected);
    expect(result.dueAt).toBe(new Date(Date.parse(NOW) + expected).toISOString());
  });

  it('ignores placement failures and caps placement promotion at familiar', () => {
    const failed = updateMastery(
      record('weak', DAY),
      outcome({ mode: 'placement', correct: false, independentCorrect: false }),
      NOW,
    );
    const capped = updateMastery(record('familiar', 3 * DAY), outcome({ mode: 'placement' }), NOW);

    expect(failed.stage).toBe('weak');
    expect(failed.scheduledIntervalMs).toBe(DAY);
    expect(capped.stage).toBe('familiar');
    expect(capped.scheduledIntervalMs).toBe(3 * DAY);
  });

  it('does not let placement change an existing stage above familiar', () => {
    const input = record('solid', 7 * DAY);

    const result = updateMastery(input, outcome({ mode: 'placement' }), NOW);

    expect(result.stage).toBe('solid');
    expect(result.scheduledIntervalMs).toBe(7 * DAY);
    expect(result.dueAt).toBe(input.dueAt);
  });

  it('returns a new record without mutating the input', () => {
    const input = record('learning', 10 * MINUTE, 1_200);
    const snapshot = structuredClone(input);

    const result = updateMastery(input, outcome(), NOW);

    expect(input).toEqual(snapshot);
    expect(result).not.toBe(input);
  });

  it('smooths response time after correctness without allowing slowness to block promotion', () => {
    const result = updateMastery(record('learning', 10 * MINUTE, 1_200), outcome({ responseMs: 2_200 }), NOW);

    expect(result.stage).toBe('weak');
    expect(result.smoothedResponseMs).toBe(1_400);
  });

  it('uses the first observed response as the initial smoothed value', () => {
    const result = updateMastery(record('new'), outcome({ responseMs: 875 }), NOW);

    expect(result.smoothedResponseMs).toBe(875);
  });
});

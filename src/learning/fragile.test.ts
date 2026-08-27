import { describe, expect, it } from 'vitest';
import { isFragile } from './fragile';
import type { AttemptEvent } from './types';

const NOW = '2026-08-27T12:00:00.000Z';

function event(completedAt: string, overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    attemptId: `attempt-${completedAt}-${overrides.correct === false ? 'fail' : 'pass'}`,
    sessionId: 'session-1',
    learnerId: 'learner-1',
    packId: 'fixture-pack',
    entityId: 'region-a',
    skill: 'identify_region',
    questionKind: 'identify_region',
    mode: 'smart',
    scheduledReview: false,
    delayedRetry: false,
    answerAttemptCount: 1,
    correct: true,
    independentCorrect: true,
    usedHint: false,
    responseMs: 1_000,
    completedAt,
    ...overrides,
  } as AttemptEvent;
}

const reachedFamiliar: readonly AttemptEvent[] = [
  event('2026-07-01T00:00:00.000Z'),
  event('2026-07-02T00:00:00.000Z'),
  event('2026-07-03T00:00:00.000Z'),
];

function failedReview(completedAt: string): AttemptEvent {
  return event(completedAt, {
    scheduledReview: true,
    answerAttemptCount: 2,
    correct: false,
    independentCorrect: false,
  });
}

function successfulReview(completedAt: string, overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return event(completedAt, { scheduledReview: true, ...overrides });
}

describe('isFragile', () => {
  it('marks a record that reached familiar after two scheduled-review failures in 30 days', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-05T00:00:00.000Z'),
      failedReview('2026-08-20T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(true);
  });

  it('does not mark when either failure is outside the previous 30 days', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-07-20T00:00:00.000Z'),
      failedReview('2026-08-20T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(false);
  });

  it('latches fragile after a historical rolling-window mark until valid review successes clear it', () => {
    const history = [
      event('2026-06-01T00:00:00.000Z'),
      event('2026-06-02T00:00:00.000Z'),
      event('2026-06-03T00:00:00.000Z'),
      failedReview('2026-07-01T00:00:00.000Z'),
      failedReview('2026-07-02T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(true);
  });

  it('does not mark when two failures were never within the same rolling 30-day window', () => {
    const history = [
      event('2026-04-01T00:00:00.000Z'),
      event('2026-04-02T00:00:00.000Z'),
      event('2026-04-03T00:00:00.000Z'),
      failedReview('2026-05-01T00:00:00.000Z'),
      failedReview('2026-06-05T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(false);
  });

  it('does not mark before the reconstructed mastery has reached familiar', () => {
    const history = [
      event('2026-08-01T00:00:00.000Z'),
      event('2026-08-02T00:00:00.000Z'),
      failedReview('2026-08-05T00:00:00.000Z'),
      failedReview('2026-08-20T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(false);
  });

  it('does not use non-scheduled or placement failures as marking evidence', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-05T00:00:00.000Z'),
      event('2026-08-10T00:00:00.000Z', {
        correct: false,
        independentCorrect: false,
        answerAttemptCount: 2,
      }),
      event('2026-08-20T00:00:00.000Z', {
        mode: 'placement',
        scheduledReview: true,
        correct: false,
        independentCorrect: false,
      }),
    ];

    expect(isFragile(history, NOW)).toBe(false);
  });

  it('reconstructs familiar from legal placement answers without using placement as evidence', () => {
    const placement = [
      event('2026-08-01T00:00:00.000Z', { mode: 'placement', independentCorrect: false }),
      event('2026-08-02T00:00:00.000Z', { mode: 'placement', independentCorrect: false }),
      event('2026-08-03T00:00:00.000Z', {
        mode: 'placement',
        scheduledReview: true,
        independentCorrect: false,
      }),
    ];
    const history = [
      ...placement,
      failedReview('2026-08-10T00:00:00.000Z'),
      failedReview('2026-08-20T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(true);
  });

  it('clears fragile after three independent scheduled-review successes at least 24 hours apart', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-01T00:00:00.000Z'),
      failedReview('2026-08-05T00:00:00.000Z'),
      successfulReview('2026-08-10T00:00:00.000Z'),
      successfulReview('2026-08-10T23:00:00.000Z'),
      successfulReview('2026-08-11T00:00:00.000Z'),
      successfulReview('2026-08-12T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(false);
  });

  it('stays fragile when the three successes are not mutually separated by 24 hours', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-01T00:00:00.000Z'),
      failedReview('2026-08-05T00:00:00.000Z'),
      successfulReview('2026-08-10T00:00:00.000Z'),
      successfulReview('2026-08-10T23:00:00.000Z'),
      successfulReview('2026-08-11T22:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(true);
  });

  it('does not clear with hinted, second-attempt, delayed-retry, or non-scheduled successes', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-01T00:00:00.000Z'),
      failedReview('2026-08-05T00:00:00.000Z'),
      successfulReview('2026-08-10T00:00:00.000Z'),
      successfulReview('2026-08-11T00:00:00.000Z', {
        independentCorrect: false,
        usedHint: true,
      }),
      successfulReview('2026-08-12T00:00:00.000Z', {
        independentCorrect: false,
        answerAttemptCount: 2,
      }),
      successfulReview('2026-08-13T00:00:00.000Z', { delayedRetry: true }),
      event('2026-08-14T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(true);
  });

  it('can mark again after clearing when two later review failures occur', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-01T00:00:00.000Z'),
      failedReview('2026-08-02T00:00:00.000Z'),
      successfulReview('2026-08-05T00:00:00.000Z'),
      successfulReview('2026-08-06T00:00:00.000Z'),
      successfulReview('2026-08-07T00:00:00.000Z'),
      failedReview('2026-08-15T00:00:00.000Z'),
      failedReview('2026-08-20T00:00:00.000Z'),
    ];

    expect(isFragile(history, NOW)).toBe(true);
  });

  it('does not mutate or reorder event history', () => {
    const history = [
      ...reachedFamiliar,
      failedReview('2026-08-20T00:00:00.000Z'),
      failedReview('2026-08-05T00:00:00.000Z'),
    ];
    const snapshot = structuredClone(history);

    isFragile(history, NOW);

    expect(history).toEqual(snapshot);
  });
});

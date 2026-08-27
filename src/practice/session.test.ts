import { describe, expect, it } from 'vitest';

import type { Question } from '../learning/questions';
import {
  insertDelayedRetry,
  validateSessionRequest,
  type PracticeSession,
  type RetryDebt,
} from './session';

function question(index: number): Question {
  return { kind: 'locate_region', presentation: 'map', entityId: `r${index}` };
}

function makeSession(questionCount = 12): PracticeSession {
  return {
    sessionId: 'session-1',
    learnerId: 'learner-1',
    request: { mode: 'smart', packId: 'pack-1' },
    baseQuestionCount: questionCount,
    introductions: [],
    introductionCursor: 0,
    questions: Array.from({ length: questionCount }, (_, index) => question(index)),
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: '2026-08-27T00:00:00.000Z',
    accumulatedPauseMs: 0,
  };
}

const debt: RetryDebt = {
  entityId: 'r1',
  skill: 'locate_region',
  sourceQuestionKind: 'locate_region',
  createdAt: '2026-08-27T00:01:00.000Z',
  priority: 'immediate',
};

describe('validateSessionRequest', () => {
  it.each([1, 25, 50])('accepts custom count %i and preserves the exact request', (questionCount) => {
    const request = {
      mode: 'custom' as const,
      packId: 'pack-1',
      questionCount,
      entityIds: ['r1'] as const,
      skills: ['locate_region'] as const,
      statuses: ['new', 'fragile'] as const,
    };
    expect(validateSessionRequest(request)).toBe(request);
  });

  it.each([0, 1.5, 51, Number.NaN])('refuses invalid custom question count %s', (questionCount) => {
    expect(() =>
      validateSessionRequest({
        mode: 'custom',
        packId: 'pack-1',
        questionCount,
        entityIds: ['r1'],
        skills: ['locate_region'],
        statuses: ['new'],
      }),
    ).toThrow(/1.*50/i);
  });

  it('refuses empty custom tuples at the runtime boundary', () => {
    expect(() =>
      validateSessionRequest({
        mode: 'custom',
        packId: 'pack-1',
        questionCount: 12,
        entityIds: [],
        skills: [],
        statuses: ['new'],
      } as never),
    ).toThrow(/non-empty/i);
  });

  it('allows an empty status filter because only entity and skill tuples are frozen non-empty', () => {
    const request = {
      mode: 'custom' as const,
      packId: 'pack-1',
      questionCount: 12,
      entityIds: ['r1'] as const,
      skills: ['locate_region'] as const,
      statuses: [],
    };
    expect(validateSessionRequest(request)).toBe(request);
  });
});

describe('insertDelayedRetry', () => {
  it.each([
    { random: 0, expectedGap: 3 },
    { random: 0.34, expectedGap: 4 },
    { random: 0.99, expectedGap: 5 },
  ])('inserts a supplied variation after $expectedGap other questions', ({ random, expectedGap }) => {
    const session = makeSession();
    const variation: Question = { kind: 'identify_region', presentation: 'text', entityId: 'r1', answer: { acceptedDisplayValues: ['一区'] } };
    const result = insertDelayedRetry({
      session,
      revealedQuestionIndex: 1,
      variation,
      debt,
      random: { next: () => random },
    });

    expect(result.questions.indexOf(variation) - 1).toBe(expectedGap + 1);
    expect(result.questions).toHaveLength(13);
    expect(result.baseQuestionCount).toBe(12);
    expect(result.carryoverRetryDebts).toEqual([]);
    expect(session.questions).toHaveLength(12);
  });

  it('uses an available legal gap when the random choice points beyond the queue', () => {
    const variation = question(99);
    const result = insertDelayedRetry({
      session: makeSession(),
      revealedQuestionIndex: 8,
      variation,
      debt,
      random: { next: () => 0.99 },
    });

    expect(result.questions.indexOf(variation) - 8).toBe(4);
    expect(result.carryoverRetryDebts).toEqual([]);
  });

  it('carries debt when fewer than three other questions remain after reveal', () => {
    const result = insertDelayedRetry({
      session: makeSession(),
      revealedQuestionIndex: 9,
      variation: question(99),
      debt,
      random: { next: () => 0 },
    });

    expect(result.questions).toHaveLength(12);
    expect(result.carryoverRetryDebts).toEqual([debt]);
  });

  it('carries the exact debt in stable order when no 3–5 position gap fits', () => {
    const existing: RetryDebt = { ...debt, entityId: 'r0' };
    const session = { ...makeSession(), carryoverRetryDebts: [existing] };
    const result = insertDelayedRetry({
      session,
      revealedQuestionIndex: 10,
      variation: question(99),
      debt,
      random: { next: () => 0.5 },
    });

    expect(result.questions).toEqual(session.questions);
    expect(result.carryoverRetryDebts).toEqual([existing, debt]);
    expect(result.carryoverRetryDebts[1]).toBe(debt);
  });

  it('never exceeds the 15-question hard cap and leaves base count unchanged', () => {
    const session = makeSession(15);
    const result = insertDelayedRetry({
      session,
      revealedQuestionIndex: 0,
      variation: question(99),
      debt,
      random: { next: () => 0 },
    });

    expect(result.questions).toHaveLength(15);
    expect(result.baseQuestionCount).toBe(15);
    expect(result.carryoverRetryDebts).toEqual([debt]);
  });

  it.each([Number.NaN, -0.1, 1, Number.POSITIVE_INFINITY])(
    'refuses invalid random value %s without mutating the session',
    (value) => {
      const session = makeSession();
      const before = JSON.stringify(session);
      expect(() =>
        insertDelayedRetry({
          session,
          revealedQuestionIndex: 0,
          variation: question(99),
          debt,
          random: { next: () => value },
        }),
      ).toThrow(/random/i);
      expect(JSON.stringify(session)).toBe(before);
    },
  );
});

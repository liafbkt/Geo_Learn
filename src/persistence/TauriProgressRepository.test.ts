import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';
import { TauriProgressRepository } from './TauriProgressRepository';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

function mastery(overrides: Partial<MasteryRecord> = {}): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'china-provinces',
    entityId: 'anhui',
    skill: 'locate_region',
    stage: 'learning',
    scheduledIntervalMs: 86_400_000,
    dueAt: '2026-08-27T12:00:00.000Z',
    smoothedResponseMs: 1_294.6,
    updatedAt: '2026-08-26T12:01:00.000Z',
    ...overrides,
  };
}

function event(): AttemptEvent {
  return {
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    learnerId: 'learner-1',
    packId: 'china-provinces',
    entityId: 'anhui',
    skill: 'locate_region',
    questionKind: 'locate_region',
    scheduledReview: false,
    delayedRetry: false,
    answerAttemptCount: 1,
    correct: true,
    usedHint: false,
    responseMs: 2_000,
    completedAt: '2026-08-26T12:01:00.000Z',
    mode: 'smart',
    independentCorrect: true,
  };
}

function session(): PracticeSession {
  return {
    sessionId: 'session-1',
    learnerId: 'learner-1',
    request: { mode: 'smart', packId: 'china-provinces' },
    baseQuestionCount: 2,
    introductions: ['anhui'],
    introductionCursor: 1,
    questions: [{ kind: 'locate_region', presentation: 'map', entityId: 'anhui' }],
    questionCursor: 0,
    carryoverRetryDebts: [
      {
        entityId: 'anhui',
        skill: 'locate_region',
        sourceQuestionKind: 'locate_region',
        createdAt: '2026-08-26T12:00:30.000Z',
        priority: 'immediate',
      },
    ],
    startedAt: '2026-08-26T12:00:00.000Z',
    accumulatedPauseMs: 0,
  };
}

describe('TauriProgressRepository', () => {
  beforeEach(() => invokeMock.mockReset());

  it('uses exactly the six progress commands with explicit camelCase payloads and preserves a fractional EMA', async () => {
    const repository = new TauriProgressRepository();
    invokeMock.mockResolvedValueOnce([mastery()]);
    await expect(repository.loadSnapshot('learner-1', 'china-provinces')).resolves.toEqual([
      mastery(),
    ]);

    invokeMock.mockResolvedValueOnce(undefined);
    await repository.saveAttempt({ event: event(), session: session(), mastery: mastery() });
    invokeMock.mockResolvedValueOnce(undefined);
    await repository.saveSession(session());
    invokeMock.mockResolvedValueOnce(session());
    await repository.loadResumableSession(
      'learner-1',
      'china-provinces',
      '2026-08-27T12:00:00.000Z',
    );
    invokeMock.mockResolvedValueOnce({
      audio: { enabled: true, packId: 'crisp', volume: 0.7 },
    });
    await repository.loadSettings();
    invokeMock.mockResolvedValueOnce(undefined);
    await repository.saveSettings({
      audio: { enabled: false, packId: 'minimal', volume: 0.25 },
    });

    expect(invokeMock.mock.calls).toEqual([
      ['load_progress_snapshot', { learnerId: 'learner-1', packId: 'china-provinces' }],
      [
        'save_attempt_transaction',
        { input: { event: event(), session: session(), mastery: mastery() } },
      ],
      ['save_practice_session', { session: session() }],
      [
        'load_resumable_session',
        {
          learnerId: 'learner-1',
          packId: 'china-provinces',
          now: '2026-08-27T12:00:00.000Z',
        },
      ],
      ['load_settings'],
      [
        'save_settings',
        { settings: { audio: { enabled: false, packId: 'minimal', volume: 0.25 } } },
      ],
    ]);
  });

  it.each([
    ['missing string ID', mastery({ entityId: undefined as unknown as string })],
    ['unsupported skill', mastery({ skill: 'unknown' as MasteryRecord['skill'] })],
    ['unsupported stage', mastery({ stage: 'legendary' as MasteryRecord['stage'] })],
    ['negative interval', mastery({ scheduledIntervalMs: -1 })],
    ['non-finite EMA', mastery({ smoothedResponseMs: Number.NaN })],
  ])('rejects malformed native mastery: %s', async (_label, malformed) => {
    invokeMock.mockResolvedValueOnce([malformed]);
    await expect(
      new TauriProgressRepository().loadSnapshot('learner-1', 'china-provinces'),
    ).rejects.toThrow(/mastery|entity|skill|stage|interval|response/i);
  });

  it.each([
    ['request mode', { ...session(), request: { mode: 'mystery', packId: 'china-provinces' } }],
    ['cursor', { ...session(), questionCursor: 2 }],
    [
      'question discriminant',
      {
        ...session(),
        questions: [{ kind: 'locate_region', presentation: 'text', entityId: 'anhui' }],
      },
    ],
    [
      'retry debt',
      {
        ...session(),
        carryoverRetryDebts: [
          { ...session().carryoverRetryDebts[0], priority: 'later' },
        ],
      },
    ],
    ['array shape', { ...session(), introductions: 'anhui' }],
  ])('rejects malformed native session: %s', async (_label, malformed) => {
    invokeMock.mockResolvedValueOnce(malformed);
    await expect(
      new TauriProgressRepository().loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:00:00.000Z',
      ),
    ).rejects.toThrow(/session|request|cursor|question|retry|array|introduction/i);
  });
});

import { describe, expect, it } from 'vitest';
import type { AppSettings } from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';
import { InMemoryProgressRepository } from './InMemoryProgressRepository';

const startedAt = '2026-08-26T12:00:00.000Z';

function mastery(overrides: Partial<MasteryRecord> = {}): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'china-provinces',
    entityId: 'anhui',
    skill: 'locate_region',
    stage: 'learning',
    scheduledIntervalMs: 86_400_000,
    dueAt: '2026-08-27T12:00:00.000Z',
    smoothedResponseMs: 2_000,
    updatedAt: '2026-08-26T12:01:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
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
    ...overrides,
  } as AttemptEvent;
}

function session(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    sessionId: 'session-1',
    learnerId: 'learner-1',
    request: { mode: 'smart', packId: 'china-provinces' },
    baseQuestionCount: 2,
    introductions: ['anhui', 'beijing'],
    introductionCursor: 1,
    questions: [
      { kind: 'locate_region', presentation: 'map', entityId: 'anhui' },
      { kind: 'locate_region', presentation: 'map', entityId: 'beijing' },
    ],
    questionCursor: 1,
    carryoverRetryDebts: [
      {
        entityId: 'anhui',
        skill: 'locate_region',
        sourceQuestionKind: 'locate_region',
        createdAt: '2026-08-26T12:00:30.000Z',
        priority: 'immediate',
      },
    ],
    startedAt,
    accumulatedPauseMs: 0,
    ...overrides,
  };
}

describe('InMemoryProgressRepository', () => {
  it('atomically saves an attempt, its natural-key mastery upsert, and both cursors', async () => {
    const repository = new InMemoryProgressRepository();
    const advanced = session({ questionCursor: 1, introductionCursor: 2 });

    await repository.saveAttempt({ event: event(), session: advanced, mastery: mastery() });

    expect(await repository.loadSnapshot('learner-1', 'china-provinces')).toEqual([mastery()]);
    expect(
      await repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:00:00.000Z',
      ),
    ).toMatchObject({ questionCursor: 1, introductionCursor: 2 });
  });

  it('makes a duplicate attempt ID a no-op for mastery and session state', async () => {
    const repository = new InMemoryProgressRepository();
    await repository.saveAttempt({ event: event(), session: session(), mastery: mastery() });

    await repository.saveAttempt({
      event: event(),
      session: session({ questionCursor: 2, introductionCursor: 2 }),
      mastery: mastery({ stage: 'mastered', updatedAt: '2026-08-26T13:00:00.000Z' }),
    });

    expect(await repository.loadSnapshot('learner-1', 'china-provinces')).toEqual([mastery()]);
    expect(
      await repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:00:00.000Z',
      ),
    ).toMatchObject({ questionCursor: 1, introductionCursor: 1 });
  });

  it('upserts mastery by learner, pack, entity, and skill without crossing scopes', async () => {
    const repository = new InMemoryProgressRepository();
    await repository.saveAttempt({ event: event(), session: session(), mastery: mastery() });
    const replacement = mastery({
      stage: 'solid',
      updatedAt: '2026-08-26T13:00:00.000Z',
    });
    await repository.saveAttempt({
      event: event({ attemptId: 'attempt-2', completedAt: '2026-08-26T13:00:00.000Z' }),
      session: session(),
      mastery: replacement,
    });
    await repository.saveAttempt({
      event: event({
        attemptId: 'attempt-3',
        sessionId: 'session-2',
        learnerId: 'learner-2',
        completedAt: '2026-08-26T13:01:00.000Z',
      }),
      session: session({ learnerId: 'learner-2', sessionId: 'session-2' }),
      mastery: mastery({ learnerId: 'learner-2', stage: 'weak' }),
    });

    expect(await repository.loadSnapshot('learner-1', 'china-provinces')).toEqual([replacement]);
    expect(await repository.loadSnapshot('learner-2', 'china-provinces')).toEqual([
      mastery({ learnerId: 'learner-2', stage: 'weak' }),
    ]);
    expect(await repository.loadSnapshot('learner-1', 'world-countries')).toEqual([]);
  });

  it('rejects an invalid write before changing any observable state', async () => {
    const repository = new InMemoryProgressRepository();

    await expect(
      repository.saveAttempt({
        event: event(),
        session: session(),
        mastery: mastery({ dueAt: 'not-a-time' }),
      }),
    ).rejects.toThrow(/timestamp/i);

    expect(await repository.loadSnapshot('learner-1', 'china-provinces')).toEqual([]);
    expect(
      await repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T00:00:00.000Z',
      ),
    ).toBeNull();
  });

  it('returns deeply cloned values on writes and reads', async () => {
    const repository = new InMemoryProgressRepository();
    const writableSession = session() as unknown as {
      introductions: string[];
      questions: Array<{ entityId: string }>;
      carryoverRetryDebts: Array<{ entityId: string }>;
    };
    await repository.saveSession(writableSession as unknown as PracticeSession);
    writableSession.introductions[0] = 'mutated';
    writableSession.questions[0]!.entityId = 'mutated';
    writableSession.carryoverRetryDebts[0]!.entityId = 'mutated';

    const first = await repository.loadResumableSession(
      'learner-1',
      'china-provinces',
      '2026-08-27T12:00:00.000Z',
    );
    expect(first).toMatchObject({
      introductions: ['anhui', 'beijing'],
      questions: [{ entityId: 'anhui' }, { entityId: 'beijing' }],
      carryoverRetryDebts: [{ entityId: 'anhui' }],
    });

    (first as unknown as { questions: Array<{ entityId: string }> }).questions[0]!.entityId =
      'also-mutated';
    expect(
      await repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:00:00.000Z',
      ),
    ).toMatchObject({ questions: [{ entityId: 'anhui' }, { entityId: 'beijing' }] });
  });

  it('uses the inclusive one-day adjusted-start boundary and excludes older sessions', async () => {
    const repository = new InMemoryProgressRepository();
    await repository.saveSession(session({ accumulatedPauseMs: 60_000 }));

    expect(
      await repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:01:00.000Z',
      ),
    ).not.toBeNull();
    expect(
      await repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:01:00.001Z',
      ),
    ).toBeNull();
  });

  it('chooses the newest eligible unfinished session deterministically and excludes completed sessions', async () => {
    const repository = new InMemoryProgressRepository();
    await repository.saveSession(session({ sessionId: 'older' }));
    await repository.saveSession(
      session({ sessionId: 'newer', startedAt: '2026-08-26T13:00:00.000Z' }),
    );
    await repository.saveSession(
      session({
        sessionId: 'completed',
        startedAt: '2026-08-26T14:00:00.000Z',
        questionCursor: 2,
      }),
    );

    await expect(
      repository.loadResumableSession(
        'learner-1',
        'china-provinces',
        '2026-08-27T12:00:00.000Z',
      ),
    ).resolves.toMatchObject({ sessionId: 'newer' });
  });

  it('returns mastery in deterministic entity and skill order', async () => {
    const repository = new InMemoryProgressRepository();
    const cases = [
      mastery({ entityId: 'beijing', skill: 'identify_region' }),
      mastery({ entityId: 'anhui', skill: 'locate_region' }),
      mastery({ entityId: 'beijing', skill: 'associate_capital' }),
    ];
    for (const [index, record] of cases.entries()) {
      await repository.saveAttempt({
        event: event({
          attemptId: `attempt-${index + 1}`,
          entityId: record.entityId,
          skill: record.skill,
          questionKind: record.skill,
        }),
        session: session(),
        mastery: record,
      });
    }

    expect(
      (await repository.loadSnapshot('learner-1', 'china-provinces')).map(
        ({ entityId, skill }) => `${entityId}:${skill}`,
      ),
    ).toEqual([
      'anhui:locate_region',
      'beijing:associate_capital',
      'beijing:identify_region',
    ]);
  });

  it('persists cloned settings and rejects unsupported or out-of-range audio values', async () => {
    const repository = new InMemoryProgressRepository();
    const settings: AppSettings = {
      audio: { enabled: true, packId: 'soft', volume: 0.25 },
    };
    await repository.saveSettings(settings);

    expect(await repository.loadSettings()).toEqual(settings);
    await expect(
      repository.saveSettings({
        audio: { enabled: true, packId: 'soft', volume: Number.NaN },
      }),
    ).rejects.toThrow(/volume/i);
    await expect(
      repository.saveSettings({ audio: { enabled: true, packId: 'soft', volume: 1.1 } }),
    ).rejects.toThrow(/volume/i);
    await expect(
      repository.saveSettings({
        audio: { enabled: true, packId: 'unknown', volume: 0.5 },
      } as unknown as AppSettings),
    ).rejects.toThrow(/pack/i);
    expect(await repository.loadSettings()).toEqual(settings);
  });

  it('rejects invalid public IDs and timestamps', async () => {
    const repository = new InMemoryProgressRepository();

    await expect(repository.loadSnapshot('../learner', 'china-provinces')).rejects.toThrow(/ID/i);
    await expect(
      repository.loadResumableSession('learner-1', 'china-provinces', 'yesterday'),
    ).rejects.toThrow(/timestamp/i);
    await expect(
      repository.saveSession(session({ sessionId: '', startedAt: 'local noon' })),
    ).rejects.toThrow();
  });
});

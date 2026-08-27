import { describe, expect, it } from 'vitest';

import type { AppSettings } from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';
import {
  BackupMergeError,
  mergeBackupRecords,
  serializeBackupRecords,
  type BackupRecords,
  type BackupSessionRecord,
} from './backup';

const LOCAL_SETTINGS: AppSettings = {
  audio: { enabled: true, packId: 'crisp', volume: 0.7 },
};

const IMPORTED_SETTINGS: AppSettings = {
  audio: { enabled: false, packId: 'soft', volume: 0.25 },
};

function mastery(overrides: Partial<MasteryRecord> = {}): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'china-provinces',
    entityId: 'anhui',
    skill: 'locate_region',
    stage: 'learning',
    scheduledIntervalMs: 86_400_000,
    dueAt: '2026-08-28T12:00:00.000Z',
    smoothedResponseMs: 1_500,
    updatedAt: '2026-08-27T12:00:00.000Z',
    ...overrides,
  };
}

function attempt(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
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
    completedAt: '2026-08-27T12:00:00.000Z',
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
    carryoverRetryDebts: [],
    startedAt: '2026-08-27T11:59:00.000Z',
    accumulatedPauseMs: 0,
    ...overrides,
  };
}

function savedSession(
  savedAt: string,
  overrides: Partial<PracticeSession> = {},
): BackupSessionRecord {
  return { session: session(overrides), savedAt };
}

function records(overrides: Partial<BackupRecords> = {}): BackupRecords {
  return {
    mastery: [],
    attempts: [],
    sessions: [],
    settings: LOCAL_SETTINGS,
    ...overrides,
  };
}

describe('mergeBackupRecords', () => {
  it('keeps the newer mastery snapshot for its natural key', () => {
    const older = mastery({ stage: 'learning', updatedAt: '2026-08-27T12:00:00.000Z' });
    const newer = mastery({ stage: 'solid', updatedAt: '2026-08-27T13:00:00.000Z' });

    const merged = mergeBackupRecords(records({ mastery: [older] }), records({ mastery: [newer] }), {
      includeSettings: false,
    });

    expect(merged.mastery).toEqual([newer]);
  });

  it('breaks equal mastery timestamps by deduplicated independent-success count', () => {
    const local = mastery({ stage: 'weak' });
    const imported = mastery({ stage: 'solid' });
    const sharedAttempt = attempt({ attemptId: 'attempt-shared' });
    const importedExtra = attempt({
      attemptId: 'attempt-extra',
      completedAt: '2026-08-27T12:01:00.000Z',
    });

    const merged = mergeBackupRecords(
      records({ mastery: [local], attempts: [sharedAttempt] }),
      records({ mastery: [imported], attempts: [sharedAttempt, importedExtra] }),
      { includeSettings: false },
    );

    expect(merged.mastery).toEqual([imported]);
    expect(merged.attempts).toHaveLength(2);
  });

  it('uses a documented canonical tie-break for fully tied mastery records', () => {
    const familiar = mastery({ stage: 'familiar' });
    const solid = mastery({ stage: 'solid' });

    const forward = mergeBackupRecords(
      records({ mastery: [solid] }),
      records({ mastery: [familiar] }),
      { includeSettings: false },
    );
    const reverse = mergeBackupRecords(
      records({ mastery: [familiar] }),
      records({ mastery: [solid] }),
      { includeSettings: false },
    );

    expect(forward.mastery).toEqual(reverse.mastery);
    expect(forward.mastery).toEqual([familiar]);
  });

  it('rejects identical attempt IDs with conflicting payloads', () => {
    const local = attempt({ attemptId: 'attempt-conflict', responseMs: 1_000 });
    const imported = attempt({ attemptId: 'attempt-conflict', responseMs: 2_000 });

    expect(() =>
      mergeBackupRecords(records({ attempts: [local] }), records({ attempts: [imported] }), {
        includeSettings: false,
      }),
    ).toThrowError(new BackupMergeError('attempt_conflict', 'Backup attempts conflict.'));
  });

  it('leaves local settings unchanged unless includeSettings is explicit', () => {
    const current = records({ settings: LOCAL_SETTINGS });
    const imported = records({ settings: IMPORTED_SETTINGS });

    expect(mergeBackupRecords(current, imported, { includeSettings: false }).settings).toEqual(
      LOCAL_SETTINGS,
    );
    expect(mergeBackupRecords(current, imported, { includeSettings: true }).settings).toEqual(
      IMPORTED_SETTINGS,
    );
  });

  it('does not move session cursors backward even when the imported save is newer', () => {
    const advanced = savedSession('2026-08-27T12:00:00.000Z', {
      introductionCursor: 2,
      questionCursor: 2,
    });
    const newerButRegressed = savedSession('2026-08-27T13:00:00.000Z', {
      introductionCursor: 1,
      questionCursor: 1,
    });

    const merged = mergeBackupRecords(
      records({ sessions: [advanced] }),
      records({ sessions: [newerButRegressed] }),
      { includeSettings: false },
    );

    expect(merged.sessions).toEqual([advanced]);
  });

  it('uses the newer persisted savedAt state when cursors are equal', () => {
    const older = savedSession('2026-08-27T12:00:00.000Z', { accumulatedPauseMs: 100 });
    const newer = savedSession('2026-08-27T13:00:00.000Z', { accumulatedPauseMs: 200 });

    const merged = mergeBackupRecords(
      records({ sessions: [older] }),
      records({ sessions: [newer] }),
      { includeSettings: false },
    );

    expect(merged.sessions).toEqual([newer]);
  });

  it('sorts natural keys and IDs with ASCII code-unit ordering', () => {
    const entityIds = ['a', 'A', 'a_b', 'a-b', 'a.b', 'a:b'];
    const attemptIds = ['a', 'A', 'a_b', 'a-b', 'a.b', 'a:b'];
    const sessionIds = ['a', 'A', 'a_b', 'a-b', 'a.b', 'a:b'];

    const merged = mergeBackupRecords(
      records(),
      records({
        mastery: entityIds.map((entityId) => mastery({ entityId })),
        attempts: attemptIds.map((attemptId) => attempt({ attemptId })),
        sessions: sessionIds.map((sessionId) =>
          savedSession('2026-08-27T12:00:00.000Z', { sessionId }),
        ),
      }),
      { includeSettings: false },
    );

    const expected = ['A', 'a', 'a-b', 'a.b', 'a:b', 'a_b'];
    expect(merged.mastery.map((item) => item.entityId)).toEqual(expected);
    expect(merged.attempts.map((item) => item.attemptId)).toEqual(expected);
    expect(merged.sessions.map((item) => item.session.sessionId)).toEqual(expected);
  });

  it('does not mutate either input graph', () => {
    const current = records({
      mastery: [mastery()],
      attempts: [attempt()],
      sessions: [savedSession('2026-08-27T12:00:00.000Z')],
    });
    const imported = records({ settings: IMPORTED_SETTINGS });
    const beforeCurrent = structuredClone(current);
    const beforeImported = structuredClone(imported);

    mergeBackupRecords(current, imported, { includeSettings: true });

    expect(current).toEqual(beforeCurrent);
    expect(imported).toEqual(beforeImported);
  });

  it('serializes repeated and reversed imports to byte-equivalent JSON', () => {
    const current = records({
      mastery: [mastery({ entityId: 'beijing' })],
      attempts: [attempt({ attemptId: 'attempt-b', entityId: 'beijing' })],
    });
    const imported = records({
      mastery: [mastery({ entityId: 'anhui' })],
      attempts: [attempt({ attemptId: 'attempt-a' })],
    });

    const first = mergeBackupRecords(current, imported, { includeSettings: false });
    const repeated = mergeBackupRecords(first, imported, { includeSettings: false });
    const reversed = mergeBackupRecords(imported, current, { includeSettings: false });

    expect(serializeBackupRecords(first)).toBe(serializeBackupRecords(repeated));
    expect(serializeBackupRecords(first)).toBe(serializeBackupRecords(reversed));
  });
});

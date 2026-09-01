import { describe, expect, it } from 'vitest';
import type { MasteryRecord, AttemptEvent } from '../learning/types';
import type { PracticeSession } from '../practice/session';
import { E2EProgressRepository } from './E2EProgressRepository';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();

  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

function session(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    sessionId: 'resume-me',
    learnerId: 'learner-1',
    request: { mode: 'smart', packId: 'us-states' },
    baseQuestionCount: 2,
    introductions: [],
    introductionCursor: 0,
    questions: [
      { kind: 'locate_region', presentation: 'map', entityId: 'alabama' },
      { kind: 'locate_region', presentation: 'map', entityId: 'alaska' },
    ],
    questionCursor: 1,
    carryoverRetryDebts: [],
    startedAt: '2026-09-01T00:00:00.000Z',
    accumulatedPauseMs: 0,
    ...overrides,
  };
}

function attempt(): AttemptEvent {
  return {
    attemptId: 'attempt-1',
    sessionId: 'resume-me',
    learnerId: 'learner-1',
    packId: 'us-states',
    entityId: 'alabama',
    skill: 'locate_region',
    questionKind: 'locate_region',
    scheduledReview: false,
    delayedRetry: false,
    answerAttemptCount: 1,
    correct: true,
    usedHint: false,
    responseMs: 100,
    completedAt: '2026-09-01T00:01:00.000Z',
    mode: 'smart',
    independentCorrect: true,
  };
}

function mastery(): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'us-states',
    entityId: 'alabama',
    skill: 'locate_region',
    stage: 'learning',
    scheduledIntervalMs: 86_400_000,
    dueAt: '2026-09-02T00:01:00.000Z',
    smoothedResponseMs: 100,
    updatedAt: '2026-09-01T00:01:00.000Z',
  };
}

describe('E2EProgressRepository', () => {
  it('restores a saved unfinished session from the same browser storage', async () => {
    const storage = new MemoryStorage();
    const first = new E2EProgressRepository(storage);
    await first.saveSession(session());

    const second = new E2EProgressRepository(storage);

    await expect(
      second.loadResumableSession('learner-1', 'us-states', '2026-09-01T01:00:00.000Z'),
    ).resolves.toMatchObject({ sessionId: 'resume-me', questionCursor: 1 });
  });

  it('fails one attempt save before mutation and succeeds on retry without duplication', async () => {
    const storage = new MemoryStorage();
    const repository = new E2EProgressRepository(storage);
    repository.failNextAttemptSave();

    await expect(
      repository.saveAttempt({ event: attempt(), session: session(), mastery: mastery() }),
    ).rejects.toThrow(/injected/i);
    await expect(repository.loadAttemptHistory('learner-1', 'us-states')).resolves.toEqual([]);

    await repository.saveAttempt({ event: attempt(), session: session(), mastery: mastery() });
    await repository.saveAttempt({ event: attempt(), session: session(), mastery: mastery() });

    const restored = new E2EProgressRepository(storage);
    await expect(restored.loadAttemptHistory('learner-1', 'us-states')).resolves.toEqual([
      attempt(),
    ]);
  });

  it('rejects malformed persisted state instead of silently resetting learning data', () => {
    const storage = new MemoryStorage();
    storage.setItem('geolearn:e2e:progress:v1', '{"sessions":"not-an-array"}');

    expect(() => new E2EProgressRepository(storage)).toThrow(/persisted/i);
  });
});

import { describe, expect, it } from 'vitest';
import type { BackupRecords } from '../persistence/backup';
import type { PracticeSession } from '../practice/session';
import { E2EBackupCommands } from './E2EBackupCommands';
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

function session(id: string, cursor = 0): PracticeSession {
  return {
    sessionId: id,
    learnerId: 'local-default',
    request: { mode: 'smart', packId: 'us-states' },
    baseQuestionCount: 1,
    introductions: [],
    introductionCursor: 0,
    questions: [{ kind: 'locate_region', presentation: 'map', entityId: 'alabama' }],
    questionCursor: cursor,
    carryoverRetryDebts: [],
    startedAt: '2026-09-01T00:00:00.000Z',
    accumulatedPauseMs: 0,
  };
}

function records(
  id: string,
  packId: 'soft' | 'minimal' = 'soft',
): BackupRecords {
  return {
    mastery: [],
    attempts: [],
    sessions: [{ session: session(id), savedAt: '2026-09-01T00:10:00.000Z' }],
    settings: { audio: { enabled: true, packId, volume: 0.25 } },
  };
}

describe('E2EBackupCommands', () => {
  it('inspects a valid backup without mutating progress and consumes its staging ID once', async () => {
    const repository = new E2EProgressRepository(new MemoryStorage());
    await repository.saveSession(session('current'));
    const commands = new E2EBackupCommands(repository, () => '2026-09-01T01:00:00.000Z');
    commands.setScenario({ kind: 'valid', records: records('imported') });
    const before = repository.exportState();

    const summary = await commands.inspectBackup();

    expect(repository.exportState()).toEqual(before);
    expect(summary).toMatchObject({
      learnerId: 'local-default',
      masteryCount: 0,
      attemptCount: 0,
      sessionCount: 1,
      includesSettings: true,
    });
    await commands.importBackup({
      stagingId: summary!.stagingId,
      mode: 'merge',
      includeSettings: false,
    });
    await expect(
      commands.importBackup({
        stagingId: summary!.stagingId,
        mode: 'merge',
        includeSettings: false,
      }),
    ).rejects.toThrow(/expired/i);
  });

  it('uses production merge behavior and preserves current settings by default', async () => {
    const repository = new E2EProgressRepository(new MemoryStorage());
    await repository.saveSession(session('current'));
    await repository.saveSettings({ audio: { enabled: true, packId: 'crisp', volume: 0.7 } });
    const commands = new E2EBackupCommands(repository, () => '2026-09-01T01:00:00.000Z');
    commands.setScenario({ kind: 'valid', records: records('imported', 'minimal') });

    const summary = await commands.inspectBackup();
    await commands.importBackup({
      stagingId: summary!.stagingId,
      mode: 'merge',
      includeSettings: false,
    });

    expect(repository.exportState().sessions.map(({ sessionId }) => sessionId).sort()).toEqual([
      'current',
      'imported',
    ]);
    await expect(repository.loadSettings()).resolves.toEqual({
      audio: { enabled: true, packId: 'crisp', volume: 0.7 },
    });
  });

  it('replace imports the validated backup including its settings', async () => {
    const repository = new E2EProgressRepository(new MemoryStorage());
    await repository.saveSession(session('current'));
    const commands = new E2EBackupCommands(repository, () => '2026-09-01T01:00:00.000Z');
    commands.setScenario({ kind: 'valid', records: records('replacement', 'minimal') });

    const summary = await commands.inspectBackup();
    await commands.importBackup({
      stagingId: summary!.stagingId,
      mode: 'replace',
      includeSettings: true,
    });

    expect(repository.exportState().sessions.map(({ sessionId }) => sessionId)).toEqual([
      'replacement',
    ]);
    await expect(repository.loadSettings()).resolves.toEqual({
      audio: { enabled: true, packId: 'minimal', volume: 0.25 },
    });
  });

  it('rejects a corrupt backup before staging or mutating progress', async () => {
    const repository = new E2EProgressRepository(new MemoryStorage());
    await repository.saveSession(session('current'));
    const commands = new E2EBackupCommands(repository, () => '2026-09-01T01:00:00.000Z');
    commands.setScenario({ kind: 'corrupt' });
    const before = repository.exportState();

    await expect(commands.inspectBackup()).rejects.toThrow(/corrupt/i);

    expect(repository.exportState()).toEqual(before);
    await expect(
      commands.importBackup({ stagingId: 'stage-1', mode: 'replace', includeSettings: true }),
    ).rejects.toThrow(/expired/i);
  });

  it('leaves repository state unchanged when replacement validation fails', async () => {
    const repository = new E2EProgressRepository(new MemoryStorage());
    await repository.saveSession(session('current'));
    const commands = new E2EBackupCommands(repository, () => '2026-09-01T01:00:00.000Z');
    const invalid = records('invalid') as unknown as {
      sessions: Array<{ session: PracticeSession; savedAt: string }>;
    };
    invalid.sessions[0] = {
      session: session('invalid', 99),
      savedAt: '2026-09-01T00:10:00.000Z',
    };
    commands.setScenario({ kind: 'valid', records: invalid as unknown as BackupRecords });
    const before = repository.exportState();

    const summary = await commands.inspectBackup();
    await expect(
      commands.importBackup({
        stagingId: summary!.stagingId,
        mode: 'replace',
        includeSettings: true,
      }),
    ).rejects.toThrow(/cursor/i);

    expect(repository.exportState()).toEqual(before);
  });

  it('can inject one post-import refresh failure without rolling back the import', async () => {
    const repository = new E2EProgressRepository(new MemoryStorage());
    const commands = new E2EBackupCommands(repository, () => '2026-09-01T01:00:00.000Z');
    commands.setScenario({
      kind: 'valid',
      records: records('imported'),
      failRefreshOnce: true,
    });
    const summary = await commands.inspectBackup();

    await commands.importBackup({
      stagingId: summary!.stagingId,
      mode: 'replace',
      includeSettings: true,
    });

    await expect(repository.loadSnapshot('local-default', 'us-states')).rejects.toThrow(/refresh/i);
    await expect(repository.loadSnapshot('local-default', 'us-states')).resolves.toEqual([]);
    expect(repository.exportState().sessions.map(({ sessionId }) => sessionId)).toEqual(['imported']);
  });
});

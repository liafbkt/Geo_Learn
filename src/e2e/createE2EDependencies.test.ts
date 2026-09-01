import { describe, expect, it } from 'vitest';
import { loadAvailablePacks } from '../content/loadPacks';
import type { Skill } from '../learning/types';
import { createE2EDependencies } from './createE2EDependencies';

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>();
  get length(): number { return this.#values.size; }
  clear(): void { this.#values.clear(); }
  getItem(key: string): string | null { return this.#values.get(key) ?? null; }
  key(index: number): string | null { return [...this.#values.keys()][index] ?? null; }
  removeItem(key: string): void { this.#values.delete(key); }
  setItem(key: string, value: string): void { this.#values.set(key, value); }
}

const fiveKinds: readonly Skill[] = [
  'locate_region',
  'identify_region',
  'associate_capital',
  'locate_place',
  'identify_place',
];

describe('createE2EDependencies', () => {
  it('plans the five requested question kinds in order through production generation', async () => {
    const dependencies = createE2EDependencies(new MemoryStorage());
    window.__GEOLEARN_E2E__.setQuestionKinds(fiveKinds);
    const loaded = await loadAvailablePacks(dependencies.contentSource);
    const pack = loaded.available.find(({ manifest }) => manifest.packId === 'us-states');
    expect(pack).toBeDefined();

    const planned = dependencies.planSession({
      pack: pack!,
      request: { mode: 'smart', packId: 'us-states' },
      learnerId: dependencies.learnerId,
      sessionId: dependencies.createId('session'),
      startedAt: dependencies.now(),
      masteryRecords: [],
      fragileKeys: [],
      retryDebts: [],
      random: dependencies.random,
    });

    expect(planned.questions.map(({ kind }) => kind)).toEqual(fiveKinds);
    expect(planned.questions.every(({ entityId }) => pack!.entities.some(({ id }) => id === entityId)))
      .toBe(true);
  });

  it('resets deterministic IDs, clock, progress, and control state', async () => {
    const dependencies = createE2EDependencies(new MemoryStorage());
    expect(dependencies.createId('session')).toBe('session-1');
    expect(dependencies.createId('attempt')).toBe('attempt-2');
    expect(dependencies.now()).toBe('2026-09-01T00:00:00.000Z');
    await dependencies.repository.saveSettings({
      audio: { enabled: true, packId: 'soft', volume: 0.25 },
    });

    window.__GEOLEARN_E2E__.reset();

    expect(dependencies.createId('session')).toBe('session-1');
    expect(dependencies.now()).toBe('2026-09-01T00:00:00.000Z');
    expect(window.__GEOLEARN_E2E__.readState()).toMatchObject({
      attempts: [],
      sessions: [],
      updateActions: [],
    });
  });

  it('records download and install actions without native IPC', async () => {
    const dependencies = createE2EDependencies(new MemoryStorage());
    window.__GEOLEARN_E2E__.setUpdate({
      kind: 'available',
      currentVersion: '0.1.0-rc.1',
      version: '0.1.0',
    });
    const service = dependencies.createUpdateService();

    await service.check();
    await service.download();
    await service.install();

    expect(window.__GEOLEARN_E2E__.readState().updateActions).toEqual([
      'check',
      'download',
      'install',
      'close',
    ]);
    expect(service.getState()).toMatchObject({ status: 'installationRequested' });
  });
});

import type { AppSettings } from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession, RetryDebt } from '../practice/session';
import {
  InMemoryProgressRepository,
  type InMemoryProgressState,
} from '../persistence/InMemoryProgressRepository';
import type { ProgressRepository } from '../persistence/ProgressRepository';

const STORAGE_KEY = 'geolearn:e2e:progress:v1';

export class E2EProgressRepository implements ProgressRepository {
  #inner: InMemoryProgressRepository;
  #failNextAttempt = false;
  #failNextRefresh = false;

  constructor(private readonly storage: Storage) {
    const serialized = storage.getItem(STORAGE_KEY);
    if (serialized === null) {
      this.#inner = new InMemoryProgressRepository();
      return;
    }
    try {
      this.#inner = new InMemoryProgressRepository(
        JSON.parse(serialized) as InMemoryProgressState,
      );
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      throw new Error(`Persisted E2E progress is invalid${detail}`);
    }
  }

  failNextAttemptSave(): void {
    this.#failNextAttempt = true;
  }

  failNextRefresh(): void {
    this.#failNextRefresh = true;
  }

  exportState(): InMemoryProgressState {
    return this.#inner.exportState();
  }

  async replaceState(state: InMemoryProgressState): Promise<void> {
    const replacement = new InMemoryProgressRepository(state);
    this.storage.setItem(STORAGE_KEY, JSON.stringify(replacement.exportState()));
    this.#inner = replacement;
  }

  loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]> {
    if (this.#failNextRefresh) {
      this.#failNextRefresh = false;
      return Promise.reject(new Error('Injected E2E refresh failure'));
    }
    return this.#inner.loadSnapshot(learnerId, packId);
  }

  loadAttemptHistory(learnerId: string, packId: string): Promise<readonly AttemptEvent[]> {
    return this.#inner.loadAttemptHistory(learnerId, packId);
  }

  loadRetryDebts(learnerId: string, packId: string): Promise<readonly RetryDebt[]> {
    return this.#inner.loadRetryDebts(learnerId, packId);
  }

  async saveAttempt(
    input: Readonly<{
      event: AttemptEvent;
      session: PracticeSession;
      mastery: MasteryRecord;
    }>,
  ): Promise<void> {
    if (this.#failNextAttempt) {
      this.#failNextAttempt = false;
      throw new Error('Injected E2E attempt save failure');
    }
    await this.#inner.saveAttempt(input);
    this.#persist();
  }

  async saveSession(session: PracticeSession): Promise<void> {
    await this.#inner.saveSession(session);
    this.#persist();
  }

  loadResumableSession(
    learnerId: string,
    packId: string,
    now: string,
  ): Promise<PracticeSession | null> {
    return this.#inner.loadResumableSession(learnerId, packId, now);
  }

  loadSettings(): Promise<AppSettings> {
    return this.#inner.loadSettings();
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.#inner.saveSettings(settings);
    this.#persist();
  }

  reset(): void {
    this.#inner = new InMemoryProgressRepository();
    this.#failNextAttempt = false;
    this.#failNextRefresh = false;
    this.storage.removeItem(STORAGE_KEY);
  }

  #persist(): void {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(this.#inner.exportState()));
  }
}

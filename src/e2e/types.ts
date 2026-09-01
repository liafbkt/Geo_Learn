import type { BackupRecords } from '../persistence/backup';
import type { InMemoryProgressState } from '../persistence/InMemoryProgressRepository';
import type { Skill } from '../learning/types';

export type E2EUpdateScenario =
  | Readonly<{ kind: 'up-to-date' }>
  | Readonly<{ kind: 'error' }>
  | Readonly<{
      kind: 'available';
      currentVersion: string;
      version: string;
      notes?: string | null;
      date?: string | null;
    }>;

export type E2EBackupControlScenario =
  | Readonly<{ kind: 'cancel' }>
  | Readonly<{ kind: 'corrupt' }>
  | Readonly<{ kind: 'valid'; records: BackupRecords; failRefreshOnce?: boolean }>;

export type E2EControlState = InMemoryProgressState &
  Readonly<{ updateActions: readonly ('check' | 'download' | 'install' | 'close')[] }>;

export interface E2EControl {
  reset(): void;
  failNextAttemptSave(): void;
  setQuestionKinds(kinds: readonly Skill[]): void;
  setBackupScenario(scenario: E2EBackupControlScenario): void;
  setUpdate(scenario: E2EUpdateScenario): void;
  readState(): E2EControlState;
}

declare global {
  interface Window {
    __GEOLEARN_E2E__: E2EControl;
  }
}

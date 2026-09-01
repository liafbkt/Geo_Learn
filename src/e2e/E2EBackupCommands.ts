import type {
  BackupCommands,
  BackupImportInput,
  BackupSummary,
} from '../app/DataManagementScreen';
import {
  mergeBackupRecords,
  type BackupRecords,
} from '../persistence/backup';
import type { InMemoryProgressState } from '../persistence/InMemoryProgressRepository';
import { E2EProgressRepository } from './E2EProgressRepository';

export type E2EBackupScenario =
  | Readonly<{ kind: 'cancel' }>
  | Readonly<{ kind: 'corrupt' }>
  | Readonly<{ kind: 'valid'; records: BackupRecords }>;

type StagedBackup = Readonly<{ id: string; records: BackupRecords }>;

function toBackupRecords(state: InMemoryProgressState, savedAt: string): BackupRecords {
  return {
    mastery: state.mastery,
    attempts: state.attempts,
    sessions: state.sessions.map((session) => ({ session, savedAt })),
    settings: state.settings,
  };
}

function toProgressState(records: BackupRecords): InMemoryProgressState {
  return {
    mastery: records.mastery,
    attempts: records.attempts,
    sessions: records.sessions.map(({ session }) => session),
    settings: records.settings,
  };
}

export class E2EBackupCommands implements BackupCommands {
  #scenario: E2EBackupScenario = { kind: 'cancel' };
  #staged: StagedBackup | null = null;
  #nextStagingId = 1;

  constructor(
    private readonly repository: E2EProgressRepository,
    private readonly now: () => string,
    private readonly learnerId = 'local-default',
  ) {}

  setScenario(scenario: E2EBackupScenario): void {
    this.#scenario = structuredClone(scenario);
    this.#staged = null;
  }

  async exportBackup(learnerId: string): Promise<string | null> {
    if (learnerId !== this.learnerId) throw new Error('Backup learner is invalid');
    return '空间记忆教练备份.geolearn-backup';
  }

  async inspectBackup(): Promise<BackupSummary | null> {
    this.#staged = null;
    if (this.#scenario.kind === 'cancel') return null;
    if (this.#scenario.kind === 'corrupt') throw new Error('Corrupt E2E backup rejected');

    const records = structuredClone(this.#scenario.records);
    const stagingId = `stage-${this.#nextStagingId++}`;
    this.#staged = { id: stagingId, records };
    return {
      stagingId,
      exportedAt: this.now(),
      learnerId: this.learnerId,
      packVersions: {},
      masteryCount: records.mastery.length,
      attemptCount: records.attempts.length,
      sessionCount: records.sessions.length,
      includesSettings: true,
    };
  }

  async importBackup(input: BackupImportInput): Promise<void> {
    const staged = this.#staged;
    if (staged === null || input.stagingId !== staged.id) {
      throw new Error('Backup staging expired');
    }
    this.#staged = null;

    const imported = structuredClone(staged.records);
    const output = input.mode === 'merge'
      ? mergeBackupRecords(
          toBackupRecords(this.repository.exportState(), this.now()),
          imported,
          { includeSettings: input.includeSettings },
        )
      : imported;
    await this.repository.replaceState(toProgressState(output));
  }
}

import type { AppSettings } from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';

export type BackupManifest = Readonly<{
  format: 'geolearn-backup';
  version: 1;
  exportedAt: string;
  learnerId: string;
  packVersions: Readonly<Record<string, string>>;
}>;

export type BackupArchiveManifest = Readonly<
  BackupManifest & {
    checksums: Readonly<{
      'progress.json': string;
      'sessions.json': string;
      'settings.json': string;
    }>;
  }
>;

/** `savedAt` is the SQLite `practice_session.updated_at` value. */
export type BackupSessionRecord = Readonly<{
  session: PracticeSession;
  savedAt: string;
}>;

export type BackupRecords = Readonly<{
  mastery: readonly MasteryRecord[];
  attempts: readonly AttemptEvent[];
  sessions: readonly BackupSessionRecord[];
  settings: AppSettings;
}>;

export class BackupMergeError extends Error {
  readonly code: 'attempt_conflict';

  constructor(code: 'attempt_conflict', message: string) {
    super(message);
    this.name = 'BackupMergeError';
    this.code = code;
  }
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => asciiCompare(left, right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function masteryKey(record: MasteryRecord | AttemptEvent): string {
  return [record.learnerId, record.packId, record.entityId, record.skill].join('\u0000');
}

function dedupeAttempts(attempts: readonly AttemptEvent[]): Map<string, AttemptEvent> {
  const output = new Map<string, AttemptEvent>();
  for (const attempt of attempts) {
    const existing = output.get(attempt.attemptId);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(attempt)) {
      throw new BackupMergeError('attempt_conflict', 'Backup attempts conflict.');
    }
    output.set(attempt.attemptId, structuredClone(attempt));
  }
  return output;
}

function independentSuccessCounts(attempts: ReadonlyMap<string, AttemptEvent>): Map<string, number> {
  const output = new Map<string, number>();
  for (const attempt of attempts.values()) {
    if (attempt.correct && attempt.independentCorrect) {
      const key = masteryKey(attempt);
      output.set(key, (output.get(key) ?? 0) + 1);
    }
  }
  return output;
}

type MasteryCandidate = Readonly<{ record: MasteryRecord; independentSuccesses: number }>;

function preferMastery(left: MasteryCandidate, right: MasteryCandidate): MasteryCandidate {
  const timestampOrder = asciiCompare(left.record.updatedAt, right.record.updatedAt);
  if (timestampOrder !== 0) {
    return timestampOrder > 0 ? left : right;
  }
  if (left.independentSuccesses !== right.independentSuccesses) {
    return left.independentSuccesses > right.independentSuccesses ? left : right;
  }
  // A canonical-JSON minimum is an order-independent final tie-break.
  return asciiCompare(canonicalJson(left.record), canonicalJson(right.record)) <= 0 ? left : right;
}

function mergeMastery(
  current: BackupRecords,
  imported: BackupRecords,
  currentCounts: ReadonlyMap<string, number>,
  importedCounts: ReadonlyMap<string, number>,
): MasteryRecord[] {
  const output = new Map<string, MasteryCandidate>();
  const add = (record: MasteryRecord, counts: ReadonlyMap<string, number>): void => {
    const key = masteryKey(record);
    const candidate = {
      record: structuredClone(record),
      independentSuccesses: counts.get(key) ?? 0,
    };
    const existing = output.get(key);
    output.set(key, existing === undefined ? candidate : preferMastery(existing, candidate));
  };
  current.mastery.forEach((record) => add(record, currentCounts));
  imported.mastery.forEach((record) => add(record, importedCounts));
  return [...output.values()]
    .map(({ record }) => record)
    .sort((left, right) => asciiCompare(masteryKey(left), masteryKey(right)));
}

function preferSession(left: BackupSessionRecord, right: BackupSessionRecord): BackupSessionRecord {
  const leftCursor = left.session.questionCursor;
  const rightCursor = right.session.questionCursor;
  if (leftCursor !== rightCursor) {
    return leftCursor > rightCursor ? left : right;
  }
  const leftIntroduction = left.session.introductionCursor;
  const rightIntroduction = right.session.introductionCursor;
  if (leftIntroduction !== rightIntroduction) {
    return leftIntroduction > rightIntroduction ? left : right;
  }
  const timestampOrder = asciiCompare(left.savedAt, right.savedAt);
  if (timestampOrder !== 0) {
    return timestampOrder > 0 ? left : right;
  }
  return asciiCompare(canonicalJson(left), canonicalJson(right)) <= 0 ? left : right;
}

function mergeSessions(
  current: readonly BackupSessionRecord[],
  imported: readonly BackupSessionRecord[],
): BackupSessionRecord[] {
  const output = new Map<string, BackupSessionRecord>();
  for (const item of [...current, ...imported]) {
    const candidate = structuredClone(item);
    const id = candidate.session.sessionId;
    const existing = output.get(id);
    output.set(id, existing === undefined ? candidate : preferSession(existing, candidate));
  }
  return [...output.values()].sort((left, right) =>
    asciiCompare(left.session.sessionId, right.session.sessionId),
  );
}

export function mergeBackupRecords(
  current: BackupRecords,
  imported: BackupRecords,
  options: Readonly<{ includeSettings: boolean }>,
): BackupRecords {
  const currentAttempts = dedupeAttempts(current.attempts);
  const importedAttempts = dedupeAttempts(imported.attempts);
  const attempts = new Map(currentAttempts);
  for (const [id, candidate] of importedAttempts) {
    const existing = attempts.get(id);
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(candidate)) {
      throw new BackupMergeError('attempt_conflict', 'Backup attempts conflict.');
    }
    attempts.set(id, candidate);
  }

  return {
    mastery: mergeMastery(
      current,
      imported,
      independentSuccessCounts(currentAttempts),
      independentSuccessCounts(importedAttempts),
    ),
    attempts: [...attempts.values()].sort((left, right) =>
      asciiCompare(left.attemptId, right.attemptId),
    ),
    sessions: mergeSessions(current.sessions, imported.sessions),
    settings: structuredClone(options.includeSettings ? imported.settings : current.settings),
  };
}

export function serializeBackupRecords(records: BackupRecords): string {
  return canonicalJson(records);
}

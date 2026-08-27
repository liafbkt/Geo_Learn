import type { ContentPack } from './types';

export type ContentMasteryRecord = Readonly<{
  packId: string;
  entityId: string;
  capability: string;
  stage: string;
  successCount: number;
  [key: string]: unknown;
}>;

export type ContentMigrationOperation = Readonly<{
  kind: 'rename' | 'boundary-update' | 'split' | 'merge' | 'level-change';
  from: readonly string[];
  to: readonly string[];
}>;

export type ContentMigrationInput = Readonly<{
  oldManifest: ContentPack['manifest'];
  newManifest: ContentPack['manifest'];
  oldEntityIds: readonly string[];
  newEntityIds: readonly string[];
  mastery: readonly ContentMasteryRecord[];
  ledger: readonly ContentMigrationOperation[];
}>;

export type ContentMigrationResult =
  | Readonly<{ ok: true; records: readonly ContentMasteryRecord[] }>
  | Readonly<{
      ok: false;
      code: 'undeclared_id_change';
      changedEntityIds: readonly string[];
    }>;

function undeclaredChangedIds(
  oldIds: readonly string[],
  newIds: readonly string[],
  ledger: readonly ContentMigrationOperation[],
): string[] {
  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);
  const removedWithoutOperation = oldIds.filter(
    (id) => !newSet.has(id) && !ledger.some((operation) => operation.from.includes(id)),
  );
  const addedWithoutOperation = newIds.filter(
    (id) => !oldSet.has(id) && !ledger.some((operation) => operation.to.includes(id)),
  );
  return [...new Set([...removedWithoutOperation, ...addedWithoutOperation])].sort();
}

function resetRecord(record: ContentMasteryRecord, entityId: string): ContentMasteryRecord {
  const { status, ...withoutStatus } = record;
  void status;
  return { ...withoutStatus, entityId, stage: 'new', successCount: 0 };
}

export function migrateContentProgress(input: ContentMigrationInput): ContentMigrationResult {
  const undeclared = undeclaredChangedIds(input.oldEntityIds, input.newEntityIds, input.ledger);
  if (undeclared.length > 0) {
    return { ok: false, code: 'undeclared_id_change', changedEntityIds: undeclared };
  }

  const records: ContentMasteryRecord[] = [];
  input.mastery.forEach((record) => {
    const operations = input.ledger.filter((operation) => operation.from.includes(record.entityId));
    const destructive = operations.find(
      (operation) =>
        operation.kind === 'split' || operation.kind === 'merge' || operation.kind === 'level-change',
    );
    if (destructive !== undefined) {
      records.push({ ...record, status: 'archived' });
      destructive.to.forEach((entityId) => records.push(resetRecord(record, entityId)));
      return;
    }

    const rename = operations.find((operation) => operation.kind === 'rename');
    const renamedEntityId = rename?.to[0];
    if (renamedEntityId !== undefined) {
      records.push({ ...record, entityId: renamedEntityId });
      return;
    }
    records.push({ ...record });
  });

  return { ok: true, records };
}

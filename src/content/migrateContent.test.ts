import { describe, expect, it } from 'vitest';
import { minimalPack } from './fixtures/minimal-pack';
import { migrateContentProgress, type ContentMasteryRecord } from './migrateContent';
import type { ContentPack } from './types';

const mastery: ContentMasteryRecord = {
  packId: 'fixture-pack',
  entityId: 'region-a',
  capability: 'identify_region',
  stage: 'familiar',
  successCount: 3,
};

const manifest = minimalPack.manifest as unknown as ContentPack['manifest'];

describe('migrateContentProgress', () => {
  it('preserves mastery when stable IDs survive a rename and boundary-only update', () => {
    const result = migrateContentProgress({
      oldManifest: manifest,
      newManifest: {
        ...manifest,
        contentVersion: '1.1.0',
        title: { zh: '更新后的名称', en: 'Updated name' },
      },
      oldEntityIds: ['region-a'],
      newEntityIds: ['region-a'],
      mastery: [mastery],
      ledger: [{ kind: 'rename', from: ['region-a'], to: ['region-a'] }],
    });

    expect(result).toEqual({ ok: true, records: [mastery] });
  });

  it('preserves mastery for a boundary-only update with an unchanged stable ID', () => {
    const result = migrateContentProgress({
      oldManifest: manifest,
      newManifest: { ...manifest, contentVersion: '1.1.0' },
      oldEntityIds: ['region-a'],
      newEntityIds: ['region-a'],
      mastery: [mastery],
      ledger: [{ kind: 'boundary-update', from: ['region-a'], to: ['region-a'] }],
    });

    expect(result).toEqual({ ok: true, records: [mastery] });
  });

  it('archives source mastery and creates new records for split replacement IDs', () => {
    const result = migrateContentProgress({
      oldManifest: manifest,
      newManifest: { ...manifest, contentVersion: '2.0.0' },
      oldEntityIds: ['region-a'],
      newEntityIds: ['region-a-north', 'region-a-south'],
      mastery: [mastery],
      ledger: [{ kind: 'split', from: ['region-a'], to: ['region-a-north', 'region-a-south'] }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toEqual([
        { ...mastery, entityId: 'region-a', status: 'archived' },
        { ...mastery, entityId: 'region-a-north', stage: 'new', successCount: 0 },
        { ...mastery, entityId: 'region-a-south', stage: 'new', successCount: 0 },
      ]);
    }
  });

  it('rejects changed entity IDs that have no declared migration operation', () => {
    const result = migrateContentProgress({
      oldManifest: manifest,
      newManifest: { ...manifest, contentVersion: '2.0.0' },
      oldEntityIds: ['region-a'],
      newEntityIds: ['region-b'],
      mastery: [mastery],
      ledger: [],
    });

    expect(result).toEqual({
      ok: false,
      code: 'undeclared_id_change',
      changedEntityIds: ['region-a', 'region-b'],
    });
  });

  it('rejects a ledger that reverses the old and replacement entity IDs', () => {
    const result = migrateContentProgress({
      oldManifest: manifest,
      newManifest: { ...manifest, contentVersion: '2.0.0' },
      oldEntityIds: ['region-a'],
      newEntityIds: ['region-b'],
      mastery: [mastery],
      ledger: [{ kind: 'rename', from: ['region-b'], to: ['region-a'] }],
    });

    expect(result).toEqual({
      ok: false,
      code: 'undeclared_id_change',
      changedEntityIds: ['region-a', 'region-b'],
    });
  });

  it('archives old records for a level change even when the replacement keeps the same ID', () => {
    const result = migrateContentProgress({
      oldManifest: manifest,
      newManifest: { ...manifest, contentVersion: '2.0.0' },
      oldEntityIds: ['region-a'],
      newEntityIds: ['region-a'],
      mastery: [mastery],
      ledger: [{ kind: 'level-change', from: ['region-a'], to: ['region-a'] }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.records).toEqual([
        { ...mastery, status: 'archived' },
        { ...mastery, stage: 'new', successCount: 0 },
      ]);
    }
  });
});

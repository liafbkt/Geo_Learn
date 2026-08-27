import { describe, expect, it } from 'vitest';
import { minimalPack } from './fixtures/minimal-pack';
import { validatePack } from './validatePack';

type IssueCode =
  | 'schema'
  | 'duplicate_id'
  | 'missing_reference'
  | 'count_mismatch'
  | 'missing_geometry';

function expectIssue(input: unknown, code: IssueCode): void {
  const result = validatePack(input);

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error(`Expected validation issue ${code}, but pack was accepted.`);
  }

  expect(result).not.toHaveProperty('pack');
  expect(result.issues).toContainEqual(expect.objectContaining({ code }));
}

describe('validatePack', () => {
  it('accepts a pack with a region, its capital, and matching geometry', () => {
    const result = validatePack(minimalPack);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.manifest.packId).toBe('fixture-pack');
      expect(result.pack.entities).toHaveLength(2);
    }
  });

  it('rejects duplicate entity IDs so entity-targeted progress remains unambiguous', () => {
    expectIssue(
      {
        ...minimalPack,
        entities: minimalPack.entities.map((entity, index) =>
          index === 1 ? { ...entity, id: 'region-a' } : entity,
        ),
      },
      'duplicate_id',
    );
  });

  it('rejects a capital reference that does not name an entity', () => {
    expectIssue(
      {
        ...minimalPack,
        entities: minimalPack.entities.map((entity, index) =>
          index === 0 ? { ...entity, capitalId: 'missing-city' } : entity,
        ),
      },
      'missing_reference',
    );
  });

  it('rejects a manifest count that differs from the loaded entity kinds', () => {
    expectIssue(
      {
        ...minimalPack,
        manifest: {
          ...minimalPack.manifest,
          expectedEntityCounts: { region: 2, place: 1 },
        },
      },
      'count_mismatch',
    );
  });

  it('rejects an unsupported schema version before a pack reaches the learner', () => {
    expectIssue(
      {
        ...minimalPack,
        manifest: { ...minimalPack.manifest, schemaVersion: 2 },
      },
      'schema',
    );
  });

  it('rejects an entity without its English learning name', () => {
    expectIssue(
      {
        ...minimalPack,
        entities: minimalPack.entities.map((entity, index) =>
          index === 0 ? { ...entity, names: { zh: entity.names.zh } } : entity,
        ),
      },
      'schema',
    );
  });

  it('rejects a region whose geometry object is absent', () => {
    expectIssue(
      { ...minimalPack, topologyObjectIds: [] },
      'missing_geometry',
    );
  });
});

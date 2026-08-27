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

  it('accepts a TopoJSON point coordinate summary keyed by point ID', () => {
    const result = validatePack({
      ...minimalPack,
      topologyPoints: [{ id: 'city-a', coordinate: [121.47, 31.23] }],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pack.topologyPoints).toEqual([{ id: 'city-a', coordinate: [121.47, 31.23] }]);
    }
  });

  it('rejects extra fields in a TopoJSON point coordinate summary', () => {
    expectIssue(
      {
        ...minimalPack,
        topologyPoints: [{ id: 'city-a', coordinate: [121.47, 31.23], extra: true }],
      },
      'schema',
    );
  });

  it('rejects a place whose parent is another place', () => {
    expectIssue(
      {
        ...minimalPack,
        manifest: {
          ...minimalPack.manifest,
          expectedEntityCounts: { region: 1, place: 2 },
        },
        entities: [
          ...minimalPack.entities,
          {
            id: 'city-b',
            kind: 'place',
            names: { zh: '乙城', en: 'City B' },
            aliases: [],
            coordinate: [121.48, 31.24],
          },
        ].map((entity) => (entity.id === 'city-a' ? { ...entity, parentId: 'city-b' } : entity)),
      },
      'missing_reference',
    );
  });

  it('rejects an entity that names itself as its parent', () => {
    expectIssue(
      {
        ...minimalPack,
        entities: minimalPack.entities.map((entity) =>
          entity.id === 'city-a' ? { ...entity, parentId: 'city-a' } : entity,
        ),
      },
      'missing_reference',
    );
  });
});

import { describe, expect, it } from 'vitest';

import type { ContentPack, Entity, PackCapability } from '../content/types';
import { generateQuestion } from './questions';

const capabilities = [
  'locate_region',
  'identify_region',
  'associate_capital',
  'locate_place',
  'identify_place',
] as const satisfies readonly PackCapability[];

function region(id: string, capitalId?: string): Entity {
  return {
    id,
    kind: 'region',
    names: { zh: `${id}区`, en: `${id} Region` },
    aliases: [`${id} alias`],
    ...(capitalId === undefined ? {} : { capitalId }),
  };
}

function place(id: string, longitude: number): Entity {
  return {
    id,
    kind: 'place',
    names: { zh: `${id}城`, en: `${id} City` },
    aliases: [`${id}-alias`],
    coordinate: [longitude, 30],
  };
}

function makePack(overrides: Partial<ContentPack> = {}): ContentPack {
  const entities: readonly Entity[] = [
    region('r1', 'p1'),
    region('r2', 'p2'),
    region('r3', 'p3'),
    region('r4', 'p4'),
    region('r5', 'p5'),
    place('p1', 101),
    place('p2', 102),
    place('p3', 103),
    place('p4', 104),
    place('p5', 105),
  ];
  const pack: ContentPack = {
    manifest: {
      schemaVersion: 1,
      contentVersion: '1.0.0',
      packId: 'questions-pack',
      title: { zh: '题目包', en: 'Question Pack' },
      primaryAnswerLanguage: 'zh',
      expectedEntityCounts: { region: 5, place: 5 },
      capabilities,
      defaultViewport: { center: [103, 30], scale: 1000 },
      distributionStatus: 'development-only',
      checksums: { entities: 'a', topology: 'b', sources: 'c' },
    },
    entities,
    topologyObjectIds: ['r1', 'r2', 'r3', 'r4', 'r5'],
    topologyPoints: [
      { id: 'p1', coordinate: [101, 30] },
      { id: 'p2', coordinate: [102, 30] },
      { id: 'p3', coordinate: [103, 30] },
      { id: 'p4', coordinate: [104, 30] },
      { id: 'p5', coordinate: [105, 30] },
    ],
    sources: [],
  };

  return { ...pack, ...overrides };
}

describe('generateQuestion', () => {
  const pack = makePack();

  it('builds locate_region as a map question without choices', () => {
    expect(generateQuestion({ pack, entityId: 'r1', skill: 'locate_region', stage: 'new' })).toEqual({
      kind: 'locate_region',
      presentation: 'map',
      entityId: 'r1',
    });
  });

  it('builds locate_place with the authoritative topology coordinate', () => {
    const withDifferentEntityCoordinate = makePack({
      entities: pack.entities.map((entity) =>
        entity.id === 'p1' && entity.kind === 'place'
          ? { ...entity, coordinate: [0, 0] }
          : entity,
      ),
    });

    expect(
      generateQuestion({
        pack: withDifferentEntityCoordinate,
        entityId: 'p1',
        skill: 'locate_place',
        stage: 'mastered',
      }),
    ).toEqual({
      kind: 'locate_place',
      presentation: 'map',
      entityId: 'p1',
      coordinate: [101, 30],
    });
  });

  it.each(['new', 'learning'] as const)(
    'uses exactly four ordered choices for identify_region at %s stage',
    (stage) => {
      expect(
        generateQuestion({
          pack,
          entityId: 'r1',
          skill: 'identify_region',
          stage,
          candidateOrder: ['r3', 'r1', 'r5', 'r2', 'r4'],
        }),
      ).toEqual({
        kind: 'identify_region',
        presentation: 'choice',
        entityId: 'r1',
        candidateEntityIds: ['r3', 'r1', 'r5', 'r2'],
      });
    },
  );

  it.each(['weak', 'familiar', 'solid', 'mastered'] as const)(
    'uses bilingual text answers for identify_region at %s stage',
    (stage) => {
      expect(
        generateQuestion({ pack, entityId: 'r1', skill: 'identify_region', stage }),
      ).toEqual({
        kind: 'identify_region',
        presentation: 'text',
        entityId: 'r1',
        answerSpec: { acceptedDisplayValues: ['r1区', 'r1 Region', 'r1 alias'] },
      });
    },
  );

  it('builds associate_capital choice questions from valid capital places', () => {
    expect(
      generateQuestion({
        pack,
        entityId: 'r1',
        skill: 'associate_capital',
        stage: 'learning',
        candidateOrder: ['p4', 'p1', 'p5', 'p2', 'p3'],
      }),
    ).toEqual({
      kind: 'associate_capital',
      presentation: 'choice',
      entityId: 'r1',
      capitalId: 'p1',
      candidateEntityIds: ['p4', 'p1', 'p5', 'p2'],
    });
  });

  it('builds associate_capital text questions from the capital names and aliases', () => {
    expect(
      generateQuestion({
        pack,
        entityId: 'r1',
        skill: 'associate_capital',
        stage: 'weak',
      }),
    ).toEqual({
      kind: 'associate_capital',
      presentation: 'text',
      entityId: 'r1',
      capitalId: 'p1',
      answerSpec: { acceptedDisplayValues: ['p1城', 'p1 City', 'p1-alias'] },
    });
  });

  it('builds identify_place choice and text union branches', () => {
    expect(
      generateQuestion({
        pack,
        entityId: 'p1',
        skill: 'identify_place',
        stage: 'new',
        candidateOrder: ['p2', 'p3', 'p1', 'p4', 'p5'],
      }),
    ).toEqual({
      kind: 'identify_place',
      presentation: 'choice',
      entityId: 'p1',
      candidateEntityIds: ['p2', 'p3', 'p1', 'p4'],
    });
    expect(
      generateQuestion({ pack, entityId: 'p1', skill: 'identify_place', stage: 'solid' }),
    ).toEqual({
      kind: 'identify_place',
      presentation: 'text',
      entityId: 'p1',
      answerSpec: { acceptedDisplayValues: ['p1城', 'p1 City', 'p1-alias'] },
    });
  });

  it('is deterministic for identical explicit candidate ordering', () => {
    const input = {
      pack,
      entityId: 'r1',
      skill: 'identify_region' as const,
      stage: 'new' as const,
      candidateOrder: ['r4', 'r1', 'r3', 'r2', 'r5'],
    };

    expect(generateQuestion(input)).toEqual(generateQuestion(input));
  });

  it.each([
    {
      name: 'a capability absent from the pack',
      input: {
        pack: makePack({ manifest: { ...pack.manifest, capabilities: ['locate_region'] } }),
        entityId: 'r1',
        skill: 'identify_region' as const,
        stage: 'weak' as const,
      },
      message: /capability/i,
    },
    {
      name: 'a capability absent from the entity override',
      input: {
        pack: makePack({
          entities: pack.entities.map((entity) =>
            entity.id === 'r1' ? { ...entity, capabilities: ['locate_region'] } : entity,
          ),
        }),
        entityId: 'r1',
        skill: 'identify_region' as const,
        stage: 'weak' as const,
      },
      message: /capability/i,
    },
    {
      name: 'a missing region geometry',
      input: {
        pack: makePack({ topologyObjectIds: ['r2', 'r3', 'r4', 'r5'] }),
        entityId: 'r1',
        skill: 'locate_region' as const,
        stage: 'new' as const,
      },
      message: /geometry/i,
    },
    {
      name: 'a missing authoritative place point',
      input: {
        pack: makePack({ topologyPoints: pack.topologyPoints.filter((point) => point.id !== 'p1') }),
        entityId: 'p1',
        skill: 'locate_place' as const,
        stage: 'new' as const,
      },
      message: /geometry/i,
    },
    {
      name: 'a missing capital relationship',
      input: {
        pack: makePack({ entities: [region('r1'), ...pack.entities.filter((e) => e.id !== 'r1')] }),
        entityId: 'r1',
        skill: 'associate_capital' as const,
        stage: 'weak' as const,
      },
      message: /capital/i,
    },
    {
      name: 'a dangling capital relationship',
      input: {
        pack: makePack({
          entities: [region('r1', 'missing'), ...pack.entities.filter((e) => e.id !== 'r1')],
        }),
        entityId: 'r1',
        skill: 'associate_capital' as const,
        stage: 'weak' as const,
      },
      message: /capital/i,
    },
    {
      name: 'fewer than three valid distractors',
      input: {
        pack,
        entityId: 'r1',
        skill: 'identify_region' as const,
        stage: 'new' as const,
        candidateOrder: ['r1', 'r2', 'r3'],
      },
      message: /four valid choices/i,
    },
    {
      name: 'candidate ordering that omits the correct answer',
      input: {
        pack,
        entityId: 'p1',
        skill: 'identify_place' as const,
        stage: 'new' as const,
        candidateOrder: ['p2', 'p3', 'p4', 'p5'],
      },
      message: /correct answer/i,
    },
  ])('refuses $name', ({ input, message }) => {
    expect(() => generateQuestion(input)).toThrow(message);
  });

  it('refuses a wrong entity kind for a skill', () => {
    expect(() =>
      generateQuestion({ pack, entityId: 'p1', skill: 'identify_region', stage: 'weak' }),
    ).toThrow(/region/i);
  });
});

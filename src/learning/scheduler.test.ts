import { describe, expect, it } from 'vitest';

import type {
  ContentPack,
  PackCapability,
  PlaceEntity,
  RegionEntity,
} from '../content/types';
import type { RetryDebt } from '../practice/session';
import { schedulePlacement, scheduleSmartSession, type RandomSource } from './scheduler';
import type { MasteryRecord, Skill } from './types';

const skills = [
  'locate_region',
  'identify_region',
  'associate_capital',
  'locate_place',
  'identify_place',
] as const satisfies readonly PackCapability[];

function region(id: string, capitalId: string): RegionEntity {
  return {
    id,
    kind: 'region',
    names: { zh: `${id}区`, en: `${id} Region` },
    aliases: [`${id}-alias`],
    capitalId,
  };
}

function place(id: string, longitude: number): PlaceEntity {
  return {
    id,
    kind: 'place',
    names: { zh: `${id}城`, en: `${id} City` },
    aliases: [`${id}-alias`],
    coordinate: [longitude, 30],
  };
}

function makePack(pairCount = 12): ContentPack {
  const regions = Array.from({ length: pairCount }, (_, index) =>
    region(`r${index + 1}`, `p${index + 1}`),
  );
  const places = Array.from({ length: pairCount }, (_, index) =>
    place(`p${index + 1}`, 100 + index),
  );
  return {
    manifest: {
      schemaVersion: 1,
      contentVersion: '1.0.0',
      packId: 'scheduler-pack',
      title: { zh: '调度测试包', en: 'Scheduler test pack' },
      primaryAnswerLanguage: 'zh',
      expectedEntityCounts: { region: pairCount, place: pairCount },
      capabilities: skills,
      defaultViewport: { center: [105, 30], scale: 900 },
      distributionStatus: 'development-only',
      checksums: { entities: 'a', topology: 'b', sources: 'c' },
    },
    entities: [...regions, ...places],
    topologyObjectIds: regions.map(({ id }) => id),
    topologyPoints: places.map((entity) => ({ id: entity.id, coordinate: entity.coordinate })),
    sources: [],
  };
}

function mastery(
  entityId: string,
  skill: Skill,
  stage: MasteryRecord['stage'],
  dueAt: string,
): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'scheduler-pack',
    entityId,
    skill,
    stage,
    scheduledIntervalMs: 86_400_000,
    dueAt,
    smoothedResponseMs: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

function sequenceRandom(values: readonly number[]): RandomSource {
  let cursor = 0;
  return {
    next: () => values[cursor++ % values.length] ?? 0,
  };
}

function questionEntityId(question: { readonly entityId: string }): string {
  return question.entityId;
}

function normalRecords(): readonly MasteryRecord[] {
  return [
    mastery('r1', 'locate_region', 'familiar', '2026-08-20T00:00:00.000Z'),
    mastery('r2', 'identify_region', 'solid', '2026-08-21T00:00:00.000Z'),
    mastery('r3', 'associate_capital', 'weak', '2026-09-10T00:00:00.000Z'),
    mastery('p1', 'locate_place', 'weak', '2026-09-11T00:00:00.000Z'),
    mastery('p2', 'identify_place', 'familiar', '2026-09-12T00:00:00.000Z'),
    mastery('r4', 'locate_region', 'solid', '2026-09-13T00:00:00.000Z'),
    mastery('r5', 'identify_region', 'mastered', '2026-09-14T00:00:00.000Z'),
    mastery('p3', 'locate_place', 'familiar', '2026-09-15T00:00:00.000Z'),
    mastery('p4', 'identify_place', 'solid', '2026-09-16T00:00:00.000Z'),
    mastery('r6', 'associate_capital', 'mastered', '2026-09-17T00:00:00.000Z'),
  ];
}

describe('scheduleSmartSession', () => {
  it('builds 12 base questions with caps, four introductions, and queue priority', () => {
    const session = scheduleSmartSession({
      pack: makePack(),
      learnerId: 'learner-1',
      sessionId: 'session-1',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: normalRecords(),
      fragileKeys: ['p2|identify_place'],
      retryDebts: [
        {
          entityId: 'r7',
          skill: 'locate_region',
          sourceQuestionKind: 'locate_region',
          createdAt: '2026-08-26T00:00:00.000Z',
          priority: 'immediate',
        },
      ],
      random: sequenceRandom([0.2, 0.7, 0.4, 0.9]),
    });

    expect(session.baseQuestionCount).toBe(12);
    expect(session.questions).toHaveLength(12);
    expect(session.introductions).toHaveLength(4);
    expect(new Set(session.introductions).size).toBe(4);
    const previouslyKnown = new Set([...normalRecords().map(({ entityId }) => entityId), 'r7']);
    expect(
      session.questions
        .filter(({ entityId }) => !previouslyKnown.has(entityId))
        .every(({ entityId }) => session.introductions.includes(entityId)),
    ).toBe(true);
    expect(session.questions[0]).toMatchObject({ entityId: 'r7', kind: 'locate_region' });

    const dueLast = Math.max(
      ...['r1', 'r2'].map((id) => session.questions.findIndex((question) => question.entityId === id)),
    );
    const weakFirst = Math.min(
      ...['r3', 'p1'].map((id) => session.questions.findIndex((question) => question.entityId === id)),
    );
    expect(dueLast).toBeLessThan(weakFirst);

    const kindCounts = new Map<string, number>();
    for (const question of session.questions) {
      kindCounts.set(question.kind, (kindCounts.get(question.kind) ?? 0) + 1);
    }
    expect(Math.max(...kindCounts.values())).toBeLessThanOrEqual(6);
    expect(
      session.questions.filter((question) =>
        ['p2|identify_place'].includes(`${question.entityId}|${question.kind}`),
      ),
    ).toHaveLength(1);
    expect(session.request).toEqual({ mode: 'smart', packId: 'scheduler-pack' });
    expect(session.introductionCursor).toBe(0);
    expect(session.questionCursor).toBe(0);
    expect(session.accumulatedPauseMs).toBe(0);
  });

  it('enforces kind and fragile caps after every insertion', () => {
    const records = Array.from({ length: 14 }, (_, index) =>
      mastery(`r${index + 1}`, 'locate_region', 'familiar', '2026-08-20T00:00:00.000Z'),
    );
    const fragileKeys = records.map((record) => `${record.entityId}|${record.skill}`);
    const session = scheduleSmartSession({
      pack: makePack(16),
      learnerId: 'learner-1',
      sessionId: 'caps',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: records,
      fragileKeys,
      retryDebts: [],
      random: sequenceRandom([0.5]),
    });

    expect(session.questions.filter(({ kind }) => kind === 'locate_region').length).toBeLessThanOrEqual(6);
    expect(
      session.questions.filter((question) =>
        fragileKeys.includes(`${question.entityId}|${question.kind}`),
      ).length,
    ).toBeLessThanOrEqual(3);
  });

  it('is byte-for-byte deterministic and does not mutate inputs across 100 fixed sequences', () => {
    const pack = makePack();
    const records = normalRecords();
    const debts: readonly RetryDebt[] = [];
    const original = JSON.stringify({ pack, records, debts });
    const observedQuestionOrders = new Set<string>();

    for (let seed = 1; seed <= 100; seed += 1) {
      const values = Array.from({ length: 64 }, (_, index) => ((seed * 37 + index * 17) % 997) / 997);
      const input = {
        pack,
        learnerId: 'learner-1',
        sessionId: 'seeded-smart-session',
        startedAt: '2026-08-27T00:00:00.000Z',
        masteryRecords: records,
        fragileKeys: ['p2|identify_place'] as const,
        retryDebts: debts,
      };
      const first = scheduleSmartSession({ ...input, random: sequenceRandom(values) });
      const second = scheduleSmartSession({ ...input, random: sequenceRandom(values) });
      expect(first).toEqual(second);
      expect(first.baseQuestionCount).toBe(first.questions.length);
      expect(Math.max(...skills.map((skill) => first.questions.filter((q) => q.kind === skill).length))).toBeLessThanOrEqual(6);
      observedQuestionOrders.add(JSON.stringify(first.questions));
    }

    expect(observedQuestionOrders.size).toBeGreaterThan(1);
    expect(JSON.stringify({ pack, records, debts })).toBe(original);
  });

  it.each([Number.NaN, -0.01, 1, Number.POSITIVE_INFINITY])(
    'refuses invalid random value %s',
    (value) => {
      expect(() =>
        scheduleSmartSession({
          pack: makePack(),
          learnerId: 'learner-1',
          sessionId: 'invalid-random',
          startedAt: '2026-08-27T00:00:00.000Z',
          masteryRecords: normalRecords(),
          fragileKeys: [],
          retryDebts: [],
          random: { next: () => value },
        }),
      ).toThrow(/random/i);
    },
  );

  it('skips candidates refused by deterministic question generation instead of fabricating choices', () => {
    const sparsePack = makePack(3);
    const session = scheduleSmartSession({
      pack: sparsePack,
      learnerId: 'learner-1',
      sessionId: 'sparse',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: [],
      fragileKeys: [],
      retryDebts: [],
      random: sequenceRandom([0.4]),
    });

    expect(session.questions.every((question) => question.presentation === 'map')).toBe(true);
    expect(session.baseQuestionCount).toBe(6);
    expect(new Set(session.questions.map(({ entityId }) => entityId)).size).toBe(6);
  });

  it('schedules persisted new-stage records without re-introducing a known entity', () => {
    const records = [
      ...normalRecords(),
      mastery('r8', 'locate_region', 'new', '2026-08-27T00:00:00.000Z'),
    ];
    const session = scheduleSmartSession({
      pack: makePack(),
      learnerId: 'learner-1',
      sessionId: 'persisted-new',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: records,
      fragileKeys: [],
      retryDebts: [],
      random: sequenceRandom([0.2, 0.7, 0.4]),
    });

    expect(session.introductions).not.toContain('r8');
    expect(session.questions).toContainEqual({
      kind: 'locate_region',
      presentation: 'map',
      entityId: 'r8',
    });
  });

  it('preserves unschedulable retry debt for the next session', () => {
    const retryDebt: RetryDebt = {
      entityId: 'missing',
      skill: 'locate_region',
      sourceQuestionKind: 'locate_region',
      createdAt: '2026-08-26T00:00:00.000Z',
      priority: 'immediate',
    };
    const session = scheduleSmartSession({
      pack: makePack(),
      learnerId: 'learner-1',
      sessionId: 'carryover',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: normalRecords(),
      fragileKeys: [],
      retryDebts: [retryDebt],
      random: sequenceRandom([0.4]),
    });

    expect(session.carryoverRetryDebts).toEqual([retryDebt]);
    expect(session.carryoverRetryDebts[0]).toBe(retryDebt);
  });

  it('uses at most six introduced entities to fill an all-new 12-question session', () => {
    const session = scheduleSmartSession({
      pack: makePack(),
      learnerId: 'learner-1',
      sessionId: 'all-new',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: [],
      fragileKeys: [],
      retryDebts: [],
      random: sequenceRandom([0.12, 0.73, 0.41, 0.88]),
    });

    expect(session.baseQuestionCount).toBe(12);
    expect(session.introductions).toHaveLength(6);
    expect(new Set(session.introductions).size).toBe(6);
    expect(
      session.questions.every(({ entityId }) => session.introductions.includes(entityId)),
    ).toBe(true);
    expect(new Set(session.questions.map(({ entityId }) => entityId)).size).toBeLessThanOrEqual(6);
  });

  it('schedules a missing natural-key skill for a known entity without introducing it again', () => {
    const session = scheduleSmartSession({
      pack: makePack(1),
      learnerId: 'learner-1',
      sessionId: 'missing-pair',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: [
        mastery('r1', 'identify_region', 'weak', '2026-09-10T00:00:00.000Z'),
      ],
      fragileKeys: [],
      retryDebts: [],
      random: sequenceRandom([0.23, 0.61, 0.47]),
    });

    expect(session.questions).toContainEqual({
      kind: 'locate_region',
      presentation: 'map',
      entityId: 'r1',
    });
    expect(session.introductions).not.toContain('r1');
  });

  it('uses debt skill for scheduling while preserving a different source kind as metadata', () => {
    const retryDebt: RetryDebt = {
      entityId: 'r1',
      skill: 'locate_region',
      sourceQuestionKind: 'identify_region',
      createdAt: '2026-08-26T00:00:00.000Z',
      priority: 'immediate',
    };
    const session = scheduleSmartSession({
      pack: makePack(),
      learnerId: 'learner-1',
      sessionId: 'cross-kind-debt',
      startedAt: '2026-08-27T00:00:00.000Z',
      masteryRecords: [],
      fragileKeys: [],
      retryDebts: [retryDebt],
      random: sequenceRandom([0.19, 0.67, 0.38]),
    });

    expect(session.questions[0]).toEqual({
      kind: 'locate_region',
      presentation: 'map',
      entityId: 'r1',
    });
    expect(session.carryoverRetryDebts).toEqual([]);
    expect(session.introductions).not.toContain('r1');
  });
});

describe('schedulePlacement', () => {
  it('produces 12 hint-free questions with broad entity and skill coverage', () => {
    const session = schedulePlacement({
      pack: makePack(),
      learnerId: 'learner-1',
      sessionId: 'placement-1',
      startedAt: '2026-08-27T00:00:00.000Z',
      random: sequenceRandom([0.1, 0.8, 0.3, 0.6]),
    });

    expect(session.request).toEqual({ mode: 'placement', packId: 'scheduler-pack' });
    expect(session.baseQuestionCount).toBe(12);
    expect(session.questions).toHaveLength(12);
    expect(new Set(session.questions.map(questionEntityId)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(session.questions.map(({ kind }) => kind)).size).toBe(5);
    expect(session.introductions).toEqual([]);
    expect(session.carryoverRetryDebts).toEqual([]);
    for (const question of session.questions) {
      expect(question).not.toHaveProperty('hint');
    }
  });

  it('is deterministic for 100 fixed random sequences', () => {
    const pack = makePack();
    const observedQuestionOrders = new Set<string>();
    for (let seed = 1; seed <= 100; seed += 1) {
      const values = Array.from({ length: 64 }, (_, index) => ((seed * 53 + index * 29) % 991) / 991);
      const common = {
        pack,
        learnerId: 'learner-1',
        sessionId: 'seeded-placement-session',
        startedAt: '2026-08-27T00:00:00.000Z',
      };
      const first = schedulePlacement({ ...common, random: sequenceRandom(values) });
      const second = schedulePlacement({ ...common, random: sequenceRandom(values) });
      expect(first).toEqual(second);
      observedQuestionOrders.add(JSON.stringify(first.questions));
    }
    expect(observedQuestionOrders.size).toBeGreaterThan(1);
  });
});

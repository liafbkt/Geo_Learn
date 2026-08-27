import type { ContentPack, Entity } from '../content/types';
import type { PracticeSession, RetryDebt } from '../practice/session';
import { generateQuestion, type Question } from './questions';
import type { MasteryRecord, MasteryStage, Skill } from './types';

export interface RandomSource {
  next(): number;
}

export type SmartSessionInput = Readonly<{
  pack: ContentPack;
  learnerId: string;
  sessionId: string;
  startedAt: string;
  masteryRecords: readonly MasteryRecord[];
  fragileKeys: readonly string[];
  retryDebts: readonly RetryDebt[];
  random: RandomSource;
}>;

export type PlacementSessionInput = Readonly<{
  pack: ContentPack;
  learnerId: string;
  sessionId: string;
  startedAt: string;
  random: RandomSource;
}>;

type Candidate = Readonly<{
  entityId: string;
  skill: Skill;
  stage: MasteryStage;
  fragile: boolean;
}>;

type PreparedCandidate = Readonly<{
  candidate: Candidate;
  question: Question;
}>;

const SMART_BASE_COUNT = 12;
const SMART_KIND_CAP = 6;
const SMART_FRAGILE_CAP = 3;
const NORMAL_NEW_COUNT = 4;
const MAX_NEW_COUNT = 6;

/** Stable identity retained by every Question for presentation-time due checks. */
export function masteryKey(entityId: string, skill: Skill): string {
  return `${entityId}|${skill}`;
}

function takeRandom(random: RandomSource): number {
  const value = random.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('RandomSource.next() must return a finite value in [0, 1)');
  }
  return value;
}

function shuffled<T>(items: readonly T[], random: RandomSource): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(takeRandom(random) * (index + 1));
    const current = result[index];
    const swap = result[swapIndex];
    if (current === undefined || swap === undefined) {
      throw new Error('Unable to shuffle candidate inventory');
    }
    result[index] = swap;
    result[swapIndex] = current;
  }
  return result;
}

function entitySupports(entity: Entity, skill: Skill): boolean {
  return entity.capabilities === undefined || entity.capabilities.includes(skill);
}

function skillsForEntity(pack: ContentPack, entity: Entity): readonly Skill[] {
  return pack.manifest.capabilities.filter((skill) => {
    if (!entitySupports(entity, skill)) {
      return false;
    }
    if (entity.kind === 'region') {
      if (skill === 'locate_region' || skill === 'identify_region') {
        return pack.topologyObjectIds.includes(entity.id);
      }
      if (skill === 'associate_capital') {
        return (
          entity.capitalId !== undefined &&
          pack.entities.some((candidate) => candidate.id === entity.capitalId && candidate.kind === 'place')
        );
      }
      return false;
    }
    return skill === 'locate_place' || skill === 'identify_place';
  });
}

function candidateOrder(pack: ContentPack, candidate: Candidate, random: RandomSource): readonly string[] | undefined {
  if (candidate.stage !== 'new' && candidate.stage !== 'learning') {
    return undefined;
  }
  if (candidate.skill === 'identify_region') {
    return shuffled(
      pack.entities
        .filter((entity) => entity.kind === 'region' && entitySupports(entity, candidate.skill))
        .filter((entity) => pack.topologyObjectIds.includes(entity.id))
        .map(({ id }) => id),
      random,
    );
  }
  if (candidate.skill === 'identify_place') {
    return shuffled(
      pack.entities
        .filter((entity) => entity.kind === 'place' && entitySupports(entity, candidate.skill))
        .map(({ id }) => id),
      random,
    );
  }
  if (candidate.skill === 'associate_capital') {
    return shuffled(
      pack.entities.flatMap((entity) =>
        entity.kind === 'region' &&
        entitySupports(entity, candidate.skill) &&
        entity.capitalId !== undefined &&
        pack.entities.some((possible) => possible.id === entity.capitalId && possible.kind === 'place')
          ? [entity.capitalId]
          : [],
      ),
      random,
    );
  }
  return undefined;
}

function prepareCandidate(
  pack: ContentPack,
  candidate: Candidate,
  random: RandomSource,
): PreparedCandidate | null {
  const order = candidateOrder(pack, candidate, random);
  try {
    return {
      candidate,
      question: generateQuestion({
        pack,
        entityId: candidate.entityId,
        skill: candidate.skill,
        stage: candidate.stage,
        ...(order === undefined ? {} : { candidateOrder: order }),
      }),
    };
  } catch {
    return null;
  }
}

function prepareQueue(
  pack: ContentPack,
  candidates: readonly Candidate[],
  random: RandomSource,
): PreparedCandidate[] {
  return shuffled(candidates, random).flatMap((candidate) => {
    const prepared = prepareCandidate(pack, candidate, random);
    return prepared === null ? [] : [prepared];
  });
}

function emptySession(
  input: Pick<SmartSessionInput, 'learnerId' | 'sessionId' | 'startedAt'>,
  request: PracticeSession['request'],
): PracticeSession {
  return {
    sessionId: input.sessionId,
    learnerId: input.learnerId,
    request,
    baseQuestionCount: 0,
    introductions: [],
    introductionCursor: 0,
    questions: [],
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: input.startedAt,
    accumulatedPauseMs: 0,
  };
}

function recordCandidate(record: MasteryRecord, fragile: boolean): Candidate {
  return {
    entityId: record.entityId,
    skill: record.skill,
    stage: record.stage,
    fragile,
  };
}

export function scheduleSmartSession(input: SmartSessionInput): PracticeSession {
  const now = Date.parse(input.startedAt);
  if (!Number.isFinite(now)) {
    throw new Error('Session start time must be a valid ISO timestamp');
  }

  const relevantRecords = input.masteryRecords.filter(
    (record) =>
      record.learnerId === input.learnerId && record.packId === input.pack.manifest.packId,
  );
  const recordsByKey = new Map(
    relevantRecords.map((record) => [masteryKey(record.entityId, record.skill), record] as const),
  );
  const fragile = new Set(input.fragileKeys);

  const retryCandidates: Candidate[] = input.retryDebts.flatMap((debt) => {
    const record = recordsByKey.get(masteryKey(debt.entityId, debt.skill));
    return [{
      entityId: debt.entityId,
      skill: debt.skill,
      stage: record?.stage ?? 'weak',
      fragile: fragile.has(masteryKey(debt.entityId, debt.skill)),
    }];
  });
  const due: Candidate[] = [];
  const weak: Candidate[] = [];
  const fragileQueue: Candidate[] = [];
  const maintenance: Candidate[] = [];
  const persistedNew: Candidate[] = [];
  for (const record of relevantRecords) {
    const key = masteryKey(record.entityId, record.skill);
    const candidate = recordCandidate(record, fragile.has(key));
    if (record.stage === 'new') {
      persistedNew.push(candidate);
    } else if (Date.parse(record.dueAt) <= now) {
      due.push(candidate);
    } else if (record.stage === 'weak') {
      weak.push(candidate);
    } else if (candidate.fragile) {
      fragileQueue.push(candidate);
    } else {
      maintenance.push(candidate);
    }
  }

  const knownEntities = new Set([
    ...relevantRecords.map(({ entityId }) => entityId),
    ...input.retryDebts.map(({ entityId }) => entityId),
  ]);
  const missingPairs = input.pack.entities.flatMap((entity) =>
    skillsForEntity(input.pack, entity).flatMap((skill) =>
      recordsByKey.has(masteryKey(entity.id, skill))
        ? []
        : [{
            entityId: entity.id,
            skill,
            stage: 'new' as const,
            fragile: false,
          }],
    ),
  );
  const knownNewCandidates = [
    ...persistedNew,
    ...missingPairs.filter(({ entityId }) => knownEntities.has(entityId)),
  ];
  const unknownCandidatesByEntity = new Map<string, Candidate[]>();
  for (const candidate of missingPairs) {
    if (knownEntities.has(candidate.entityId)) {
      continue;
    }
    const existing = unknownCandidatesByEntity.get(candidate.entityId) ?? [];
    unknownCandidatesByEntity.set(candidate.entityId, [...existing, candidate]);
  }
  const unknownNewGroups = shuffled(
    [...unknownCandidatesByEntity.values()],
    input.random,
  ).map((group) => shuffled(group, input.random));

  const priorityQueues = [retryCandidates, due, weak, fragileQueue].map((queue) =>
    prepareQueue(input.pack, queue, input.random),
  );
  const preparedKnownNew = prepareQueue(input.pack, knownNewCandidates, input.random);
  const preparedUnknownGroups = unknownNewGroups.flatMap((group) => {
    const prepared = group.flatMap((candidate) => {
      const result = prepareCandidate(input.pack, candidate, input.random);
      return result === null ? [] : [result];
    });
    return prepared.length === 0 ? [] : [prepared];
  });
  const preparedMaintenance = prepareQueue(input.pack, maintenance, input.random);
  const selected: PreparedCandidate[] = [];
  const selectedKeys = new Set<string>();
  const kindCounts = new Map<Question['kind'], number>();
  let fragileCount = 0;

  const tryAdd = (prepared: PreparedCandidate): boolean => {
    if (selected.length >= SMART_BASE_COUNT) {
      return false;
    }
    const key = masteryKey(prepared.candidate.entityId, prepared.candidate.skill);
    if (selectedKeys.has(key)) {
      return false;
    }
    if ((kindCounts.get(prepared.question.kind) ?? 0) >= SMART_KIND_CAP) {
      return false;
    }
    if (prepared.candidate.fragile && fragileCount >= SMART_FRAGILE_CAP) {
      return false;
    }
    selected.push(prepared);
    selectedKeys.add(key);
    kindCounts.set(prepared.question.kind, (kindCounts.get(prepared.question.kind) ?? 0) + 1);
    if (prepared.candidate.fragile) {
      fragileCount += 1;
    }
    return true;
  };

  const reviewKeys = new Set(
    [...priorityQueues.flat(), ...preparedMaintenance].map(({ candidate }) =>
      masteryKey(candidate.entityId, candidate.skill),
    ),
  );
  const desiredIntroductions = Math.min(
    MAX_NEW_COUNT,
    Math.max(NORMAL_NEW_COUNT, SMART_BASE_COUNT - reviewKeys.size),
  );
  const introductionTarget = Math.min(desiredIntroductions, preparedUnknownGroups.length);
  const preNewLimit = SMART_BASE_COUNT - introductionTarget;
  for (const queue of priorityQueues) {
    for (const candidate of queue) {
      if (selected.length >= preNewLimit) {
        break;
      }
      tryAdd(candidate);
    }
  }

  const introduced: string[] = [];
  const introducedGroups: PreparedCandidate[][] = [];
  for (const group of preparedUnknownGroups) {
    if (introduced.length >= introductionTarget) {
      break;
    }
    for (const candidate of group) {
      if (tryAdd(candidate)) {
        introduced.push(candidate.candidate.entityId);
        introducedGroups.push(group);
        break;
      }
    }
  }

  for (const queue of [
    ...priorityQueues,
    preparedKnownNew,
    ...introducedGroups,
    preparedMaintenance,
  ]) {
    for (const candidate of queue) {
      tryAdd(candidate);
    }
  }

  const questions = selected.map(({ question }) => question);
  const scheduledRetryCounts = new Map<string, number>();
  for (const selectedCandidate of selected) {
    const key = masteryKey(selectedCandidate.candidate.entityId, selectedCandidate.candidate.skill);
    if (retryCandidates.some((candidate) => masteryKey(candidate.entityId, candidate.skill) === key)) {
      scheduledRetryCounts.set(key, (scheduledRetryCounts.get(key) ?? 0) + 1);
    }
  }
  const carryoverRetryDebts = input.retryDebts.filter((debt) => {
    const key = masteryKey(debt.entityId, debt.skill);
    const remaining = scheduledRetryCounts.get(key) ?? 0;
    if (remaining === 0) {
      return true;
    }
    scheduledRetryCounts.set(key, remaining - 1);
    return false;
  });
  return {
    ...emptySession(input, { mode: 'smart', packId: input.pack.manifest.packId }),
    baseQuestionCount: questions.length,
    introductions: introduced,
    questions,
    carryoverRetryDebts,
  };
}

export function schedulePlacement(input: PlacementSessionInput): PracticeSession {
  const candidates = shuffled(
    input.pack.entities.flatMap((entity) =>
      skillsForEntity(input.pack, entity).map((skill) => ({
        entityId: entity.id,
        skill,
        stage: 'weak' as const,
        fragile: false,
      })),
    ),
    input.random,
  );
  const remaining = [...candidates];
  const selected: Candidate[] = [];
  const usedEntities = new Set<string>();
  const usedSkills = new Set<Skill>();

  while (remaining.length > 0 && selected.length < SMART_BASE_COUNT) {
    let bestIndex = 0;
    let bestScore = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (candidate === undefined) {
        continue;
      }
      const score = (usedEntities.has(candidate.entityId) ? 0 : 2) + (usedSkills.has(candidate.skill) ? 0 : 1);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }
    const [candidate] = remaining.splice(bestIndex, 1);
    if (candidate !== undefined) {
      selected.push(candidate);
      usedEntities.add(candidate.entityId);
      usedSkills.add(candidate.skill);
    }
  }

  const questions = selected.flatMap((candidate) => {
    const prepared = prepareCandidate(input.pack, candidate, input.random);
    return prepared === null ? [] : [prepared.question];
  });
  return {
    ...emptySession(input, { mode: 'placement', packId: input.pack.manifest.packId }),
    baseQuestionCount: questions.length,
    questions,
  };
}

import type { Question } from '../learning/questions';
import type { MasteryStage, Skill } from '../learning/types';
import type { RandomSource } from '../learning/scheduler';

export type SessionRequest =
  | Readonly<{ mode: 'smart'; packId: string }>
  | Readonly<{ mode: 'placement'; packId: string }>
  | Readonly<{
      mode: 'custom';
      packId: string;
      questionCount: number;
      entityIds: readonly [string, ...string[]];
      skills: readonly [Skill, ...Skill[]];
      statuses: readonly (MasteryStage | 'fragile')[];
    }>;

export type RetryDebt = Readonly<{
  entityId: string;
  skill: Skill;
  sourceQuestionKind: Question['kind'];
  createdAt: string;
  priority: 'immediate';
}>;

export type PracticeSession = Readonly<{
  sessionId: string;
  learnerId: string;
  request: SessionRequest;
  baseQuestionCount: number;
  introductions: readonly string[];
  introductionCursor: number;
  questions: readonly Question[];
  questionCursor: number;
  carryoverRetryDebts: readonly RetryDebt[];
  startedAt: string;
  accumulatedPauseMs: number;
}>;

export function validateSessionRequest(request: SessionRequest): SessionRequest {
  if (request.mode !== 'custom') {
    return request;
  }
  if (
    !Number.isInteger(request.questionCount) ||
    request.questionCount < 1 ||
    request.questionCount > 50
  ) {
    throw new Error('Custom question count must be an integer from 1 to 50');
  }
  if (request.entityIds.length === 0 || request.skills.length === 0) {
    throw new Error('Custom entity and skill tuples must be non-empty');
  }
  return request;
}

function randomIndex(random: RandomSource, length: number): number {
  const value = random.next();
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('RandomSource.next() must return a finite value in [0, 1)');
  }
  return Math.floor(value * length);
}

export function insertDelayedRetry(input: Readonly<{
  session: PracticeSession;
  revealedQuestionIndex: number;
  variation: Question;
  debt: RetryDebt;
  random: RandomSource;
}>): PracticeSession {
  const { session, revealedQuestionIndex, variation, debt, random } = input;
  if (!Number.isInteger(revealedQuestionIndex) || revealedQuestionIndex < 0) {
    throw new Error('Revealed question index must be a non-negative integer');
  }

  if (session.questions.length >= 15) {
    return {
      ...session,
      carryoverRetryDebts: [...session.carryoverRetryDebts, debt],
    };
  }

  const legalGaps = [3, 4, 5].filter(
    (gap) => revealedQuestionIndex + gap + 1 <= session.questions.length,
  );
  if (legalGaps.length === 0) {
    return {
      ...session,
      carryoverRetryDebts: [...session.carryoverRetryDebts, debt],
    };
  }

  const gap = legalGaps[randomIndex(random, legalGaps.length)];
  if (gap === undefined) {
    throw new Error('Unable to choose a delayed retry gap');
  }
  const insertionIndex = revealedQuestionIndex + gap + 1;
  return {
    ...session,
    questions: [
      ...session.questions.slice(0, insertionIndex),
      variation,
      ...session.questions.slice(insertionIndex),
    ],
  };
}

import type { PackCapability } from '../content/types';

export type Skill = PackCapability;
export type MasteryStage = 'new' | 'learning' | 'weak' | 'familiar' | 'solid' | 'mastered';
export type QuestionKind = Skill;
export type PracticeMode = 'smart' | 'custom' | 'placement';

export type MasteryRecord = Readonly<{
  learnerId: string;
  packId: string;
  entityId: string;
  skill: Skill;
  stage: MasteryStage;
  scheduledIntervalMs: number;
  dueAt: string;
  smoothedResponseMs: number | null;
  updatedAt: string;
}>;

type AttemptOutcomeFields = Readonly<{
  correct: boolean;
  usedHint: boolean;
  answerAttemptCount: 1 | 2;
  responseMs: number;
}>;

export type AttemptOutcome =
  | Readonly<AttemptOutcomeFields & { mode: 'placement'; independentCorrect: false }>
  | Readonly<AttemptOutcomeFields & { mode: Exclude<PracticeMode, 'placement'>; independentCorrect: boolean }>;

type AttemptEventFields = Readonly<{
  attemptId: string;
  sessionId: string;
  learnerId: string;
  packId: string;
  entityId: string;
  skill: Skill;
  questionKind: QuestionKind;
  scheduledReview: boolean;
  delayedRetry: boolean;
  answerAttemptCount: 1 | 2;
  correct: boolean;
  usedHint: boolean;
  responseMs: number;
  completedAt: string;
}>;

export type AttemptEvent =
  | Readonly<AttemptEventFields & { mode: 'placement'; independentCorrect: false }>
  | Readonly<AttemptEventFields & { mode: Exclude<PracticeMode, 'placement'>; independentCorrect: boolean }>;

import type { PackCapability } from '../content/types';

export type Skill = PackCapability;
export type MasteryStage = 'new' | 'learning' | 'weak' | 'familiar' | 'solid' | 'mastered';
export type QuestionKind = 'map' | 'multiple_choice' | 'text_input';
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

export type AttemptOutcome = Readonly<{
  mode: PracticeMode;
  correct: boolean;
  independentCorrect: boolean;
  usedHint: boolean;
  answerAttemptCount: number;
  responseMs: number;
}>;

export type AttemptEvent = Readonly<{
  attemptId: string;
  sessionId: string;
  learnerId: string;
  packId: string;
  entityId: string;
  skill: Skill;
  questionKind: QuestionKind;
  mode: PracticeMode;
  scheduledReview: boolean;
  delayedRetry: boolean;
  answerAttemptCount: number;
  correct: boolean;
  independentCorrect: boolean;
  usedHint: boolean;
  responseMs: number;
  completedAt: string;
}>;

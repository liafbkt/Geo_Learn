import type { Coordinate } from '../content/types';
import { buildHint, type Hint, type HintRequest } from '../learning/hints';
import { isAcceptedAnswer } from '../learning/normalizeAnswer';
import type { Question } from '../learning/questions';
import type { AttemptEvent, AttemptOutcome, MasteryRecord } from '../learning/types';
import { updateMastery } from '../learning/updateMastery';
import type { PracticeAction } from './actions';
import {
  insertDelayedRetry,
  type PracticeSession,
  type RetryDebt,
} from './session';

export type PracticePhase =
  | 'presenting'
  | 'answering'
  | 'first_retry'
  | 'revealed'
  | 'completed';

export type PracticeFeedback =
  | Readonly<{ kind: 'correct'; revealAnswer: true }>
  | Readonly<{
      kind: 'incorrect';
      revealAnswer: false;
      submittedAnswer: string;
    }>
  | Readonly<{ kind: 'revealed'; revealAnswer: true }>;

export type PendingAttempt = Readonly<{
  event: AttemptEvent;
  session: PracticeSession;
  mastery: MasteryRecord;
}>;

export type MapCoordinate = Readonly<{
  entityId: string;
  coordinate: Coordinate;
}>;

export type CreatePracticeStateInput = Readonly<{
  session: PracticeSession;
  masteryRecords: readonly MasteryRecord[];
  presentedAt: string;
  retryVariations?: readonly Question[];
  retryRandomValue?: number;
  mapCoordinates?: readonly MapCoordinate[];
  delayedRetryQuestionIndexes?: readonly number[];
}>;

export type PracticeState = Readonly<{
  phase: PracticePhase;
  session: PracticeSession;
  currentQuestion: Question;
  masteryRecords: readonly MasteryRecord[];
  answerValue: string | null;
  usedHint: boolean;
  hint: Hint | null;
  feedback: PracticeFeedback | null;
  saveStatus: 'idle' | 'saving' | 'failed' | 'saved';
  saveErrorCode: string | null;
  pendingAttempt: PendingAttempt | null;
  questionPresentedAt: string;
  questionPauseMs: number;
  pausedAt: string | null;
  scheduledReview: boolean;
  retryVariations: readonly Question[];
  retryRandomValue: number;
  mapCoordinates: readonly MapCoordinate[];
  delayedRetryQuestionIndexes: readonly number[];
}>;

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return parsed;
}

function currentQuestion(session: PracticeSession): Question {
  const result = session.questions[session.questionCursor];
  if (result === undefined) {
    throw new Error('Practice session has no current question');
  }
  return result;
}

function matchingMastery(
  records: readonly MasteryRecord[],
  session: PracticeSession,
  question: Question,
): MasteryRecord {
  const result = records.find(
    (record) =>
      record.learnerId === session.learnerId &&
      record.packId === session.request.packId &&
      record.entityId === question.entityId &&
      record.skill === question.kind,
  );
  if (result === undefined) {
    throw new Error(`Missing mastery for ${question.entityId}:${question.kind}`);
  }
  return result;
}

function reviewWasScheduled(record: MasteryRecord, presentedAt: string): boolean {
  return timestamp(record.dueAt, 'Mastery due time') <= timestamp(presentedAt, 'Presentation time');
}

function sameQuestion(left: Question, right: Question): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inferredRetryIndexes(
  session: PracticeSession,
  retryVariations: readonly Question[],
): readonly number[] {
  return session.questions.flatMap((item, index) =>
    retryVariations.some((variation) => sameQuestion(item, variation)) ? [index] : [],
  );
}

export function createPracticeState(input: CreatePracticeStateInput): PracticeState {
  const retryRandomValue = input.retryRandomValue ?? 0;
  if (!Number.isFinite(retryRandomValue) || retryRandomValue < 0 || retryRandomValue >= 1) {
    throw new Error('Retry random value must be finite and in [0, 1)');
  }
  const question = currentQuestion(input.session);
  const record = matchingMastery(input.masteryRecords, input.session, question);
  const retryVariations = input.retryVariations ?? [];
  timestamp(input.presentedAt, 'Presentation time');

  return {
    phase: 'presenting',
    session: input.session,
    currentQuestion: question,
    masteryRecords: input.masteryRecords,
    answerValue: null,
    usedHint: false,
    hint: null,
    feedback: null,
    saveStatus: 'idle',
    saveErrorCode: null,
    pendingAttempt: null,
    questionPresentedAt: input.presentedAt,
    questionPauseMs: 0,
    pausedAt: null,
    scheduledReview: reviewWasScheduled(record, input.presentedAt),
    retryVariations,
    retryRandomValue,
    mapCoordinates: input.mapCoordinates ?? [],
    delayedRetryQuestionIndexes:
      input.delayedRetryQuestionIndexes ?? inferredRetryIndexes(input.session, retryVariations),
  };
}

function canAnswer(state: PracticeState): boolean {
  return (
    state.pausedAt === null &&
    (state.phase === 'answering' || state.phase === 'first_retry')
  );
}

function correctEntityId(question: Question): string {
  return question.kind === 'associate_capital' ? question.capitalId : question.entityId;
}

function answerIsCorrect(question: Question, answer: string): boolean {
  return question.presentation === 'text'
    ? isAcceptedAnswer(answer, question.answer)
    : answer === correctEntityId(question);
}

function coordinateFor(state: PracticeState, entityId: string): Coordinate | undefined {
  return state.mapCoordinates.find((item) => item.entityId === entityId)?.coordinate;
}

function hintRequest(state: PracticeState): HintRequest | null {
  const question = state.currentQuestion;
  if (question.presentation === 'choice') {
    return {
      kind: 'choice',
      correctEntityId: correctEntityId(question),
      candidateOrder: question.candidateEntityIds,
    };
  }
  if (question.presentation === 'text') {
    const acceptedDisplayValue = question.answer.acceptedDisplayValues[0];
    if (acceptedDisplayValue === undefined) {
      throw new Error('Text question requires an accepted display value');
    }
    return { kind: 'text', acceptedDisplayValue };
  }

  if (state.answerValue === null) {
    return null;
  }
  const selectedCoordinate = coordinateFor(state, state.answerValue);
  const targetCoordinate =
    question.kind === 'locate_place'
      ? question.coordinate
      : coordinateFor(state, question.entityId);
  if (selectedCoordinate === undefined || targetCoordinate === undefined) {
    throw new Error('Map hint coordinates are unavailable');
  }
  return { kind: 'map', selectedCoordinate, targetCoordinate };
}

function hintFor(state: PracticeState): Hint | null {
  const request = hintRequest(state);
  return request === null ? null : buildHint(request);
}

function updatedMasteryRecords(
  records: readonly MasteryRecord[],
  updated: MasteryRecord,
): readonly MasteryRecord[] {
  return records.map((record) =>
    record.learnerId === updated.learnerId &&
    record.packId === updated.packId &&
    record.entityId === updated.entityId &&
    record.skill === updated.skill
      ? updated
      : record,
  );
}

function retryVariation(state: PracticeState): Question {
  return (
    state.retryVariations.find(
      (variation) =>
        variation.entityId === state.currentQuestion.entityId &&
        variation.kind === state.currentQuestion.kind,
    ) ?? state.currentQuestion
  );
}

function insertedQuestionIndex(
  before: readonly Question[],
  after: readonly Question[],
  inserted: Question,
): number {
  let existingOccurrences = before.filter((question) => question === inserted).length;
  for (const [index, question] of after.entries()) {
    if (question !== inserted) {
      continue;
    }
    if (existingOccurrences === 0) {
      return index;
    }
    existingOccurrences -= 1;
  }
  return -1;
}

function withDelayedRetry(
  state: PracticeState,
  session: PracticeSession,
  now: string,
): Readonly<{ session: PracticeSession; delayedRetryQuestionIndexes: readonly number[] }> {
  const variation = retryVariation(state);
  const debt: RetryDebt = {
    entityId: state.currentQuestion.entityId,
    skill: state.currentQuestion.kind,
    sourceQuestionKind: state.currentQuestion.kind,
    createdAt: now,
    priority: 'immediate',
  };
  const result = insertDelayedRetry({
    session,
    revealedQuestionIndex: state.session.questionCursor,
    variation,
    debt,
    random: { next: () => state.retryRandomValue },
  });
  if (result.questions.length === session.questions.length) {
    return { session: result, delayedRetryQuestionIndexes: state.delayedRetryQuestionIndexes };
  }

  const insertionIndex = insertedQuestionIndex(session.questions, result.questions, variation);
  if (insertionIndex < 0) {
    throw new Error('Inserted retry question is missing');
  }
  return {
    session: result,
    delayedRetryQuestionIndexes: [
      ...state.delayedRetryQuestionIndexes.map((index) =>
        index >= insertionIndex ? index + 1 : index,
      ),
      insertionIndex,
    ].sort((left, right) => left - right),
  };
}

function outcomeFor(
  state: PracticeState,
  correct: boolean,
  answerAttemptCount: 1 | 2,
  responseMs: number,
): AttemptOutcome {
  const common = {
    correct,
    usedHint: state.usedHint,
    answerAttemptCount,
    responseMs,
  } as const;
  if (state.session.request.mode === 'placement') {
    return { ...common, mode: 'placement', independentCorrect: false };
  }
  return {
    ...common,
    mode: state.session.request.mode,
    independentCorrect: correct && !state.usedHint && answerAttemptCount === 1,
  };
}

function eventFor(
  state: PracticeState,
  outcome: AttemptOutcome,
  now: string,
): AttemptEvent {
  const common = {
    attemptId: `${state.session.sessionId}:${state.session.questionCursor}`,
    sessionId: state.session.sessionId,
    learnerId: state.session.learnerId,
    packId: state.session.request.packId,
    entityId: state.currentQuestion.entityId,
    skill: state.currentQuestion.kind,
    questionKind: state.currentQuestion.kind,
    scheduledReview: state.scheduledReview,
    delayedRetry: state.delayedRetryQuestionIndexes.includes(state.session.questionCursor),
    answerAttemptCount: outcome.answerAttemptCount,
    correct: outcome.correct,
    usedHint: outcome.usedHint,
    responseMs: outcome.responseMs,
    completedAt: new Date(timestamp(now, 'Completion time')).toISOString(),
  } as const;
  return outcome.mode === 'placement'
    ? { ...common, mode: 'placement', independentCorrect: false }
    : {
        ...common,
        mode: outcome.mode,
        independentCorrect: outcome.independentCorrect,
      };
}

function completeAnswer(
  state: PracticeState,
  correct: boolean,
  answerAttemptCount: 1 | 2,
  now: string,
): PracticeState {
  const responseMs = Math.max(
    0,
    timestamp(now, 'Completion time') -
      timestamp(state.questionPresentedAt, 'Presentation time') -
      state.questionPauseMs,
  );
  const outcome = outcomeFor(state, correct, answerAttemptCount, responseMs);
  const record = matchingMastery(state.masteryRecords, state.session, state.currentQuestion);
  const mastery = updateMastery(record, outcome, now);
  let advancedSession: PracticeSession = {
    ...state.session,
    questionCursor: state.session.questionCursor + 1,
  };
  let delayedRetryQuestionIndexes = state.delayedRetryQuestionIndexes;
  if (
    state.session.request.mode !== 'placement' &&
    (!correct || state.usedHint || answerAttemptCount === 2)
  ) {
    const scheduled = withDelayedRetry(state, advancedSession, now);
    advancedSession = scheduled.session;
    delayedRetryQuestionIndexes = scheduled.delayedRetryQuestionIndexes;
  }
  const event = eventFor(state, outcome, now);
  const pendingAttempt: PendingAttempt = {
    event,
    session: advancedSession,
    mastery,
  };

  return {
    ...state,
    phase: correct ? 'completed' : 'revealed',
    session: advancedSession,
    masteryRecords: updatedMasteryRecords(state.masteryRecords, mastery),
    feedback: correct
      ? { kind: 'correct', revealAnswer: true }
      : { kind: 'revealed', revealAnswer: true },
    saveStatus: 'saving',
    saveErrorCode: null,
    pendingAttempt,
    pausedAt: null,
    delayedRetryQuestionIndexes,
  };
}

function resume(state: PracticeState, now: string): PracticeState {
  if (state.pausedAt === null) {
    return state;
  }
  const duration = timestamp(now, 'Resume time') - timestamp(state.pausedAt, 'Pause time');
  if (duration < 0) {
    throw new Error('Resume time cannot precede pause time');
  }
  return {
    ...state,
    session: {
      ...state.session,
      accumulatedPauseMs: state.session.accumulatedPauseMs + duration,
    },
    questionPauseMs: state.questionPauseMs + duration,
    pausedAt: null,
  };
}

function continueToNextQuestion(state: PracticeState): PracticeState {
  if (state.pendingAttempt === null || state.saveStatus !== 'saved') {
    return state;
  }
  if (state.session.questionCursor >= state.session.questions.length) {
    return state;
  }
  const question = currentQuestion(state.session);
  const record = matchingMastery(state.masteryRecords, state.session, question);
  const presentedAt = state.pendingAttempt.event.completedAt;
  return {
    ...state,
    phase: 'presenting',
    currentQuestion: question,
    answerValue: null,
    usedHint: false,
    hint: null,
    feedback: null,
    saveStatus: 'idle',
    saveErrorCode: null,
    pendingAttempt: null,
    questionPresentedAt: presentedAt,
    questionPauseMs: 0,
    pausedAt: null,
    scheduledReview: reviewWasScheduled(record, presentedAt),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled practice action: ${JSON.stringify(value)}`);
}

export function practiceReducer(state: PracticeState, action: PracticeAction): PracticeState {
  switch (action.type) {
    case 'INTRO_CONTINUED': {
      if (state.phase !== 'presenting') {
        return state;
      }
      const introductionCursor = Math.min(
        state.session.introductions.length,
        state.session.introductionCursor + 1,
      );
      return {
        ...state,
        phase:
          introductionCursor < state.session.introductions.length ? 'presenting' : 'answering',
        session: {
          ...state.session,
          introductionCursor,
        },
      };
    }
    case 'ANSWER_SELECTED':
      return canAnswer(state) && state.currentQuestion.presentation !== 'text'
        ? { ...state, answerValue: action.value }
        : state;
    case 'ANSWER_TYPED':
      return canAnswer(state) && state.currentQuestion.presentation === 'text'
        ? { ...state, answerValue: action.value }
        : state;
    case 'HINT_REQUESTED': {
      if (!canAnswer(state) || state.hint !== null) {
        return state;
      }
      const hint = hintFor(state);
      return hint === null ? state : { ...state, usedHint: true, hint };
    }
    case 'ANSWER_SUBMITTED': {
      if (
        !canAnswer(state) ||
        state.pausedAt !== null ||
        state.answerValue === null ||
        state.answerValue.trim().length === 0
      ) {
        return state;
      }
      const correct = answerIsCorrect(state.currentQuestion, state.answerValue);
      if (!correct && state.phase === 'answering') {
        const hintedState = state.hint === null
          ? { ...state, usedHint: true, hint: hintFor(state) }
          : state;
        if (hintedState.hint === null) {
          throw new Error('First retry requires a hint');
        }
        return {
          ...hintedState,
          phase: 'first_retry',
          answerValue: null,
          feedback: {
            kind: 'incorrect',
            revealAnswer: false,
            submittedAnswer: state.answerValue,
          },
        };
      }
      return completeAnswer(state, correct, state.phase === 'first_retry' ? 2 : 1, action.now);
    }
    case 'ATTEMPT_SAVED':
      if (
        state.pendingAttempt === null ||
        state.pendingAttempt.event.attemptId !== action.attemptId ||
        (state.saveStatus !== 'saving' && state.saveStatus !== 'failed')
      ) {
        return state;
      }
      return { ...state, saveStatus: 'saved', saveErrorCode: null };
    case 'ATTEMPT_SAVE_FAILED':
      return state.pendingAttempt !== null && state.saveStatus === 'saving'
        ? { ...state, saveStatus: 'failed', saveErrorCode: action.code }
        : state;
    case 'CONTINUED':
      return continueToNextQuestion(state);
    case 'PAUSED':
      if (state.pausedAt !== null || state.pendingAttempt !== null) {
        return state;
      }
      timestamp(action.now, 'Pause time');
      return { ...state, pausedAt: action.now };
    case 'RESUMED':
      return resume(state, action.now);
    default:
      return assertNever(action);
  }
}

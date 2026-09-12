import { describe, expect, it } from 'vitest';

import type { Coordinate } from '../content/types';
import type { Question } from '../learning/questions';
import type { MasteryRecord } from '../learning/types';
import { InMemoryProgressRepository } from '../persistence/InMemoryProgressRepository';
import type { ProgressRepository } from '../persistence/ProgressRepository';
import type { PracticeSession } from './session';
import { commitCurrentAttempt, type PracticeAction } from './actions';
import {
  createPracticeState,
  practiceReducer,
  type PracticeState,
} from './reducer';
import {
  canContinue,
  canLeavePractice,
  canRetrySave,
  canSkipQuestion,
  canSubmitAnswer,
} from './selectors';

const STARTED_AT = '2026-08-28T00:00:00.000Z';
const CORRECT_AT = '2026-08-28T00:00:10.000Z';

function question(index: number): Question {
  return {
    kind: 'identify_region',
    presentation: 'choice',
    entityId: `r${index}`,
    candidateEntityIds: [`r${index}`, `wrong-${index}-a`, `wrong-${index}-b`, `wrong-${index}-c`],
  };
}

function mastery(index: number, overrides: Partial<MasteryRecord> = {}): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'pack-1',
    entityId: `r${index}`,
    skill: 'identify_region',
    stage: 'learning',
    scheduledIntervalMs: 600_000,
    dueAt: '2026-08-27T00:00:00.000Z',
    smoothedResponseMs: null,
    updatedAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}

function session(questionCount = 12, cursor = 0): PracticeSession {
  return {
    sessionId: 'session-1',
    learnerId: 'learner-1',
    request: { mode: 'smart', packId: 'pack-1' },
    baseQuestionCount: Math.min(questionCount, 12),
    introductions: [],
    introductionCursor: 0,
    questions: Array.from({ length: questionCount }, (_, index) => question(index + 1)),
    questionCursor: cursor,
    carryoverRetryDebts: [],
    startedAt: STARTED_AT,
    accumulatedPauseMs: 0,
  };
}

function makeState(
  overrides: Partial<Parameters<typeof createPracticeState>[0]> = {},
): PracticeState {
  const currentSession = overrides.session ?? session();
  return createPracticeState({
    session: currentSession,
    masteryRecords: currentSession.questions.map((item, index) =>
      mastery(index + 1, { entityId: item.entityId, skill: item.kind }),
    ),
    presentedAt: STARTED_AT,
    retryVariations: [
      {
        kind: 'identify_region',
        presentation: 'text',
        entityId: 'r1',
        answer: { acceptedDisplayValues: ['一区'] },
      },
    ],
    retryRandomValue: 0,
    mapCoordinates: [],
    delayedRetryQuestionIndexes: [],
    ...overrides,
  });
}

function startAnswering(state = makeState()): PracticeState {
  return practiceReducer(state, { type: 'INTRO_CONTINUED', now: STARTED_AT });
}

function selectAndSubmit(state: PracticeState, value: string, now = CORRECT_AT): PracticeState {
  return practiceReducer(
    practiceReducer(state, { type: 'ANSWER_SELECTED', value }),
    { type: 'ANSWER_SUBMITTED', now },
  );
}

function save(state: PracticeState): PracticeState {
  const attemptId = state.pendingAttempt?.event.attemptId;
  if (attemptId === undefined) {
    throw new Error('Expected a pending attempt');
  }
  return practiceReducer(state, { type: 'ATTEMPT_SAVED', attemptId });
}

describe('practiceReducer', () => {
  it('runs presenting → answering → completed and gates navigation until atomic save succeeds', () => {
    const presenting = makeState();
    const answering = practiceReducer(presenting, { type: 'INTRO_CONTINUED', now: STARTED_AT });
    const completed = selectAndSubmit(answering, 'r1');

    expect(answering.phase).toBe('answering');
    expect(completed).toMatchObject({
      phase: 'completed',
      feedback: { kind: 'correct', revealAnswer: true },
      saveStatus: 'saving',
    });
    expect(completed.pendingAttempt).toMatchObject({
      event: {
        attemptId: 'session-1:0',
        correct: true,
        independentCorrect: true,
        answerAttemptCount: 1,
        scheduledReview: true,
        responseMs: 10_000,
      },
      mastery: { stage: 'weak' },
      session: { questionCursor: 1 },
    });
    expect(canContinue(completed)).toBe(false);
    expect(canLeavePractice(completed)).toBe(false);
    expect(canSkipQuestion(completed)).toBe(false);

    const saved = save(completed);
    expect(saved.saveStatus).toBe('saved');
    expect(canContinue(saved)).toBe(true);
    expect(canLeavePractice(saved)).toBe(true);
    expect(canSkipQuestion(saved)).toBe(true);
  });

  it('persists every introduction cursor before entering the answer phase', () => {
    const currentSession = {
      ...session(),
      introductions: ['r1', 'r2'],
    };
    const initial = makeState({ session: currentSession });

    const afterFirst = practiceReducer(initial, { type: 'INTRO_CONTINUED', now: STARTED_AT });
    expect(afterFirst.phase).toBe('presenting');
    expect(afterFirst.session.introductionCursor).toBe(1);

    const afterSecond = practiceReducer(afterFirst, { type: 'INTRO_CONTINUED', now: STARTED_AT });
    expect(afterSecond.phase).toBe('answering');
    expect(afterSecond.session.introductionCursor).toBe(2);
  });

  it('starts answer timing only after the final introduction is continued', () => {
    const currentSession = { ...session(), introductions: ['r1', 'r2'] };
    const initial = makeState({ session: currentSession });
    const afterFirst = practiceReducer(initial, {
      type: 'INTRO_CONTINUED',
      now: '2026-08-28T00:00:05.000Z',
    });
    const answering = practiceReducer(afterFirst, {
      type: 'INTRO_CONTINUED',
      now: '2026-08-28T00:00:10.000Z',
    });

    const completed = selectAndSubmit(answering, 'r1', '2026-08-28T00:00:15.000Z');

    expect(answering.questionPresentedAt).toBe('2026-08-28T00:00:10.000Z');
    expect(completed.pendingAttempt?.event.responseMs).toBe(5_000);
  });

  it('refuses submission without a non-empty selection or typed answer', () => {
    const choice = startAnswering();
    const textSession = session();
    const textQuestion: Question = {
      kind: 'identify_region',
      presentation: 'text',
      entityId: 'r1',
      answer: { acceptedDisplayValues: ['上海'] },
    };
    const typed = startAnswering(
      makeState({ session: { ...textSession, questions: [textQuestion, ...textSession.questions.slice(1)] } }),
    );

    expect(practiceReducer(choice, { type: 'ANSWER_SUBMITTED', now: CORRECT_AT })).toBe(choice);
    const blank = practiceReducer(typed, { type: 'ANSWER_TYPED', value: '   ' });
    expect(canSubmitAnswer(blank)).toBe(false);
    expect(practiceReducer(blank, { type: 'ANSWER_SUBMITTED', now: CORRECT_AT })).toBe(blank);
  });

  it('moves the first error to first_retry with a non-revealing hint, then prevents promotion', () => {
    const firstRetry = selectAndSubmit(startAnswering(), 'wrong-1-a');

    expect(firstRetry).toMatchObject({
      phase: 'first_retry',
      answerValue: null,
      feedback: {
        kind: 'incorrect',
        revealAnswer: false,
        submittedAnswer: 'wrong-1-a',
      },
      hint: { kind: 'choice-elimination', eliminatedEntityId: 'wrong-1-a' },
      saveStatus: 'idle',
      pendingAttempt: null,
    });

    const completed = selectAndSubmit(firstRetry, 'r1', '2026-08-28T00:00:15.000Z');
    expect(completed.pendingAttempt).toMatchObject({
      event: {
        correct: true,
        usedHint: true,
        answerAttemptCount: 2,
        independentCorrect: false,
      },
      mastery: { stage: 'learning' },
    });
    expect(completed.session.questions).toHaveLength(13);
  });

  it('uses the existing hint builder for an active hint and does not promote a later correct answer', () => {
    const hinted = practiceReducer(startAnswering(), { type: 'HINT_REQUESTED' });
    expect(hinted.hint).toEqual({
      kind: 'choice-elimination',
      eliminatedEntityId: 'wrong-1-a',
    });

    const completed = selectAndSubmit(hinted, 'r1');
    expect(completed.pendingAttempt).toMatchObject({
      event: { usedHint: true, independentCorrect: false },
      mastery: { stage: 'learning' },
    });
    const retryIndex = completed.session.questions.findIndex(
      (item) => item.presentation === 'text' && item.entityId === 'r1',
    );
    expect(retryIndex).toBe(4);
  });

  it('reveals after the second error and inserts a supplied retry after 3–5 other questions', () => {
    const firstRetry = selectAndSubmit(startAnswering(), 'wrong-1-a');
    const revealed = selectAndSubmit(firstRetry, 'wrong-1-b', '2026-08-28T00:00:15.000Z');

    expect(revealed).toMatchObject({
      phase: 'revealed',
      feedback: { kind: 'revealed', revealAnswer: true },
      saveStatus: 'saving',
    });
    expect(revealed.pendingAttempt).toMatchObject({
      event: { correct: false, answerAttemptCount: 2, independentCorrect: false },
      mastery: { stage: 'new', scheduledIntervalMs: 600_000 },
    });
    const retryIndex = revealed.session.questions.findIndex(
      (item) => item.presentation === 'text' && item.entityId === 'r1',
    );
    expect(retryIndex).toBeGreaterThanOrEqual(4);
    expect(retryIndex).toBeLessThanOrEqual(6);
    expect(revealed.session.questions).toHaveLength(13);
    expect(revealed.session.carryoverRetryDebts).toEqual([]);
  });

  it('marks a fallback retry at its inserted index instead of the original question index', () => {
    const firstRetry = selectAndSubmit(
      startAnswering(makeState({ retryVariations: [] })),
      'wrong-1-a',
    );
    const revealed = selectAndSubmit(firstRetry, 'wrong-1-b');

    expect(revealed.session.questions).toHaveLength(13);
    expect(revealed.delayedRetryQuestionIndexes).toEqual([4]);
  });

  it('carries retry debt at the 15-question cap without mutating the input session', () => {
    const inputSession = session(15);
    const before = structuredClone(inputSession);
    const state = startAnswering(makeState({ session: inputSession }));
    const firstRetry = selectAndSubmit(state, 'wrong-1-a');
    const revealed = selectAndSubmit(firstRetry, 'wrong-1-b');

    expect(revealed.session.questions).toHaveLength(15);
    expect(revealed.session.carryoverRetryDebts).toEqual([
      {
        entityId: 'r1',
        skill: 'identify_region',
        sourceQuestionKind: 'identify_region',
        createdAt: CORRECT_AT,
        priority: 'immediate',
      },
    ]);
    expect(inputSession).toEqual(before);
  });

  it('carries retry debt when fewer than three other questions remain', () => {
    const currentSession = session(12, 10);
    const state = startAnswering(makeState({ session: currentSession, retryVariations: [
      {
        kind: 'identify_region',
        presentation: 'text',
        entityId: 'r11',
        answer: { acceptedDisplayValues: ['十一区'] },
      },
    ] }));
    const firstRetry = selectAndSubmit(state, 'wrong-11-a');
    const revealed = selectAndSubmit(firstRetry, 'wrong-11-b');

    expect(revealed.session.questions).toHaveLength(12);
    expect(revealed.session.carryoverRetryDebts).toHaveLength(1);
    expect(revealed.session.carryoverRetryDebts[0]).toMatchObject({ entityId: 'r11' });
  });

  it('accumulates pause duration in the session and excludes it from response time', () => {
    let state = startAnswering();
    state = practiceReducer(state, { type: 'PAUSED', now: '2026-08-28T00:00:02.000Z' });
    expect(canSubmitAnswer(state)).toBe(false);
    state = practiceReducer(state, { type: 'RESUMED', now: '2026-08-28T00:00:07.000Z' });
    state = selectAndSubmit(state, 'r1', CORRECT_AT);

    expect(state.session.accumulatedPauseMs).toBe(5_000);
    expect(state.pendingAttempt?.event.responseMs).toBe(5_000);
    expect(state.pendingAttempt?.session.accumulatedPauseMs).toBe(5_000);
  });

  it('ignores answer and hint actions while paused', () => {
    const answering = startAnswering();
    const paused = practiceReducer(answering, {
      type: 'PAUSED',
      now: '2026-08-28T00:00:02.000Z',
    });

    expect(practiceReducer(paused, { type: 'ANSWER_SELECTED', value: 'r1' })).toBe(paused);
    expect(practiceReducer(paused, { type: 'HINT_REQUESTED' })).toBe(paused);
  });

  it('keeps map first-retry hints directional and never exposes the target coordinate', () => {
    const mapQuestion: Question = {
      kind: 'locate_place',
      presentation: 'map',
      entityId: 'target',
      coordinate: [-10, -10],
    };
    const currentSession = {
      ...session(),
      questions: [mapQuestion, ...session().questions.slice(1)],
    };
    const coordinates: readonly Readonly<{ entityId: string; coordinate: Coordinate }>[] = [
      { entityId: 'wrong', coordinate: [0, 0] },
      { entityId: 'target', coordinate: [10, -10] },
    ];
    const state = startAnswering(makeState({
      session: currentSession,
      masteryRecords: [mastery(1, { entityId: 'target', skill: 'locate_place' }), ...currentSession.questions.slice(1).map((item, index) => mastery(index + 2, { entityId: item.entityId, skill: item.kind }))],
      mapCoordinates: coordinates,
    }));
    const firstRetry = selectAndSubmit(state, 'wrong');

    expect(firstRetry.hint).toEqual({ kind: 'map-direction', sector: 'north-east' });
    expect(firstRetry.feedback).toEqual({
      kind: 'incorrect',
      revealAnswer: false,
      submittedAnswer: 'wrong',
    });
  });

  it('normalizes typed answers through the existing answer acceptance rules', () => {
    const textQuestion: Question = {
      kind: 'identify_region',
      presentation: 'text',
      entityId: 'r1',
      answer: { acceptedDisplayValues: ['New York'] },
    };
    const currentSession = { ...session(), questions: [textQuestion, ...session().questions.slice(1)] };
    let state = startAnswering(makeState({ session: currentSession }));
    state = practiceReducer(state, { type: 'ANSWER_TYPED', value: '  NEW-york ' });
    state = practiceReducer(state, { type: 'ANSWER_SUBMITTED', now: CORRECT_AT });

    expect(state.feedback).toEqual({ kind: 'correct', revealAnswer: true });
  });

  it('ignores stale save acknowledgements and advances only after the matching attempt is saved', () => {
    const completed = selectAndSubmit(startAnswering(), 'r1');
    expect(
      practiceReducer(completed, { type: 'ATTEMPT_SAVED', attemptId: 'stale-attempt' }),
    ).toBe(completed);
    expect(practiceReducer(completed, { type: 'CONTINUED', now: CORRECT_AT })).toBe(completed);

    const next = practiceReducer(save(completed), { type: 'CONTINUED', now: CORRECT_AT });
    expect(next).toMatchObject({
      phase: 'answering',
      currentQuestion: { entityId: 'r2' },
      saveStatus: 'idle',
      pendingAttempt: null,
      feedback: null,
    });
  });

  it('uses the continue timestamp when presenting and scheduling the next question', () => {
    const first = selectAndSubmit(startAnswering(), 'r1');
    const saved = save(first);

    const next = practiceReducer(saved, {
      type: 'CONTINUED',
      now: '2026-08-28T00:00:30.000Z',
    });

    expect(next.questionPresentedAt).toBe('2026-08-28T00:00:30.000Z');
  });

  it('does not mutate a deeply frozen state while reducing', () => {
    const state = startAnswering();
    const before = structuredClone(state);
    Object.freeze(state.session.questions);
    Object.freeze(state.session.carryoverRetryDebts);
    Object.freeze(state.session);
    Object.freeze(state.masteryRecords);
    Object.freeze(state);

    const completed = selectAndSubmit(state, 'r1');
    expect(state).toEqual(before);
    expect(completed).not.toBe(state);
  });
});

describe('commitCurrentAttempt', () => {
  function reducingDispatch(getState: () => PracticeState, setState: (state: PracticeState) => void) {
    return (action: PracticeAction): void => setState(practiceReducer(getState(), action));
  }

  it('atomically saves the exact pending event, mastery, and advanced session', async () => {
    const repository = new InMemoryProgressRepository();
    let state = selectAndSubmit(startAnswering(), 'r1');

    await commitCurrentAttempt({
      state,
      repository,
      dispatch: reducingDispatch(() => state, (next) => { state = next; }),
    });

    expect(state.saveStatus).toBe('saved');
    await expect(repository.loadSnapshot('learner-1', 'pack-1')).resolves.toMatchObject([
      { entityId: 'r1', skill: 'identify_region', stage: 'weak' },
    ]);
    await expect(
      repository.loadResumableSession('learner-1', 'pack-1', '2026-08-28T01:00:00.000Z'),
    ).resolves.toMatchObject({ questionCursor: 1 });
  });

  it('preserves feedback on failure and retries the same attemptId without duplicate accounting', async () => {
    const stored = new InMemoryProgressRepository();
    const observedAttemptIds: string[] = [];
    let shouldFail = true;
    const repository: ProgressRepository = {
      loadSnapshot: (...args) => stored.loadSnapshot(...args),
      loadAttemptHistory: (...args) => stored.loadAttemptHistory(...args),
      loadRetryDebts: (...args) => stored.loadRetryDebts(...args),
      saveAttempt: async (input) => {
        observedAttemptIds.push(input.event.attemptId);
        if (shouldFail) {
          shouldFail = false;
          throw Object.assign(new Error('disk unavailable'), { code: 'DISK_UNAVAILABLE' });
        }
        await stored.saveAttempt(input);
      },
      saveSession: (value) => stored.saveSession(value),
      loadResumableSession: (...args) => stored.loadResumableSession(...args),
      loadSettings: () => stored.loadSettings(),
      saveSettings: (value) => stored.saveSettings(value),
    };
    let state = selectAndSubmit(startAnswering(), 'r1');
    const feedback = state.feedback;
    const pending = state.pendingAttempt;
    const dispatch = reducingDispatch(() => state, (next) => { state = next; });

    await commitCurrentAttempt({ state, repository, dispatch });
    expect(state).toMatchObject({ saveStatus: 'failed', saveErrorCode: 'DISK_UNAVAILABLE' });
    expect(state.feedback).toBe(feedback);
    expect(state.pendingAttempt).toBe(pending);
    expect(canRetrySave(state)).toBe(true);
    expect(canContinue(state)).toBe(false);
    expect(canLeavePractice(state)).toBe(false);
    expect(canSkipQuestion(state)).toBe(false);

    await commitCurrentAttempt({ state, repository, dispatch });
    expect(state.saveStatus).toBe('saved');
    expect(observedAttemptIds).toEqual(['session-1:0', 'session-1:0']);
    await expect(stored.loadSnapshot('learner-1', 'pack-1')).resolves.toHaveLength(1);

    await commitCurrentAttempt({ state, repository, dispatch });
    expect(observedAttemptIds).toHaveLength(2);
  });
});

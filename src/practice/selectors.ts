import type { PracticeState } from './reducer';

function saveIsPending(state: PracticeState): boolean {
  return state.pendingAttempt !== null && state.saveStatus !== 'saved';
}

export function canSubmitAnswer(state: PracticeState): boolean {
  return (
    (state.phase === 'answering' || state.phase === 'first_retry') &&
    state.pausedAt === null &&
    state.answerValue !== null &&
    state.answerValue.trim().length > 0
  );
}

export function canContinue(state: PracticeState): boolean {
  return state.pendingAttempt !== null && state.saveStatus === 'saved';
}

export function canLeavePractice(state: PracticeState): boolean {
  return !saveIsPending(state);
}

export function canSkipQuestion(state: PracticeState): boolean {
  return !saveIsPending(state);
}

export function canRetrySave(state: PracticeState): boolean {
  return state.pendingAttempt !== null && state.saveStatus === 'failed';
}

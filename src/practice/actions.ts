import type { ProgressRepository } from '../persistence/ProgressRepository';
import type { PracticeState } from './reducer';

export type PracticeAction =
  | Readonly<{ type: 'INTRO_CONTINUED' }>
  | Readonly<{ type: 'ANSWER_SELECTED'; value: string }>
  | Readonly<{ type: 'ANSWER_TYPED'; value: string }>
  | Readonly<{ type: 'HINT_REQUESTED' }>
  | Readonly<{ type: 'ANSWER_SUBMITTED'; now: string }>
  | Readonly<{ type: 'ATTEMPT_SAVED'; attemptId: string }>
  | Readonly<{ type: 'ATTEMPT_SAVE_FAILED'; code: string }>
  | Readonly<{ type: 'CONTINUED' }>
  | Readonly<{ type: 'PAUSED'; now: string }>
  | Readonly<{ type: 'RESUMED'; now: string }>;

export type CommitCurrentAttemptInput = Readonly<{
  state: PracticeState;
  repository: ProgressRepository;
  dispatch: (action: PracticeAction) => void;
}>;

function errorCode(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.length > 0
  ) {
    return error.code;
  }
  return 'ATTEMPT_SAVE_FAILED';
}

export async function commitCurrentAttempt(input: CommitCurrentAttemptInput): Promise<void> {
  const { state, repository, dispatch } = input;
  if (
    state.pendingAttempt === null ||
    (state.saveStatus !== 'saving' && state.saveStatus !== 'failed')
  ) {
    return;
  }

  const pending = state.pendingAttempt;
  try {
    await repository.saveAttempt(pending);
    dispatch({ type: 'ATTEMPT_SAVED', attemptId: pending.event.attemptId });
  } catch (error) {
    dispatch({ type: 'ATTEMPT_SAVE_FAILED', code: errorCode(error) });
  }
}

import { describe, expect, it } from 'vitest';
import {
  appReducer,
  createInitialAppState,
  elapsedResponseMs,
  type AppState,
} from './appReducer';

function inPractice(): AppState {
  return appReducer(createInitialAppState(), {
    type: 'PRACTICE_OPENED',
    packId: 'us-states',
    sessionId: 'session-1',
    now: '2026-08-28T00:00:00.000Z',
  });
}

describe('appReducer', () => {
  it('uses a reversible pause/options stack for Escape', () => {
    const paused = appReducer(inPractice(), {
      type: 'ESCAPE_PRESSED',
      now: '2026-08-28T00:00:03.000Z',
    });
    expect(paused.overlayStack).toEqual(['pause']);

    const options = appReducer(paused, { type: 'OPTIONS_OPENED' });
    expect(options.overlayStack).toEqual(['pause', 'options']);

    const backToPause = appReducer(options, {
      type: 'ESCAPE_PRESSED',
      now: '2026-08-28T00:00:04.000Z',
    });
    expect(backToPause.overlayStack).toEqual(['pause']);

    const resumed = appReducer(backToPause, {
      type: 'ESCAPE_PRESSED',
      now: '2026-08-28T00:00:08.000Z',
    });
    expect(resumed.overlayStack).toEqual([]);
    expect(resumed.accumulatedPauseMs).toBe(5_000);
  });

  it('pauses on lost visibility and stays paused after returning', () => {
    const hidden = appReducer(inPractice(), {
      type: 'WINDOW_HIDDEN',
      now: '2026-08-28T00:00:02.000Z',
    });
    const visible = appReducer(hidden, { type: 'WINDOW_VISIBLE' });

    expect(visible.overlayStack).toEqual(['pause']);
    expect(visible.pausedAt).toBe('2026-08-28T00:00:02.000Z');
  });

  it('freezes response time while paused', () => {
    const state = appReducer(inPractice(), {
      type: 'WINDOW_HIDDEN',
      now: '2026-08-28T00:00:02.000Z',
    });

    expect(elapsedResponseMs(state, '2026-08-28T00:00:20.000Z')).toBe(2_000);
  });

  it('waits for an in-flight save before returning home', () => {
    const saving = appReducer(inPractice(), { type: 'SAVE_STARTED' });
    const requested = appReducer(saving, { type: 'HOME_REQUESTED' });

    expect(requested.page.kind).toBe('practice');
    expect(requested.pendingHomeNavigation).toBe(true);
    expect(appReducer(requested, {
      type: 'ESCAPE_PRESSED',
      now: '2026-08-28T00:00:05.000Z',
    })).toBe(requested);

    const completed = appReducer(requested, { type: 'SAVE_FINISHED' });
    expect(completed.page).toEqual({ kind: 'home' });
    expect(completed.pendingHomeNavigation).toBe(false);
  });

  it('starts response timing again when each new question is presented', () => {
    const nextQuestion = appReducer(inPractice(), {
      type: 'QUESTION_PRESENTED',
      now: '2026-08-28T00:00:20.000Z',
    });

    expect(elapsedResponseMs(nextQuestion, '2026-08-28T00:00:25.000Z')).toBe(5_000);
    expect(nextQuestion.accumulatedPauseMs).toBe(0);
  });
});

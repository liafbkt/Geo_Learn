import type { AppAction, AppState } from './AppState';

export type { AppAction, AppState } from './AppState';

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith('Z')) {
    throw new Error('App timestamps must be ISO-8601 UTC');
  }
  return parsed;
}

export function createInitialAppState(): AppState {
  return {
    page: { kind: 'home' },
    overlayStack: [],
    pausedAt: null,
    accumulatedPauseMs: 0,
    saveInFlight: false,
    pendingHomeNavigation: false,
  };
}

function pause(state: AppState, now: string): AppState {
  if (state.page.kind !== 'practice' || state.pausedAt !== null) return state;
  timestamp(now);
  return { ...state, overlayStack: ['pause'], pausedAt: now };
}

function resume(state: AppState, now: string): AppState {
  if (state.pausedAt === null) return { ...state, overlayStack: [] };
  const pauseDuration = timestamp(now) - timestamp(state.pausedAt);
  if (pauseDuration < 0) throw new Error('Resume time cannot precede pause time');
  return {
    ...state,
    overlayStack: [],
    pausedAt: null,
    accumulatedPauseMs: state.accumulatedPauseMs + pauseDuration,
  };
}

function topOverlay(state: AppState): AppState['overlayStack'][number] | undefined {
  return state.overlayStack[state.overlayStack.length - 1];
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'PRACTICE_OPENED':
      timestamp(action.now);
      return {
        ...state,
        page: {
          kind: 'practice',
          packId: action.packId,
          sessionId: action.sessionId,
          questionStartedAt: action.now,
        },
        overlayStack: [],
        pausedAt: null,
        accumulatedPauseMs: 0,
        pendingHomeNavigation: false,
      };
    case 'ESCAPE_PRESSED': {
      if (state.page.kind !== 'practice') return state;
      const top = topOverlay(state);
      if (top === 'options') {
        return { ...state, overlayStack: ['pause'] };
      }
      return top === 'pause' ? resume(state, action.now) : pause(state, action.now);
    }
    case 'OPTIONS_OPENED':
      return topOverlay(state) === 'pause'
        ? { ...state, overlayStack: ['pause', 'options'] }
        : state;
    case 'WINDOW_HIDDEN':
      return pause(state, action.now);
    case 'WINDOW_VISIBLE':
      return state;
    case 'SAVE_STARTED':
      return { ...state, saveInFlight: true };
    case 'SAVE_FINISHED':
      return state.pendingHomeNavigation
        ? { ...createInitialAppState() }
        : { ...state, saveInFlight: false };
    case 'HOME_REQUESTED':
      return state.saveInFlight
        ? { ...state, pendingHomeNavigation: true }
        : createInitialAppState();
  }
}

export function elapsedResponseMs(state: AppState, now: string): number {
  if (state.page.kind !== 'practice') return 0;
  const effectiveNow = state.pausedAt === null ? timestamp(now) : timestamp(state.pausedAt);
  return Math.max(
    0,
    effectiveNow - timestamp(state.page.questionStartedAt) - state.accumulatedPauseMs,
  );
}

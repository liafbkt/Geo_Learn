export type AppPage =
  | Readonly<{ kind: 'home' }>
  | Readonly<{
      kind: 'practice';
      packId: string;
      sessionId: string;
      questionStartedAt: string;
    }>;

export type AppOverlay = 'pause' | 'options';

export type AppState = Readonly<{
  page: AppPage;
  overlayStack: readonly AppOverlay[];
  pausedAt: string | null;
  accumulatedPauseMs: number;
  saveInFlight: boolean;
  pendingHomeNavigation: boolean;
}>;

export type AppAction =
  | Readonly<{
      type: 'PRACTICE_OPENED';
      packId: string;
      sessionId: string;
      now: string;
    }>
  | Readonly<{ type: 'ESCAPE_PRESSED'; now: string }>
  | Readonly<{ type: 'OPTIONS_OPENED' }>
  | Readonly<{ type: 'WINDOW_HIDDEN'; now: string }>
  | Readonly<{ type: 'WINDOW_VISIBLE' }>
  | Readonly<{ type: 'QUESTION_PRESENTED'; now: string }>
  | Readonly<{ type: 'SAVE_STARTED' }>
  | Readonly<{ type: 'SAVE_FINISHED' }>
  | Readonly<{ type: 'HOME_REQUESTED' }>;

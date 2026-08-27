import type { AppSettings } from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';

export interface ProgressRepository {
  loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]>;
  saveAttempt(
    input: Readonly<{
      event: AttemptEvent;
      session: PracticeSession;
      mastery: MasteryRecord;
    }>,
  ): Promise<void>;
  saveSession(session: PracticeSession): Promise<void>;
  loadResumableSession(
    learnerId: string,
    packId: string,
    now: string,
  ): Promise<PracticeSession | null>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
}

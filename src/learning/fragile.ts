import type { AttemptEvent, MasteryStage } from './types';

const DAY = 24 * 60 * 60_000;
const THIRTY_DAYS = 30 * DAY;
const stages: readonly MasteryStage[] = ['new', 'learning', 'weak', 'familiar', 'solid', 'mastered'];

function moveStage(stage: MasteryStage, direction: -1 | 1): MasteryStage {
  const index = stages.indexOf(stage);
  return stages[Math.max(0, Math.min(stages.length - 1, index + direction))] ?? stage;
}

function advanceStage(stage: MasteryStage, event: AttemptEvent): MasteryStage {
  const independentCorrect =
    event.correct && event.independentCorrect && !event.usedHint && event.answerAttemptCount === 1;
  if (event.mode === 'placement' && !event.correct) {
    return stage;
  }
  if (independentCorrect) {
    const promoted = moveStage(stage, 1);
    return event.mode === 'placement' && stages.indexOf(promoted) > stages.indexOf('familiar')
      ? 'familiar'
      : promoted;
  }
  if (event.correct) {
    return stage;
  }
  return moveStage(stage, -1);
}

function isClearEvidence(event: AttemptEvent): boolean {
  return (
    event.correct &&
    event.independentCorrect &&
    !event.usedHint &&
    event.answerAttemptCount === 1 &&
    !event.delayedRetry
  );
}

export function isFragile(history: readonly AttemptEvent[], now: string): boolean {
  const nowMs = Date.parse(now);
  const cutoffMs = nowMs - THIRTY_DAYS;
  const ordered = [...history].sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt));
  let stage: MasteryStage = 'new';
  let reachedFamiliar = false;
  let fragile = false;
  let failureCount = 0;
  let clearCount = 0;
  let lastClearEvidenceAt: number | null = null;

  for (const event of ordered) {
    const completedAt = Date.parse(event.completedAt);
    const wasFamiliar = reachedFamiliar;
    stage = advanceStage(stage, event);
    reachedFamiliar ||= stages.indexOf(stage) >= stages.indexOf('familiar');

    const isEvidence =
      event.scheduledReview && event.mode !== 'placement' && completedAt >= cutoffMs && completedAt <= nowMs;
    if (!isEvidence || !wasFamiliar) {
      continue;
    }

    if (!event.correct) {
      failureCount += 1;
      if (failureCount >= 2 && !fragile) {
        fragile = true;
        clearCount = 0;
        lastClearEvidenceAt = null;
      }
      continue;
    }

    if (!fragile || !isClearEvidence(event)) {
      continue;
    }

    if (lastClearEvidenceAt === null || completedAt - lastClearEvidenceAt >= DAY) {
      clearCount += 1;
      lastClearEvidenceAt = completedAt;
    }
    if (clearCount === 3) {
      fragile = false;
      failureCount = 0;
      clearCount = 0;
      lastClearEvidenceAt = null;
    }
  }

  return fragile;
}

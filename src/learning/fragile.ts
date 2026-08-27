import type { AttemptEvent, MasteryStage } from './types';

const DAY = 24 * 60 * 60_000;
const THIRTY_DAYS = 30 * DAY;
const stages: readonly MasteryStage[] = ['new', 'learning', 'weak', 'familiar', 'solid', 'mastered'];

function moveStage(stage: MasteryStage, direction: -1 | 1): MasteryStage {
  const index = stages.indexOf(stage);
  return stages[Math.max(0, Math.min(stages.length - 1, index + direction))] ?? stage;
}

function advanceStage(stage: MasteryStage, event: AttemptEvent): MasteryStage {
  const firstAttemptCorrect = event.correct && !event.usedHint && event.answerAttemptCount === 1;
  const promotionCorrect =
    firstAttemptCorrect && (event.mode === 'placement' || event.independentCorrect);
  if (event.mode === 'placement' && !event.correct) {
    return stage;
  }
  if (promotionCorrect) {
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
  const ordered = [...history].sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt));
  let stage: MasteryStage = 'new';
  let reachedFamiliar = false;
  let fragile = false;
  let failureTimes: number[] = [];
  let clearCount = 0;
  let lastClearEvidenceAt: number | null = null;

  for (const event of ordered) {
    const completedAt = Date.parse(event.completedAt);
    if (completedAt > nowMs) {
      continue;
    }
    const wasFamiliar = reachedFamiliar;
    stage = advanceStage(stage, event);
    reachedFamiliar ||= stages.indexOf(stage) >= stages.indexOf('familiar');

    const isEvidence = event.scheduledReview && event.mode !== 'placement';
    if (!isEvidence || !wasFamiliar) {
      continue;
    }

    if (!event.correct) {
      if (fragile) {
        continue;
      }
      failureTimes = failureTimes.filter((failureAt) => failureAt >= completedAt - THIRTY_DAYS);
      failureTimes.push(completedAt);
      if (failureTimes.length >= 2) {
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
      failureTimes = [];
      clearCount = 0;
      lastClearEvidenceAt = null;
    }
  }

  return fragile;
}

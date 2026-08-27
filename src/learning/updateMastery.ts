import type { AttemptOutcome, MasteryRecord, MasteryStage } from './types';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const stages: readonly MasteryStage[] = ['new', 'learning', 'weak', 'familiar', 'solid', 'mastered'];
const baseIntervalMs: Readonly<Record<MasteryStage, number>> = {
  new: 0,
  learning: 10 * MINUTE,
  weak: DAY,
  familiar: 3 * DAY,
  solid: 7 * DAY,
  mastered: 21 * DAY,
};

function moveStage(stage: MasteryStage, direction: -1 | 1): MasteryStage {
  const currentIndex = stages.indexOf(stage);
  const targetIndex = Math.max(0, Math.min(stages.length - 1, currentIndex + direction));
  return stages[targetIndex] ?? stage;
}

function smoothedResponse(previous: number | null, observed: number): number {
  return previous === null ? observed : previous * 0.8 + observed * 0.2;
}

function responseAfter(record: MasteryRecord, outcome: AttemptOutcome): number | null {
  return outcome.correct
    ? smoothedResponse(record.smoothedResponseMs, outcome.responseMs)
    : record.smoothedResponseMs;
}

function withSchedule(
  record: MasteryRecord,
  stage: MasteryStage,
  intervalMs: number,
  outcome: AttemptOutcome,
  nowMs: number,
): MasteryRecord {
  const updatedAt = new Date(nowMs).toISOString();
  return {
    ...record,
    stage,
    scheduledIntervalMs: intervalMs,
    dueAt: new Date(nowMs + intervalMs).toISOString(),
    smoothedResponseMs: responseAfter(record, outcome),
    updatedAt,
  };
}

export function updateMastery(
  record: MasteryRecord,
  outcome: AttemptOutcome,
  now: string,
): MasteryRecord {
  const nowMs = Date.parse(now);
  const firstAttemptCorrect =
    outcome.correct && !outcome.usedHint && outcome.answerAttemptCount === 1;
  const promotionCorrect =
    firstAttemptCorrect && (outcome.mode === 'placement' || outcome.independentCorrect);

  if (outcome.mode === 'placement' && !outcome.correct) {
    return {
      ...record,
      smoothedResponseMs: responseAfter(record, outcome),
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  if (outcome.mode === 'placement' && stages.indexOf(record.stage) >= stages.indexOf('familiar')) {
    return {
      ...record,
      smoothedResponseMs: responseAfter(record, outcome),
      updatedAt: new Date(nowMs).toISOString(),
    };
  }

  if (promotionCorrect) {
    if (record.stage === 'mastered') {
      const intervalMs = Math.min(90 * DAY, Math.max(21 * DAY, record.scheduledIntervalMs * 2));
      return withSchedule(record, record.stage, intervalMs, outcome, nowMs);
    }

    const promoted = moveStage(record.stage, 1);
    const stage = outcome.mode === 'placement' && stages.indexOf(promoted) > stages.indexOf('familiar')
      ? 'familiar'
      : promoted;
    return withSchedule(record, stage, baseIntervalMs[stage], outcome, nowMs);
  }

  if (outcome.correct) {
    const intervalMs = Math.min(baseIntervalMs[record.stage], DAY);
    return withSchedule(record, record.stage, intervalMs, outcome, nowMs);
  }

  return withSchedule(record, moveStage(record.stage, -1), 10 * MINUTE, outcome, nowMs);
}

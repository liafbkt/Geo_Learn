import {
  DEFAULT_APP_SETTINGS,
  validateAppSettings,
  type AppSettings,
} from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';
import type { ProgressRepository } from './ProgressRepository';

const DAY_MS = 86_400_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function validateId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`${label} ID is invalid`);
  }
}

function timestampMs(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !value.endsWith('Z')) {
    throw new Error(`${label} timestamp must be ISO-8601 UTC`);
  }
  return parsed;
}

function validateMastery(record: MasteryRecord): void {
  validateId(record.learnerId, 'Learner');
  validateId(record.packId, 'Pack');
  validateId(record.entityId, 'Entity');
  timestampMs(record.dueAt, 'Due');
  timestampMs(record.updatedAt, 'Updated');
  if (!Number.isFinite(record.scheduledIntervalMs) || record.scheduledIntervalMs < 0) {
    throw new Error('Scheduled interval is invalid');
  }
  if (
    record.smoothedResponseMs !== null &&
    (!Number.isFinite(record.smoothedResponseMs) || record.smoothedResponseMs < 0)
  ) {
    throw new Error('Smoothed response is invalid');
  }
}

function validateEvent(value: AttemptEvent): void {
  validateId(value.attemptId, 'Attempt');
  validateId(value.sessionId, 'Session');
  validateId(value.learnerId, 'Learner');
  validateId(value.packId, 'Pack');
  validateId(value.entityId, 'Entity');
  timestampMs(value.completedAt, 'Completed');
  if (!Number.isFinite(value.responseMs) || value.responseMs < 0) {
    throw new Error('Response duration is invalid');
  }
}

function validateSession(value: PracticeSession): void {
  validateId(value.sessionId, 'Session');
  validateId(value.learnerId, 'Learner');
  validateId(value.request.packId, 'Pack');
  timestampMs(value.startedAt, 'Started');
  if (!Number.isInteger(value.baseQuestionCount) || value.baseQuestionCount < 0) {
    throw new Error('Base question count is invalid');
  }
  if (
    !Number.isInteger(value.questionCursor) ||
    value.questionCursor < 0 ||
    value.questionCursor > value.questions.length
  ) {
    throw new Error('Question cursor is invalid');
  }
  if (
    !Number.isInteger(value.introductionCursor) ||
    value.introductionCursor < 0 ||
    value.introductionCursor > value.introductions.length
  ) {
    throw new Error('Introduction cursor is invalid');
  }
  if (!Number.isFinite(value.accumulatedPauseMs) || value.accumulatedPauseMs < 0) {
    throw new Error('Accumulated pause duration is invalid');
  }
}

function masteryKey(record: MasteryRecord): string {
  return [record.learnerId, record.packId, record.entityId, record.skill].join('\u0000');
}

function compareMastery(left: MasteryRecord, right: MasteryRecord): number {
  return compareAscii(left.entityId, right.entityId) || compareAscii(left.skill, right.skill);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class InMemoryProgressRepository implements ProgressRepository {
  readonly #mastery = new Map<string, MasteryRecord>();
  readonly #attemptIds = new Set<string>();
  readonly #sessions = new Map<string, PracticeSession>();
  #settings: AppSettings = clone(DEFAULT_APP_SETTINGS);

  async loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]> {
    validateId(learnerId, 'Learner');
    validateId(packId, 'Pack');
    return [...this.#mastery.values()]
      .filter((record) => record.learnerId === learnerId && record.packId === packId)
      .sort(compareMastery)
      .map(clone);
  }

  async saveAttempt(
    input: Readonly<{
      event: AttemptEvent;
      session: PracticeSession;
      mastery: MasteryRecord;
    }>,
  ): Promise<void> {
    validateEvent(input.event);
    validateSession(input.session);
    validateMastery(input.mastery);
    const { event, session, mastery } = input;
    if (
      event.sessionId !== session.sessionId ||
      event.learnerId !== session.learnerId ||
      event.packId !== session.request.packId ||
      event.learnerId !== mastery.learnerId ||
      event.packId !== mastery.packId ||
      event.entityId !== mastery.entityId ||
      event.skill !== mastery.skill
    ) {
      throw new Error('Attempt, mastery, and session scopes do not match');
    }
    if (this.#attemptIds.has(event.attemptId)) {
      return;
    }

    const clonedMastery = clone(mastery);
    const clonedSession = clone(session);
    this.#attemptIds.add(event.attemptId);
    this.#mastery.set(masteryKey(clonedMastery), clonedMastery);
    this.#sessions.set(clonedSession.sessionId, clonedSession);
  }

  async saveSession(session: PracticeSession): Promise<void> {
    validateSession(session);
    this.#sessions.set(session.sessionId, clone(session));
  }

  async loadResumableSession(
    learnerId: string,
    packId: string,
    now: string,
  ): Promise<PracticeSession | null> {
    validateId(learnerId, 'Learner');
    validateId(packId, 'Pack');
    const nowMs = timestampMs(now, 'Current');
    const eligible = [...this.#sessions.values()]
      .filter(
        (candidate) =>
          candidate.learnerId === learnerId &&
          candidate.request.packId === packId &&
          candidate.questionCursor < candidate.questions.length,
      )
      .map((candidate) => ({
        candidate,
        adjustedStartMs: timestampMs(candidate.startedAt, 'Started') + candidate.accumulatedPauseMs,
      }))
      .filter(
        ({ adjustedStartMs }) => nowMs >= adjustedStartMs && nowMs - adjustedStartMs <= DAY_MS,
      )
      .sort(
        (left, right) =>
          right.adjustedStartMs - left.adjustedStartMs ||
          right.candidate.sessionId.localeCompare(left.candidate.sessionId),
      );
    const newest = eligible[0];
    return newest === undefined ? null : clone(newest.candidate);
  }

  async loadSettings(): Promise<AppSettings> {
    return clone(this.#settings);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    validateAppSettings(settings);
    this.#settings = clone(settings);
  }
}

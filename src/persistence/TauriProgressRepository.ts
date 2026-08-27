import { invoke } from '@tauri-apps/api/core';
import { validateAppSettings, type AppSettings } from '../app/settings';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import type { PracticeSession } from '../practice/session';
import type { ProgressRepository } from './ProgressRepository';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function requireId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw new Error(`${label} ID is invalid`);
  }
}

function requireTimestamp(value: string, label: string): void {
  if (!value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} timestamp must be ISO-8601 UTC`);
  }
}

function masteryDto(record: MasteryRecord): MasteryRecord {
  requireId(record.learnerId, 'Learner');
  requireId(record.packId, 'Pack');
  requireId(record.entityId, 'Entity');
  requireTimestamp(record.dueAt, 'Due');
  requireTimestamp(record.updatedAt, 'Updated');
  return {
    learnerId: record.learnerId,
    packId: record.packId,
    entityId: record.entityId,
    skill: record.skill,
    stage: record.stage,
    scheduledIntervalMs: record.scheduledIntervalMs,
    dueAt: record.dueAt,
    smoothedResponseMs: record.smoothedResponseMs,
    updatedAt: record.updatedAt,
  };
}

function eventDto(value: AttemptEvent): AttemptEvent {
  requireId(value.attemptId, 'Attempt');
  requireId(value.sessionId, 'Session');
  requireId(value.learnerId, 'Learner');
  requireId(value.packId, 'Pack');
  requireId(value.entityId, 'Entity');
  requireTimestamp(value.completedAt, 'Completed');
  return { ...value };
}

function sessionDto(value: PracticeSession): PracticeSession {
  requireId(value.sessionId, 'Session');
  requireId(value.learnerId, 'Learner');
  requireId(value.request.packId, 'Pack');
  requireTimestamp(value.startedAt, 'Started');
  return {
    sessionId: value.sessionId,
    learnerId: value.learnerId,
    request: structuredClone(value.request),
    baseQuestionCount: value.baseQuestionCount,
    introductions: [...value.introductions],
    introductionCursor: value.introductionCursor,
    questions: structuredClone(value.questions),
    questionCursor: value.questionCursor,
    carryoverRetryDebts: structuredClone(value.carryoverRetryDebts),
    startedAt: value.startedAt,
    accumulatedPauseMs: value.accumulatedPauseMs,
  };
}

function parseMastery(value: unknown): MasteryRecord {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Native mastery response is invalid');
  }
  return masteryDto(value as MasteryRecord);
}

function parseSession(value: unknown): PracticeSession {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Native session response is invalid');
  }
  return sessionDto(value as PracticeSession);
}

function parseSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null || !('audio' in value)) {
    throw new Error('Native settings response is invalid');
  }
  const settings = value as AppSettings;
  validateAppSettings(settings);
  return structuredClone(settings);
}

export class TauriProgressRepository implements ProgressRepository {
  async loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]> {
    requireId(learnerId, 'Learner');
    requireId(packId, 'Pack');
    const response = await invoke<unknown>('load_progress_snapshot', { learnerId, packId });
    if (!Array.isArray(response)) {
      throw new Error('Native mastery snapshot response is invalid');
    }
    return response.map(parseMastery);
  }

  async saveAttempt(
    input: Readonly<{
      event: AttemptEvent;
      session: PracticeSession;
      mastery: MasteryRecord;
    }>,
  ): Promise<void> {
    await invoke('save_attempt_transaction', {
      input: {
        event: eventDto(input.event),
        session: sessionDto(input.session),
        mastery: masteryDto(input.mastery),
      },
    });
  }

  async saveSession(session: PracticeSession): Promise<void> {
    await invoke('save_practice_session', { session: sessionDto(session) });
  }

  async loadResumableSession(
    learnerId: string,
    packId: string,
    now: string,
  ): Promise<PracticeSession | null> {
    requireId(learnerId, 'Learner');
    requireId(packId, 'Pack');
    requireTimestamp(now, 'Current');
    const response = await invoke<unknown>('load_resumable_session', {
      learnerId,
      packId,
      now,
    });
    return response === null ? null : parseSession(response);
  }

  async loadSettings(): Promise<AppSettings> {
    return parseSettings(await invoke<unknown>('load_settings'));
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    validateAppSettings(settings);
    await invoke('save_settings', { settings: structuredClone(settings) });
  }
}

import { invoke } from '@tauri-apps/api/core';
import { validateAppSettings, type AppSettings } from '../app/settings';
import { packCapabilityValues } from '../content/types';
import type { Question } from '../learning/questions';
import type {
  AttemptEvent,
  MasteryRecord,
  MasteryStage,
  PracticeMode,
  Skill,
} from '../learning/types';
import type { PracticeSession, RetryDebt, SessionRequest } from '../practice/session';
import type { ProgressRepository } from './ProgressRepository';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MASTERY_STAGES: readonly MasteryStage[] = [
  'new', 'learning', 'weak', 'familiar', 'solid', 'mastered',
];
const REQUEST_STATUSES: readonly (MasteryStage | 'fragile')[] = [...MASTERY_STAGES, 'fragile'];
const PRACTICE_MODES: readonly PracticeMode[] = ['smart', 'custom', 'placement'];
type UnknownRecord = Record<string, unknown>;

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Native ${label} response is invalid`);
  }
  return value as UnknownRecord;
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonNegativeNumber(value: unknown, label: string): number {
  const parsed = finiteNumber(value, label);
  if (parsed < 0) throw new Error(`${label} cannot be negative`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = nonNegativeNumber(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireId(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!SAFE_ID.test(parsed)) throw new Error(`${label} ID is invalid`);
  return parsed;
}

function requireTimestamp(value: unknown, label: string): string {
  const parsed = string(value, label);
  if (!parsed.endsWith('Z') || !Number.isFinite(Date.parse(parsed))) {
    throw new Error(`${label} timestamp must be ISO-8601 UTC`);
  }
  return parsed;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  const parsed = string(value, label);
  if (!choices.includes(parsed as T)) throw new Error(`${label} is unsupported`);
  return parsed as T;
}

function skill(value: unknown, label = 'Skill'): Skill {
  return oneOf(value, packCapabilityValues, label);
}

function parseMastery(value: unknown): MasteryRecord {
  const source = record(value, 'mastery');
  return {
    learnerId: requireId(source.learnerId, 'Learner'),
    packId: requireId(source.packId, 'Pack'),
    entityId: requireId(source.entityId, 'Entity'),
    skill: skill(source.skill),
    stage: oneOf(source.stage, MASTERY_STAGES, 'Mastery stage'),
    scheduledIntervalMs: nonNegativeInteger(source.scheduledIntervalMs, 'Scheduled interval'),
    dueAt: requireTimestamp(source.dueAt, 'Due'),
    smoothedResponseMs: source.smoothedResponseMs === null
      ? null
      : nonNegativeNumber(source.smoothedResponseMs, 'Smoothed response'),
    updatedAt: requireTimestamp(source.updatedAt, 'Updated'),
  };
}

function parseRequest(value: unknown): SessionRequest {
  const source = record(value, 'session request');
  const mode = oneOf(source.mode, PRACTICE_MODES, 'Session request mode');
  const packId = requireId(source.packId, 'Pack');
  if (mode !== 'custom') {
    if (source.questionCount !== undefined || source.entityIds !== undefined ||
        source.skills !== undefined || source.statuses !== undefined) {
      throw new Error(`${mode} session request cannot contain custom filters`);
    }
    return { mode, packId };
  }
  const questionCount = nonNegativeInteger(source.questionCount, 'Custom question count');
  if (questionCount < 1 || questionCount > 50) {
    throw new Error('Custom question count must be an integer from 1 to 50');
  }
  const entityIds = array(source.entityIds, 'Custom entity IDs')
    .map((item) => requireId(item, 'Custom entity'));
  const skills = array(source.skills, 'Custom skills')
    .map((item) => skill(item, 'Custom skill'));
  const statuses = array(source.statuses, 'Custom statuses')
    .map((item) => oneOf(item, REQUEST_STATUSES, 'Custom status'));
  if (entityIds.length === 0 || skills.length === 0) {
    throw new Error('Custom entity IDs and skills must be non-empty');
  }
  return {
    mode, packId, questionCount,
    entityIds: entityIds as [string, ...string[]],
    skills: skills as [Skill, ...Skill[]],
    statuses,
  };
}

function parseAnswer(value: unknown): Readonly<{ acceptedDisplayValues: readonly string[] }> {
  const source = record(value, 'question answer');
  const acceptedDisplayValues = array(source.acceptedDisplayValues, 'Question answer values')
    .map((item) => string(item, 'Question answer value'));
  if (acceptedDisplayValues.length === 0 || acceptedDisplayValues.some((item) => item.length === 0)) {
    throw new Error('Question answer values cannot be empty');
  }
  return { acceptedDisplayValues };
}

function parseCandidates(value: unknown): readonly [string, string, string, string] {
  const candidates = array(value, 'Question candidate IDs')
    .map((item) => requireId(item, 'Candidate entity'));
  if (candidates.length !== 4) throw new Error('Question must contain four candidate IDs');
  return candidates as [string, string, string, string];
}

function parseChoiceOrText(source: UnknownRecord, kind: Question['kind']): Question {
  const entityId = requireId(source.entityId, 'Question entity');
  if (source.presentation === 'choice') {
    const candidateEntityIds = parseCandidates(source.candidateEntityIds);
    if (kind === 'associate_capital') {
      return { kind, presentation: 'choice', entityId,
        capitalId: requireId(source.capitalId, 'Question capital'), candidateEntityIds };
    }
    if (kind === 'identify_region' || kind === 'identify_place') {
      return { kind, presentation: 'choice', entityId, candidateEntityIds };
    }
  }
  if (source.presentation === 'text') {
    const answer = parseAnswer(source.answer);
    if (kind === 'associate_capital') {
      return { kind, presentation: 'text', entityId,
        capitalId: requireId(source.capitalId, 'Question capital'), answer };
    }
    if (kind === 'identify_region' || kind === 'identify_place') {
      return { kind, presentation: 'text', entityId, answer };
    }
  }
  throw new Error('Question kind and presentation are incompatible');
}

function parseQuestion(value: unknown): Question {
  const source = record(value, 'question');
  const kind = skill(source.kind, 'Question kind');
  if (kind === 'locate_region') {
    if (source.presentation !== 'map') {
      throw new Error('Question locate-region presentation must be map');
    }
    return { kind, presentation: 'map', entityId: requireId(source.entityId, 'Question entity') };
  }
  if (kind === 'locate_place') {
    if (source.presentation !== 'map') {
      throw new Error('Question locate-place presentation must be map');
    }
    const coordinate = array(source.coordinate, 'Question coordinate');
    if (coordinate.length !== 2) throw new Error('Question coordinate must have two values');
    return { kind, presentation: 'map', entityId: requireId(source.entityId, 'Question entity'),
      coordinate: [finiteNumber(coordinate[0], 'Question longitude'),
        finiteNumber(coordinate[1], 'Question latitude')] };
  }
  return parseChoiceOrText(source, kind);
}

function parseRetryDebt(value: unknown): RetryDebt {
  const source = record(value, 'retry debt');
  return {
    entityId: requireId(source.entityId, 'Retry entity'),
    skill: skill(source.skill, 'Retry skill'),
    sourceQuestionKind: skill(source.sourceQuestionKind, 'Retry source question kind'),
    createdAt: requireTimestamp(source.createdAt, 'Retry created'),
    priority: oneOf(source.priority, ['immediate'] as const, 'Retry priority'),
  };
}

function parseSession(value: unknown): PracticeSession {
  const source = record(value, 'session');
  const introductions = array(source.introductions, 'Session introductions')
    .map((item) => requireId(item, 'Introduction entity'));
  const questions = array(source.questions, 'Session questions').map(parseQuestion);
  const introductionCursor = nonNegativeInteger(source.introductionCursor, 'Introduction cursor');
  const questionCursor = nonNegativeInteger(source.questionCursor, 'Question cursor');
  if (introductionCursor > introductions.length || questionCursor > questions.length) {
    throw new Error('Session cursor exceeds its collection');
  }
  return {
    sessionId: requireId(source.sessionId, 'Session'),
    learnerId: requireId(source.learnerId, 'Learner'),
    request: parseRequest(source.request),
    baseQuestionCount: nonNegativeInteger(source.baseQuestionCount, 'Base question count'),
    introductions, introductionCursor, questions, questionCursor,
    carryoverRetryDebts: array(source.carryoverRetryDebts, 'Session retry debts').map(parseRetryDebt),
    startedAt: requireTimestamp(source.startedAt, 'Started'),
    accumulatedPauseMs: nonNegativeInteger(source.accumulatedPauseMs, 'Accumulated pause duration'),
  };
}

function parseEvent(value: unknown): AttemptEvent {
  const source = record(value, 'attempt');
  const mode = oneOf(source.mode, PRACTICE_MODES, 'Attempt mode');
  const independentCorrect = boolean(source.independentCorrect, 'Independent correct');
  if (mode === 'placement' && independentCorrect) {
    throw new Error('Placement attempts cannot be independently correct');
  }
  const rawAnswerAttemptCount = source.answerAttemptCount;
  if (rawAnswerAttemptCount !== 1 && rawAnswerAttemptCount !== 2) {
    throw new Error('Answer attempt count must be 1 or 2');
  }
  const answerAttemptCount: 1 | 2 = rawAnswerAttemptCount;
  const common = {
    attemptId: requireId(source.attemptId, 'Attempt'),
    sessionId: requireId(source.sessionId, 'Session'),
    learnerId: requireId(source.learnerId, 'Learner'),
    packId: requireId(source.packId, 'Pack'),
    entityId: requireId(source.entityId, 'Entity'),
    skill: skill(source.skill),
    questionKind: skill(source.questionKind, 'Question kind'),
    scheduledReview: boolean(source.scheduledReview, 'Scheduled review'),
    delayedRetry: boolean(source.delayedRetry, 'Delayed retry'),
    answerAttemptCount,
    correct: boolean(source.correct, 'Correct'),
    usedHint: boolean(source.usedHint, 'Used hint'),
    responseMs: nonNegativeInteger(source.responseMs, 'Response duration'),
    completedAt: requireTimestamp(source.completedAt, 'Completed'),
  };
  return mode === 'placement'
    ? { ...common, mode, independentCorrect: false }
    : { ...common, mode, independentCorrect };
}

function parseSettings(value: unknown): AppSettings {
  const source = record(value, 'settings');
  const audio = record(source.audio, 'audio settings');
  const settings = { audio: {
    enabled: boolean(audio.enabled, 'Audio enabled'),
    packId: string(audio.packId, 'Audio pack') as AppSettings['audio']['packId'],
    volume: finiteNumber(audio.volume, 'Audio volume'),
  } };
  validateAppSettings(settings);
  return settings;
}

export class TauriProgressRepository implements ProgressRepository {
  async loadSnapshot(learnerId: string, packId: string): Promise<readonly MasteryRecord[]> {
    const response = await invoke<unknown>('load_progress_snapshot', {
      learnerId: requireId(learnerId, 'Learner'), packId: requireId(packId, 'Pack'),
    });
    return array(response, 'mastery snapshot').map(parseMastery);
  }

  async loadAttemptHistory(learnerId: string, packId: string): Promise<readonly AttemptEvent[]> {
    const response = await invoke<unknown>('load_attempt_history', {
      learnerId: requireId(learnerId, 'Learner'), packId: requireId(packId, 'Pack'),
    });
    return array(response, 'attempt history').map(parseEvent);
  }

  async loadRetryDebts(learnerId: string, packId: string): Promise<readonly RetryDebt[]> {
    const response = await invoke<unknown>('load_retry_debts', {
      learnerId: requireId(learnerId, 'Learner'), packId: requireId(packId, 'Pack'),
    });
    return array(response, 'retry debts').map(parseRetryDebt);
  }

  async saveAttempt(input: Readonly<{ event: AttemptEvent; session: PracticeSession;
    mastery: MasteryRecord }>): Promise<void> {
    await invoke('save_attempt_transaction', { input: {
      event: parseEvent(input.event), session: parseSession(input.session),
      mastery: parseMastery(input.mastery),
    } });
  }

  async saveSession(session: PracticeSession): Promise<void> {
    await invoke('save_practice_session', { session: parseSession(session) });
  }

  async loadResumableSession(learnerId: string, packId: string, now: string): Promise<PracticeSession | null> {
    const response = await invoke<unknown>('load_resumable_session', {
      learnerId: requireId(learnerId, 'Learner'), packId: requireId(packId, 'Pack'),
      now: requireTimestamp(now, 'Current'),
    });
    return response === null ? null : parseSession(response);
  }

  async loadSettings(): Promise<AppSettings> {
    return parseSettings(await invoke<unknown>('load_settings'));
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await invoke('save_settings', { settings: parseSettings(settings) });
  }
}

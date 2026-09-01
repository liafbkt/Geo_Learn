import type { AudioService } from '../audio/AudioService';
import { packCapabilityValues } from '../content/types';
import { generateQuestion, type Question } from '../learning/questions';
import type { Skill } from '../learning/types';
import { InMemoryContentSource } from '../persistence/InMemoryContentSource';
import type { PracticeSession } from '../practice/session';
import {
  UpdateService,
  type DownloadEvent,
  type UpdateHandle,
  type UpdatePort,
} from '../update/UpdateService';
import { planSession, type AppDependencies, type PlanSessionInput } from '../app/App';
import { browserResources } from '../app/dependencies';
import { E2EBackupCommands } from './E2EBackupCommands';
import { E2EProgressRepository } from './E2EProgressRepository';
import type { E2EControl, E2EUpdateScenario } from './types';

const FIXED_NOW = '2026-09-01T00:00:00.000Z';

const silentAudio: AudioService = {
  async preload() {},
  async preview() {},
  async play() {},
  isAvailable: () => true,
};

function controlledQuestion(input: PlanSessionInput, kind: Skill): Question {
  const candidateOrder = input.pack.entities.map(({ id }) => id);
  for (const entity of input.pack.entities) {
    try {
      return generateQuestion({
        pack: input.pack,
        entityId: entity.id,
        skill: kind,
        stage: 'new',
        candidateOrder,
      });
    } catch {
      // Try the next real content entity; generateQuestion remains the authority.
    }
  }
  throw new Error(`The E2E pack cannot generate question kind: ${kind}`);
}

function controlledPlan(input: PlanSessionInput, kinds: readonly Skill[]): PracticeSession {
  const questions = kinds.map((kind) => controlledQuestion(input, kind));
  const first = questions[0];
  return {
    sessionId: input.sessionId,
    learnerId: input.learnerId,
    request: input.request,
    baseQuestionCount: questions.length,
    introductions: input.request.mode === 'smart' && first !== undefined ? [first.entityId] : [],
    introductionCursor: 0,
    questions,
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: input.startedAt,
    accumulatedPauseMs: 0,
  };
}

function createUpdatePort(
  scenario: () => E2EUpdateScenario,
  actions: Array<'check' | 'download' | 'install' | 'close'>,
): UpdatePort {
  return {
    async check(): Promise<UpdateHandle | null> {
      actions.push('check');
      const selected = scenario();
      if (selected.kind === 'error') throw new Error('Injected E2E update failure');
      if (selected.kind === 'up-to-date') return null;
      return {
        metadata: {
          currentVersion: selected.currentVersion,
          version: selected.version,
          notes: selected.notes ?? null,
          date: selected.date ?? null,
        },
        async download(onEvent: (event: DownloadEvent) => void): Promise<void> {
          actions.push('download');
          onEvent({ event: 'Started', data: { contentLength: 100 } });
          onEvent({ event: 'Progress', data: { chunkLength: 100 } });
          onEvent({ event: 'Finished' });
        },
        async install(): Promise<void> { actions.push('install'); },
        async close(): Promise<void> { actions.push('close'); },
      };
    },
  };
}

export function createE2EDependencies(storage: Storage): AppDependencies {
  const repository = new E2EProgressRepository(storage);
  const backupCommands = new E2EBackupCommands(repository, () => FIXED_NOW);
  let nextId = 0;
  let questionKinds: readonly Skill[] = [];
  let updateScenario: E2EUpdateScenario = { kind: 'up-to-date' };
  const updateActions: Array<'check' | 'download' | 'install' | 'close'> = [];

  const control: E2EControl = {
    reset(): void {
      repository.reset();
      backupCommands.setScenario({ kind: 'cancel' });
      nextId = 0;
      questionKinds = [];
      updateScenario = { kind: 'up-to-date' };
      updateActions.splice(0);
    },
    failNextAttemptSave: () => repository.failNextAttemptSave(),
    setQuestionKinds(kinds): void {
      if (!Array.isArray(kinds) || kinds.some((kind) => !packCapabilityValues.includes(kind))) {
        throw new Error('E2E question kinds are invalid');
      }
      questionKinds = [...kinds];
    },
    setBackupScenario: (scenario) => backupCommands.setScenario(scenario),
    setUpdate(scenario): void { updateScenario = structuredClone(scenario); },
    readState: () => structuredClone({
      ...repository.exportState(),
      updateActions,
    }),
  };
  window.__GEOLEARN_E2E__ = control;

  return {
    learnerId: 'local-default',
    contentSource: new InMemoryContentSource(browserResources),
    repository,
    random: { next: () => 0.25 },
    now: () => FIXED_NOW,
    createId: (prefix) => `${prefix}-${++nextId}`,
    planSession: (input) => questionKinds.length === 0
      ? planSession(input)
      : controlledPlan(input, questionKinds),
    audio: silentAudio,
    backupCommands,
    createUpdateService: () => new UpdateService(
      createUpdatePort(() => updateScenario, updateActions),
    ),
  };
}

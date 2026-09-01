import cnEntities from '../../src-tauri/resources/content/cn-provincial-divisions/entities.json';
import cnManifest from '../../src-tauri/resources/content/cn-provincial-divisions/manifest.json';
import cnSources from '../../src-tauri/resources/content/cn-provincial-divisions/sources.json';
import cnTopologyText from '../../src-tauri/resources/content/cn-provincial-divisions/map.topojson?raw';
import shEntities from '../../src-tauri/resources/content/cn-shanghai-districts/entities.json';
import shManifest from '../../src-tauri/resources/content/cn-shanghai-districts/manifest.json';
import shSources from '../../src-tauri/resources/content/cn-shanghai-districts/sources.json';
import shTopologyText from '../../src-tauri/resources/content/cn-shanghai-districts/map.topojson?raw';
import usEntities from '../../src-tauri/resources/content/us-states/entities.json';
import usManifest from '../../src-tauri/resources/content/us-states/manifest.json';
import usSources from '../../src-tauri/resources/content/us-states/sources.json';
import usTopologyText from '../../src-tauri/resources/content/us-states/map.topojson?raw';
import { WebAudioService } from '../audio/WebAudioService';
import { InMemoryContentSource, type InMemoryContentResources } from '../persistence/InMemoryContentSource';
import { InMemoryProgressRepository } from '../persistence/InMemoryProgressRepository';
import { TauriContentSource } from '../persistence/TauriContentSource';
import { TauriProgressRepository } from '../persistence/TauriProgressRepository';
import { createTauriUpdatePort } from '../update/TauriUpdatePort';
import { UpdateService } from '../update/UpdateService';
import { planSession, type AppDependencies } from './App';
import { tauriBackupCommands, type BackupCommands, type BackupSummary } from './DataManagementScreen';

const learnerId = 'local-default';

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function shared(input: Pick<AppDependencies, 'contentSource' | 'repository' | 'backupCommands' | 'createUpdateService'>): AppDependencies {
  return {
    learnerId,
    ...input,
    random: { next: () => Math.random() },
    now: () => new Date().toISOString(),
    createId,
    planSession,
    audio: new WebAudioService(),
  };
}

export function createTauriDependencies(): AppDependencies {
  return shared({
    contentSource: new TauriContentSource(),
    repository: new TauriProgressRepository(),
    backupCommands: tauriBackupCommands,
    createUpdateService: () => new UpdateService(createTauriUpdatePort()),
  });
}

export const browserResources: InMemoryContentResources = {
  'cn-provincial-divisions': {
    'manifest.json': cnManifest,
    'entities.json': cnEntities,
    'sources.json': cnSources,
    'map.topojson': JSON.parse(cnTopologyText) as unknown,
  },
  'cn-shanghai-districts': {
    'manifest.json': shManifest,
    'entities.json': shEntities,
    'sources.json': shSources,
    'map.topojson': JSON.parse(shTopologyText) as unknown,
  },
  'us-states': {
    'manifest.json': usManifest,
    'entities.json': usEntities,
    'sources.json': usSources,
    'map.topojson': JSON.parse(usTopologyText) as unknown,
  },
};

function browserBackupCommands(): BackupCommands {
  let staged: BackupSummary | null = null;
  return {
    async exportBackup() { return '空间记忆教练备份.geolearn-backup'; },
    async inspectBackup() {
      staged = {
        stagingId: 'browser-staging',
        exportedAt: '2026-09-01T00:00:00.000Z',
        learnerId,
        packVersions: {},
        masteryCount: 0,
        attemptCount: 0,
        sessionCount: 0,
        includesSettings: true,
      };
      return staged;
    },
    async importBackup(input) {
      if (staged === null || input.stagingId !== staged.stagingId) throw new Error('Backup staging expired');
      staged = null;
    },
  };
}

/** Browser/Playwright harness: real domain logic with injected memory adapters. */
export function createBrowserDependencies(): AppDependencies {
  return shared({
    contentSource: new InMemoryContentSource(browserResources),
    repository: new InMemoryProgressRepository(),
    backupCommands: browserBackupCommands(),
    createUpdateService: () => new UpdateService({ check: async () => null }),
  });
}

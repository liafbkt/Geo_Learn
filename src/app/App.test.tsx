import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
import type { AudioService } from '../audio/AudioService';
import type { AttemptEvent } from '../learning/types';
import { InMemoryContentSource, type InMemoryContentResources } from '../persistence/InMemoryContentSource';
import { InMemoryProgressRepository } from '../persistence/InMemoryProgressRepository';
import type { ProgressRepository } from '../persistence/ProgressRepository';
import type { PendingAttempt } from '../practice/reducer';
import type { PracticeSession } from '../practice/session';
import { UpdateService, type UpdateHandle, type UpdateMetadata } from '../update/UpdateService';
import { App, type AppDependencies, type PlanSessionInput } from './App';

const launchResources: InMemoryContentResources = {
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

class SilentAudioService implements AudioService {
  async preload(): Promise<void> {}
  async preview(): Promise<void> {}
  async play(): Promise<void> {}
  isAvailable(): boolean { return true; }
}

class FlakyProgressRepository extends InMemoryProgressRepository {
  failNextAttempt = false;
  saveAttemptCalls = 0;

  override async saveAttempt(input: PendingAttempt): Promise<void> {
    this.saveAttemptCalls += 1;
    if (this.failNextAttempt) {
      this.failNextAttempt = false;
      throw Object.assign(new Error('disk full'), { code: 'DATABASE_WRITE_FAILED' });
    }
    await super.saveAttempt(input);
  }
}

class HistoricalProgressRepository extends InMemoryProgressRepository {
  constructor(private readonly history: readonly AttemptEvent[]) { super(); }
  override async loadAttemptHistory(learnerId: string, packId: string): Promise<readonly AttemptEvent[]> {
    return this.history.filter((event) => event.learnerId === learnerId && event.packId === packId);
  }
}

function historicalAttempt(index: number, completedAt: string, correct = true): AttemptEvent {
  return {
    attemptId: `history-${index}`, sessionId: 'history-session', learnerId: 'local-test-user',
    packId: 'us-states', entityId: 'us-ca', skill: 'locate_region', questionKind: 'locate_region',
    scheduledReview: index >= 3, delayedRetry: false, answerAttemptCount: correct ? 1 : 2,
    correct, usedHint: !correct, responseMs: 1_000, completedAt, mode: 'smart',
    independentCorrect: correct,
  };
}

function fixedSession(input: PlanSessionInput): PracticeSession {
  const questions = [
    { kind: 'locate_region', presentation: 'map', entityId: 'us-ca' },
    { kind: 'locate_region', presentation: 'map', entityId: 'us-ny' },
    { kind: 'locate_region', presentation: 'map', entityId: 'us-fl' },
    { kind: 'locate_region', presentation: 'map', entityId: 'us-wa' },
    { kind: 'locate_region', presentation: 'map', entityId: 'us-tx' },
    { kind: 'locate_region', presentation: 'map', entityId: 'us-ak' },
  ] as const;
  return {
    sessionId: input.sessionId,
    learnerId: input.learnerId,
    request: input.request,
    baseQuestionCount: questions.length,
    introductions: input.request.mode === 'smart' ? ['us-ca'] : [],
    introductionCursor: 0,
    questions,
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: input.startedAt,
    accumulatedPauseMs: 0,
  };
}

function dependencies(input: Readonly<{
  repository?: ProgressRepository;
  resources?: InMemoryContentResources;
  update?: UpdateMetadata | null;
  updateActions?: Readonly<{
    download: () => Promise<void>;
    install: () => Promise<void>;
  }>;
  planSession?: AppDependencies['planSession'];
}> = {}): AppDependencies {
  let id = 0;
  const metadata = input.update ?? null;
  return {
    learnerId: 'local-test-user',
    contentSource: new InMemoryContentSource(input.resources ?? launchResources),
    repository: input.repository ?? new InMemoryProgressRepository(),
    random: { next: () => 0.25 },
    now: () => '2026-09-01T01:00:00.000Z',
    createId: (prefix) => `${prefix}-${++id}`,
    planSession: input.planSession ?? fixedSession,
    audio: new SilentAudioService(),
    backupCommands: {
      exportBackup: async () => '空间记忆教练备份.geolearn-backup',
      inspectBackup: async () => null,
      importBackup: async () => undefined,
    },
    createUpdateService: () => new UpdateService({
      async check(): Promise<UpdateHandle | null> {
        return metadata === null ? null : {
          metadata,
          download: input.updateActions?.download ?? (async () => undefined),
          install: input.updateActions?.install ?? (async () => undefined),
          close: async () => undefined,
        };
      },
    }),
  };
}

function withinCard(card: Element, buttonName: string): HTMLButtonElement {
  const button = [...card.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === buttonName);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing button: ${buttonName}`);
  return button;
}

async function openUsSmartPractice(user: ReturnType<typeof userEvent.setup>) {
  const usCard = (await screen.findByRole('heading', { name: '美国50州与州府' })).closest('article');
  if (usCard === null) throw new Error('US pack card is missing');
  await user.click(withinCard(usCard, '智能练习'));
  await user.click(screen.getByRole('button', { name: '跳过摸底，开始练习' }));
  await user.click(await screen.findByRole('button', { name: '继续认识' }));
}

it('loads all three launch packs, isolates a bad pack, and checks updates only on request', async () => {
  const user = userEvent.setup();
  const download = vi.fn(async () => undefined);
  const install = vi.fn(async () => undefined);
  const resources: InMemoryContentResources = {
    ...launchResources,
    broken: { 'manifest.json': { packId: 'broken' } },
  };
  render(<App dependencies={dependencies({
    resources,
    update: { currentVersion: '0.1.0', version: '0.2.0', notes: '离线内容改进', date: null },
    updateActions: { download, install },
  })} />);

  expect(await screen.findByRole('heading', { name: '选择学习范围' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '中国省级行政区' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '上海行政区' })).toBeVisible();
  expect(screen.getByRole('heading', { name: '美国50州与州府' })).toBeVisible();
  expect(screen.getByText('1 个内容包未加载，其他内容仍可使用。')).toBeVisible();
  expect(screen.queryByText('发现新版本 0.2.0')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '检查更新' }));
  expect(await screen.findByText('发现新版本 0.2.0')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '下载更新' }));
  expect(await screen.findByText('更新已下载并通过校验')).toBeVisible();
  expect(download).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('button', { name: '安装更新' }));
  expect(await screen.findByText('安装程序已启动')).toBeVisible();
  expect(install).toHaveBeenCalledOnce();
});

it('can skip placement, introduces a new place, and keeps feedback locked until a failed save is retried', async () => {
  const user = userEvent.setup();
  const repository = new FlakyProgressRepository();
  repository.failNextAttempt = true;
  render(<App dependencies={dependencies({
    repository,
    update: { currentVersion: '0.1.0', version: '0.2.0', notes: null, date: null },
  })} />);

  await openUsSmartPractice(user);
  expect(screen.queryByRole('button', { name: '下载更新' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /在地图上找到.*California/i })).toBeVisible();
  await user.click(screen.getByRole('option', { name: /Texas/i }));
  await user.click(screen.getByRole('button', { name: '检查答案' }));
  expect(screen.getByText('再试一次')).toBeVisible();
  expect(screen.queryByText(/California \/ 加利福尼亚/)).not.toBeInTheDocument();

  await user.click(screen.getByRole('option', { name: /Texas/i }));
  await user.click(screen.getByRole('button', { name: '检查答案' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('保存失败');
  expect(screen.getByRole('button', { name: '继续' })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: '重试保存' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '继续' })).toBeEnabled());
  expect(repository.saveAttemptCalls).toBe(2);
});

it('restores carryover retry debts and passes them into the next smart scheduler', async () => {
  const user = userEvent.setup();
  const repository = new InMemoryProgressRepository();
  const seed = fixedSession({
    pack: {} as PlanSessionInput['pack'],
    request: { mode: 'smart', packId: 'us-states' },
    learnerId: 'local-test-user',
    sessionId: 'previous-session',
    startedAt: '2026-09-01T00:00:00.000Z',
    masteryRecords: [],
    fragileKeys: [],
    retryDebts: [],
    random: { next: () => 0.25 },
  });
  const debt = {
    entityId: 'us-ca', skill: 'locate_region', sourceQuestionKind: 'locate_region',
    createdAt: '2026-09-01T00:30:00.000Z', priority: 'immediate',
  } as const;
  await repository.saveSession({
    ...seed,
    introductions: [],
    introductionCursor: 0,
    questionCursor: seed.questions.length,
    carryoverRetryDebts: [debt],
  });
  const planner = vi.fn(fixedSession);
  const deps = dependencies({ repository, planSession: planner });
  const first = render(<App dependencies={deps} />);

  const usCard = (await screen.findByRole('heading', { name: '美国50州与州府' })).closest('article');
  if (usCard === null) throw new Error('US pack card is missing');
  await user.click(withinCard(usCard, '智能练习'));
  await user.click(screen.getByRole('button', { name: '开始摸底' }));
  first.unmount();

  render(<App dependencies={deps} />);
  const restoredCard = (await screen.findByRole('heading', { name: '美国50州与州府' })).closest('article');
  if (restoredCard === null) throw new Error('US pack card is missing after placement');
  await user.click(withinCard(restoredCard, '智能练习'));
  await user.click(screen.getByRole('button', { name: '跳过摸底，开始练习' }));

  expect(planner).toHaveBeenLastCalledWith(expect.objectContaining({ retryDebts: [debt] }));
});

it('reconstructs the fragile index from persisted attempt history', async () => {
  const repository = new HistoricalProgressRepository([
    historicalAttempt(0, '2026-07-01T00:00:00.000Z'),
    historicalAttempt(1, '2026-07-02T00:00:00.000Z'),
    historicalAttempt(2, '2026-07-03T00:00:00.000Z'),
    historicalAttempt(3, '2026-08-05T00:00:00.000Z', false),
    historicalAttempt(4, '2026-08-20T00:00:00.000Z', false),
  ]);
  render(<App dependencies={dependencies({ repository })} />);

  const usCard = (await screen.findByRole('heading', { name: '美国50州与州府' })).closest('article');
  if (usCard === null) throw new Error('US pack card is missing');
  const fragileValue = [...usCard.querySelectorAll('dt')]
    .find((term) => term.textContent === '易忘')?.nextElementSibling;
  expect(fragileValue).toHaveTextContent('1');
});

it('restores an unfinished session after the app is mounted again with the same repository', async () => {
  const user = userEvent.setup();
  const repository = new InMemoryProgressRepository();
  const deps = dependencies({ repository });
  const first = render(<App dependencies={deps} />);
  const usCard = (await screen.findByRole('heading', { name: '美国50州与州府' })).closest('article');
  if (usCard === null) throw new Error('US pack card is missing');
  await user.click(withinCard(usCard, '智能练习'));
  await user.click(screen.getByRole('button', { name: '跳过摸底，开始练习' }));
  expect(await screen.findByText('认识 1/1')).toBeVisible();
  first.unmount();

  render(<App dependencies={deps} />);
  const resumedCard = (await screen.findByRole('heading', { name: '美国50州与州府' })).closest('article');
  if (resumedCard === null) throw new Error('US pack card is missing after restart');
  expect(withinCard(resumedCard, '继续上次练习')).toBeEnabled();
});

it('routes home data management through the injected backup adapter', async () => {
  const user = userEvent.setup();
  render(<App dependencies={dependencies()} />);
  await user.click(await screen.findByRole('button', { name: '数据管理' }));
  expect(screen.getByRole('heading', { name: '数据管理' })).toHaveFocus();
  await user.click(screen.getByRole('button', { name: '导出备份' }));
  expect(await screen.findByRole('status')).toHaveTextContent('空间记忆教练备份.geolearn-backup');
});

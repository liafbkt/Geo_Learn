import { useEffect, useMemo, useRef, useState } from 'react';

import type { AudioService } from '../audio/AudioService';
import { loadAvailablePacks, type RejectedPack } from '../content/loadPacks';
import type { ContentSource } from '../content/ContentSource';
import type { ContentPack, Entity, PackCapability } from '../content/types';
import { ExploreScreen } from '../explore/ExploreScreen';
import { isFragile } from '../learning/fragile';
import { generateQuestion, type Question } from '../learning/questions';
import { masteryKey, schedulePlacement, scheduleSmartSession, type RandomSource } from '../learning/scheduler';
import type { AttemptEvent, MasteryRecord, MasteryStage } from '../learning/types';
import { projectMap } from '../map/project';
import type { ProjectedMap } from '../map/types';
import type { ProgressRepository } from '../persistence/ProgressRepository';
import { createPracticeState, type PracticeState } from '../practice/reducer';
import { CustomPracticeForm } from '../practice/CustomPracticeForm';
import { PracticeScreen, type PracticeCompletion } from '../practice/PracticeScreen';
import { SessionSummary } from '../practice/SessionSummary';
import type { PracticeSession, RetryDebt, SessionRequest } from '../practice/session';
import type { UpdateService, UpdateState } from '../update/UpdateService';
import { DataManagementScreen, type BackupCommands } from './DataManagementScreen';
import { HomeScreen } from './HomeScreen';
import { DEFAULT_APP_SETTINGS, type AppSettings } from './settings';
import { markGeoPerformance } from './performance';
import '../ui/tokens.css';
import '../ui/global.css';

const MAP_SIZE = { width: 1200, height: 800 } as const;

export type PlanSessionInput = Readonly<{
  pack: ContentPack;
  request: SessionRequest;
  learnerId: string;
  sessionId: string;
  startedAt: string;
  masteryRecords: readonly MasteryRecord[];
  fragileKeys: readonly string[];
  retryDebts: readonly RetryDebt[];
  random: RandomSource;
}>;

export type AppDependencies = Readonly<{
  learnerId: string;
  contentSource: ContentSource;
  repository: ProgressRepository;
  random: RandomSource;
  now: () => string;
  createId: (prefix: string) => string;
  planSession: (input: PlanSessionInput) => PracticeSession;
  audio: AudioService;
  backupCommands: BackupCommands;
  createUpdateService: () => UpdateService;
}>;

type PackRuntime = Readonly<{
  pack: ContentPack;
  map: ProjectedMap;
  masteryRecords: readonly MasteryRecord[];
  fragileKeys: readonly string[];
  attemptHistory: readonly AttemptEvent[];
  retryDebts: readonly RetryDebt[];
  resumableSession: PracticeSession | null;
}>;

type SummaryRoute = Readonly<{
  kind: 'summary';
  runtime: PackRuntime;
  attempts: PracticeCompletion['attempts'];
  masteryBefore: readonly MasteryRecord[];
  masteryAfter: readonly MasteryRecord[];
  introducedEntityIds: readonly string[];
  fragileKeysBefore: readonly string[];
}>;

type Route =
  | Readonly<{ kind: 'boot' }>
  | Readonly<{ kind: 'home' }>
  | Readonly<{ kind: 'start'; packId: string }>
  | Readonly<{ kind: 'custom'; packId: string }>
  | Readonly<{ kind: 'explore'; packId: string }>
  | Readonly<{ kind: 'data' }>
  | Readonly<{ kind: 'practice'; runtime: PackRuntime; initialState: PracticeState; masteryBefore: readonly MasteryRecord[] }>
  | SummaryRoute;

const stageWeight: Readonly<Record<MasteryStage, number>> = {
  new: 0,
  learning: 20,
  weak: 40,
  familiar: 60,
  solid: 80,
  mastered: 100,
};

function entitySupports(pack: ContentPack, entity: Entity, skill: PackCapability): boolean {
  if (entity.capabilities !== undefined && !entity.capabilities.includes(skill)) return false;
  if (entity.kind === 'region') {
    if (skill === 'locate_region' || skill === 'identify_region') return pack.topologyObjectIds.includes(entity.id);
    return skill === 'associate_capital' && entity.capitalId !== undefined;
  }
  return skill === 'locate_place' || skill === 'identify_place';
}

function customSession(input: PlanSessionInput): PracticeSession {
  if (input.request.mode !== 'custom') throw new Error('Expected a custom session request');
  const request = input.request;
  const records = new Map(input.masteryRecords.map((record) => [masteryKey(record.entityId, record.skill), record]));
  const fragile = new Set(input.fragileKeys);
  const candidates = request.entityIds.flatMap((entityId) =>
    request.skills.flatMap((skill) => {
          const entity = input.pack.entities.find((item) => item.id === entityId);
          if (entity === undefined || !entitySupports(input.pack, entity, skill)) return [];
          const record = records.get(masteryKey(entityId, skill));
          const stage = record?.stage ?? 'new';
          if (request.statuses.length > 0 &&
            !request.statuses.includes(stage) &&
            !(request.statuses.includes('fragile') && fragile.has(masteryKey(entityId, skill)))) return [];
          try {
            return [generateQuestion({
              pack: input.pack,
              entityId,
              skill,
              stage,
              candidateOrder: input.pack.entities.map((item) => item.id),
            })];
          } catch { return []; }
        }),
  );
  if (candidates.length === 0) throw new Error('自定义条件没有可用题目。');
  const questions = Array.from({ length: request.questionCount }, (_, index) =>
    candidates[index % candidates.length]).filter((question): question is Question => question !== undefined);
  return {
    sessionId: input.sessionId,
    learnerId: input.learnerId,
    request: input.request,
    baseQuestionCount: questions.length,
    introductions: [],
    introductionCursor: 0,
    questions,
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: input.startedAt,
    accumulatedPauseMs: 0,
  };
}

export function planSession(input: PlanSessionInput): PracticeSession {
  if (input.request.mode === 'placement') {
    return schedulePlacement({
      pack: input.pack,
      learnerId: input.learnerId,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      random: input.random,
    });
  }
  if (input.request.mode === 'smart') {
    return scheduleSmartSession({
      pack: input.pack,
      learnerId: input.learnerId,
      sessionId: input.sessionId,
      startedAt: input.startedAt,
      masteryRecords: input.masteryRecords,
      fragileKeys: input.fragileKeys,
      retryDebts: input.retryDebts,
      random: input.random,
    });
  }
  return customSession(input);
}

function ensureMastery(
  packId: string,
  learnerId: string,
  session: PracticeSession,
  records: readonly MasteryRecord[],
  now: string,
): readonly MasteryRecord[] {
  const result = [...records];
  const keys = new Set(result.map((record) => masteryKey(record.entityId, record.skill)));
  for (const question of session.questions) {
    const key = masteryKey(question.entityId, question.kind);
    if (keys.has(key)) continue;
    result.push({
      learnerId,
      packId,
      entityId: question.entityId,
      skill: question.kind,
      stage: 'new',
      scheduledIntervalMs: 0,
      dueAt: now,
      smoothedResponseMs: null,
      updatedAt: now,
    });
    keys.add(key);
  }
  return result;
}

function retryVariations(pack: ContentPack, session: PracticeSession): readonly Question[] {
  return session.questions.flatMap((question) => {
    try {
      return [generateQuestion({
        pack,
        entityId: question.entityId,
        skill: question.kind,
        stage: 'weak',
        candidateOrder: pack.entities.map((entity) => entity.id),
      })];
    } catch { return []; }
  });
}

function createState(runtime: PackRuntime, session: PracticeSession, learnerId: string, now: string): PracticeState {
  const masteryRecords = ensureMastery(runtime.pack.manifest.packId, learnerId, session, runtime.masteryRecords, now);
  const coordinates = [
    ...runtime.map.regions.map((region) => ({ entityId: region.entityId, coordinate: region.centroid })),
    ...runtime.map.places.map((place) => ({ entityId: place.entityId, coordinate: place.point })),
  ];
  return createPracticeState({
    session,
    masteryRecords,
    presentedAt: now,
    retryVariations: retryVariations(runtime.pack, session),
    retryRandomValue: 0.25,
    mapCoordinates: coordinates,
  });
}

function masteryPercent(records: readonly MasteryRecord[]): number {
  if (records.length === 0) return 0;
  return records.reduce((sum, record) => sum + stageWeight[record.stage], 0) / records.length;
}

function fragileKeys(attempts: readonly AttemptEvent[], now: string): readonly string[] {
  const histories = new Map<string, AttemptEvent[]>();
  for (const attempt of attempts) {
    const key = masteryKey(attempt.entityId, attempt.skill);
    const history = histories.get(key) ?? [];
    history.push(attempt);
    histories.set(key, history);
  }
  return [...histories]
    .filter(([, history]) => isFragile(history, now))
    .map(([key]) => key)
    .sort();
}

function UpdateBanner({ service, state }: Readonly<{ service: UpdateService; state: UpdateState }>) {
  if (state.status === 'disposed') return null;
  return (
    <aside className="update-banner" aria-live="polite">
      {state.status === 'idle' ? <button type="button" onClick={() => void service.check()}>检查更新</button> : null}
      {state.status === 'checking' ? <span>正在后台检查更新…</span> : null}
      {state.status === 'upToDate' ? <><span>已是最新版本</span><button type="button" onClick={() => void service.check()}>重新检查</button></> : null}
      {state.status === 'available' ? <><strong>发现新版本 {state.update.version}</strong><button type="button" onClick={() => void service.download()}>下载更新</button></> : null}
      {state.status === 'downloading' ? <span>正在下载更新{state.percent === null ? '…' : ` ${Math.round(state.percent)}%`}</span> : null}
      {state.status === 'ready' ? <><strong>更新已下载并通过校验</strong><button type="button" onClick={() => void service.install()}>安装更新</button></> : null}
      {state.status === 'installing' ? <span>正在启动安装程序…</span> : null}
      {state.status === 'installationRequested' ? <span>安装程序已启动</span> : null}
      {state.status === 'error' ? <><span>{state.message} 学习功能不受影响。</span><button type="button" onClick={() => void service.retry()}>重新检查</button></> : null}
    </aside>
  );
}

export function App({ dependencies }: Readonly<{ dependencies: AppDependencies }>) {
  const [route, setRoute] = useState<Route>({ kind: 'boot' });
  const [packs, setPacks] = useState<readonly PackRuntime[]>([]);
  const [rejected, setRejected] = useState<readonly RejectedPack[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [updateService] = useState(() => dependencies.createUpdateService());
  const [updateState, setUpdateState] = useState<UpdateState>(() => updateService.getState());
  const updateLifecycle = useRef(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [available, loadedSettings] = await Promise.all([
          loadAvailablePacks(dependencies.contentSource),
          dependencies.repository.loadSettings(),
        ]);
        const runtimes: readonly (PackRuntime | null)[] = await Promise.all(available.available.map(async (pack) => {
          const [topology, masteryRecords, attemptHistory, retryDebts, resumableSession] = await Promise.all([
            dependencies.contentSource.readJson(pack.manifest.packId, 'map.topojson'),
            dependencies.repository.loadSnapshot(dependencies.learnerId, pack.manifest.packId),
            dependencies.repository.loadAttemptHistory(dependencies.learnerId, pack.manifest.packId),
            dependencies.repository.loadRetryDebts(dependencies.learnerId, pack.manifest.packId),
            dependencies.repository.loadResumableSession(dependencies.learnerId, pack.manifest.packId, dependencies.now()),
          ]);
          const projected = projectMap(pack, topology, MAP_SIZE);
          return projected.ok
            ? { pack, map: projected.map, masteryRecords, fragileKeys: fragileKeys(attemptHistory, dependencies.now()), attemptHistory, retryDebts, resumableSession }
            : null;
        }));
        if (!active) return;
        const ready = runtimes.filter((runtime): runtime is PackRuntime => runtime !== null);
        setPacks(ready);
        setRejected(available.rejected);
        setSettings(loadedSettings);
        if (ready.length === 0) setStartupError('没有可用的本地内容包。请重新安装应用。');
        else setRoute({ kind: 'home' });
      } catch {
        if (active) setStartupError('本地学习数据未能加载。请重启应用。');
      }
    };
    void load();
    return () => { active = false; };
  }, [dependencies]);

  useEffect(() => {
    const generation = ++updateLifecycle.current;
    const unsubscribe = updateService.subscribe(setUpdateState);
    return () => {
      unsubscribe();
      queueMicrotask(() => { if (updateLifecycle.current === generation) void updateService.dispose(); });
    };
  }, [updateService]);

  useEffect(() => {
    if (route.kind === 'home') markGeoPerformance('geo:home-ready');
  }, [route.kind]);

  useEffect(() => {
    void dependencies.audio.preload(settings.audio.packId);
  }, [dependencies.audio, settings.audio.packId]);

  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('main h1');
    if (heading === null) return;
    heading.tabIndex = -1;
    heading.focus();
  }, [route]);

  const runtime = (packId: string) => packs.find((candidate) => candidate.pack.manifest.packId === packId);
  const refreshData = async (goHome: boolean) => {
    const refreshed = await Promise.all(packs.map(async (item) => ({
      ...item,
      ...await (async () => {
        const [masteryRecords, attemptHistory, retryDebts, resumableSession] = await Promise.all([
          dependencies.repository.loadSnapshot(dependencies.learnerId, item.pack.manifest.packId),
          dependencies.repository.loadAttemptHistory(dependencies.learnerId, item.pack.manifest.packId),
          dependencies.repository.loadRetryDebts(dependencies.learnerId, item.pack.manifest.packId),
          dependencies.repository.loadResumableSession(dependencies.learnerId, item.pack.manifest.packId, dependencies.now()),
        ]);
        return { masteryRecords, attemptHistory, retryDebts, resumableSession,
          fragileKeys: fragileKeys(attemptHistory, dependencies.now()) };
      })(),
    })));
    setPacks(refreshed);
    setSettings(await dependencies.repository.loadSettings());
    if (goHome) setRoute({ kind: 'home' });
  };

  const refreshHome = () => refreshData(true);

  const beginSession = async (request: SessionRequest, existing?: PracticeSession) => {
    const selected = runtime(request.packId);
    if (selected === undefined || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const startedAt = dependencies.now();
      const plannedSession = existing ?? dependencies.planSession({
        pack: selected.pack,
        request,
        learnerId: dependencies.learnerId,
        sessionId: dependencies.createId('session'),
        startedAt,
        masteryRecords: selected.masteryRecords,
        fragileKeys: selected.fragileKeys,
        retryDebts: selected.retryDebts,
        random: dependencies.random,
      });
      const session = existing === undefined && request.mode !== 'smart' && selected.retryDebts.length > 0
        ? { ...plannedSession, carryoverRetryDebts: selected.retryDebts }
        : plannedSession;
      if (session.questions.length === 0) throw new Error('没有符合条件的练习题。');
      if (existing === undefined) await dependencies.repository.saveSession(session);
      setRoute({
        kind: 'practice',
        runtime: selected,
        initialState: createState(selected, session, dependencies.learnerId, startedAt),
        masteryBefore: selected.masteryRecords,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '练习未能开始，请重试。');
    } finally { setBusy(false); }
  };

  const completePractice = (practiceRoute: Extract<Route, { kind: 'practice' }>, completion: PracticeCompletion) => {
    const attemptsById = new Map(practiceRoute.runtime.attemptHistory.map((attempt) => [attempt.attemptId, attempt]));
    for (const attempt of completion.attempts) attemptsById.set(attempt.attemptId, attempt);
    const attemptHistory = [...attemptsById.values()];
    const updatedRuntime = {
      ...practiceRoute.runtime,
      masteryRecords: completion.masteryAfter,
      attemptHistory,
      fragileKeys: fragileKeys(attemptHistory, dependencies.now()),
      retryDebts: completion.session.carryoverRetryDebts,
      resumableSession: null,
    };
    setPacks((current) => current.map((item) => item.pack.manifest.packId === updatedRuntime.pack.manifest.packId ? updatedRuntime : item));
    setRoute({
      kind: 'summary',
      runtime: updatedRuntime,
      attempts: completion.attempts,
      masteryBefore: practiceRoute.masteryBefore,
      masteryAfter: completion.masteryAfter,
      introducedEntityIds: completion.session.introductions,
      fragileKeysBefore: practiceRoute.runtime.fragileKeys,
    });
  };

  const homeModels = useMemo(() => packs.map((item) => ({
    packId: item.pack.manifest.packId,
    title: item.pack.manifest.title,
    overallMastery: masteryPercent(item.masteryRecords),
    dueCount: item.masteryRecords.filter((record) => Date.parse(record.dueAt) <= Date.parse(dependencies.now())).length,
    fragileCount: item.fragileKeys.length,
    resumableSession: item.resumableSession,
  })), [dependencies, packs]);

  let content;
  if (startupError !== null) content = <main className="app-message"><h1>无法启动学习</h1><p role="alert">{startupError}</p></main>;
  else if (route.kind === 'boot') content = <main className="app-message"><p role="status">正在加载本地内容…</p></main>;
  else if (route.kind === 'home') content = <HomeScreen packs={homeModels} onResume={(session) => void beginSession(session.request, session)} onStartSmart={(packId) => setRoute({ kind: 'start', packId })} onStartCustom={(packId) => setRoute({ kind: 'custom', packId })} onExplore={(packId) => setRoute({ kind: 'explore', packId })} onOpenDataManagement={() => setRoute({ kind: 'data' })} />;
  else if (route.kind === 'data') content = <DataManagementScreen learnerId={dependencies.learnerId} commands={dependencies.backupCommands} onImported={() => refreshData(false)} onBack={() => setRoute({ kind: 'home' })} />;
  else if (route.kind === 'start') {
    const selected = runtime(route.packId);
    content = selected === undefined ? null : <main className="start-choice"><p className="product-kicker">{selected.pack.manifest.title.zh}</p><h1>从哪里开始？</h1><p>摸底有 12 题，只用于安排起点；也可以直接跳过。</p><div><button type="button" className="product-button product-button--secondary" disabled={busy} onClick={() => void beginSession({ mode: 'placement', packId: route.packId })}>开始摸底</button><button type="button" className="product-button product-button--primary" disabled={busy} onClick={() => void beginSession({ mode: 'smart', packId: route.packId })}>跳过摸底，开始练习</button><button type="button" className="product-button product-button--quiet" onClick={() => setRoute({ kind: 'home' })}>返回首页</button></div></main>;
  } else if (route.kind === 'custom') {
    const selected = runtime(route.packId);
    content = selected === undefined ? null : <CustomPracticeForm pack={selected.pack} fragileKeys={selected.fragileKeys} onSubmit={(request) => void beginSession(request)} onCancel={() => setRoute({ kind: 'home' })} />;
  } else if (route.kind === 'explore') {
    const selected = runtime(route.packId);
    content = selected === undefined ? null : <ExploreScreen pack={selected.pack} map={selected.map} masteryRecords={selected.masteryRecords} fragileKeys={selected.fragileKeys} onStartPractice={(request) => void beginSession(request)} onBack={() => setRoute({ kind: 'home' })} />;
  } else if (route.kind === 'practice') content = <PracticeScreen initialState={route.initialState} initialAttempts={route.runtime.attemptHistory.filter((attempt) => attempt.sessionId === route.initialState.session.sessionId)} pack={route.runtime.pack} map={route.runtime.map} repository={dependencies.repository} audio={dependencies.audio} settings={settings} now={dependencies.now} onSettingsChange={setSettings} onHome={() => void refreshHome()} onComplete={(completion) => completePractice(route, completion)} />;
  else content = <SessionSummary packId={route.runtime.pack.manifest.packId} attempts={route.attempts} masteryBefore={route.masteryBefore} masteryAfter={route.masteryAfter} introducedEntityIds={route.introducedEntityIds} fragileKeysBefore={route.fragileKeysBefore} fragileKeysAfter={route.runtime.fragileKeys} onPracticeWeaknesses={(request) => void beginSession(request)} onHome={() => void refreshHome()} />;

  const updateActionsVisible = route.kind === 'home' || route.kind === 'summary';
  return <>{content}{route.kind === 'home' && rejected.length > 0 ? <p className="pack-warning" role="status">{rejected.length} 个内容包未加载，其他内容仍可使用。</p> : null}{actionError === null ? null : <p className="app-action-error" role="alert">{actionError}</p>}{updateActionsVisible ? <UpdateBanner service={updateService} state={updateState} /> : null}</>;
}

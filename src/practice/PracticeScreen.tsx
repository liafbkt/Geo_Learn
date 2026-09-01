import { useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { AudioService } from '../audio/AudioService';
import type { ContentPack, Entity } from '../content/types';
import type { Hint } from '../learning/hints';
import type { AttemptEvent, MasteryRecord } from '../learning/types';
import { MapViewport } from '../map/MapViewport';
import type { MapSelection, ProjectedMap } from '../map/types';
import type { ProgressRepository } from '../persistence/ProgressRepository';
import { OptionsPanel } from '../app/OptionsPanel';
import { PauseDialog } from '../app/PauseDialog';
import type { AppSettings } from '../app/settings';
import { commitCurrentAttempt, type PracticeAction } from './actions';
import { practiceReducer, type PracticeState } from './reducer';
import { canContinue, canLeavePractice, canRetrySave, canSubmitAnswer } from './selectors';

const directionLabels = {
  north: '北边',
  'north-east': '东北边',
  east: '东边',
  'south-east': '东南边',
  south: '南边',
  'south-west': '西南边',
  west: '西边',
  'north-west': '西北边',
} as const;

export type PracticeCompletion = Readonly<{
  attempts: readonly AttemptEvent[];
  masteryAfter: readonly MasteryRecord[];
  session: PracticeState['session'];
}>;

export type PracticeScreenProps = Readonly<{
  initialState: PracticeState;
  initialAttempts?: readonly AttemptEvent[];
  pack: ContentPack;
  map: ProjectedMap;
  repository: ProgressRepository;
  audio: AudioService;
  settings: AppSettings;
  now: () => string;
  onSettingsChange: (settings: AppSettings) => void;
  onHome: () => void;
  onComplete: (completion: PracticeCompletion) => void;
}>;

function entityById(pack: ContentPack, entityId: string): Entity {
  const entity = pack.entities.find((candidate) => candidate.id === entityId);
  if (entity === undefined) throw new Error(`Missing practice entity: ${entityId}`);
  return entity;
}

function bilingual(entity: Entity, pack: ContentPack): string {
  return pack.manifest.primaryAnswerLanguage === 'zh'
    ? `${entity.names.zh} / ${entity.names.en}`
    : `${entity.names.en} / ${entity.names.zh}`;
}

function primaryName(entity: Entity, pack: ContentPack): string {
  return entity.names[pack.manifest.primaryAnswerLanguage];
}

function correctEntity(state: PracticeState, pack: ContentPack): Entity {
  const entityId = state.currentQuestion.kind === 'associate_capital'
    ? state.currentQuestion.capitalId
    : state.currentQuestion.entityId;
  return entityById(pack, entityId);
}

function prompt(state: PracticeState, pack: ContentPack): string {
  const subject = entityById(pack, state.currentQuestion.entityId);
  switch (state.currentQuestion.kind) {
    case 'locate_region': return `在地图上找到 ${primaryName(subject, pack)}`;
    case 'identify_region': return '地图上标出的行政区叫什么？';
    case 'associate_capital': return `${primaryName(subject, pack)} 的行政中心或首府是哪里？`;
    case 'locate_place': return `在地图上找到 ${primaryName(subject, pack)}`;
    case 'identify_place': return '地图上标出的地点叫什么？';
  }
}

function hintText(hint: Hint | null, pack: ContentPack): string | null {
  if (hint === null) return null;
  switch (hint.kind) {
    case 'map-direction': return `目标大约在所选位置的${directionLabels[hint.sector]}。`;
    case 'text-reveal': return `答案以“${hint.reveal}”开头。`;
    case 'text-shape': return `答案有 ${hint.graphemeCount} 个字符。`;
    case 'choice-elimination': return `${primaryName(entityById(pack, hint.eliminatedEntityId), pack)} 已排除。`;
  }
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function mapSelection(state: PracticeState): MapSelection | null {
  const question = state.currentQuestion;
  if (question.presentation === 'map') {
    if (state.answerValue === null) return null;
    return { kind: question.kind === 'locate_region' ? 'region' : 'place', entityId: state.answerValue };
  }
  if (question.kind === 'identify_region' || question.kind === 'associate_capital') {
    return { kind: 'region', entityId: question.entityId };
  }
  return { kind: 'place', entityId: question.entityId };
}

export function PracticeScreen(props: PracticeScreenProps) {
  const [state, dispatch] = useReducer(practiceReducer, props.initialState);
  const [paused, setPaused] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [introSaving, setIntroSaving] = useState(false);
  const [introSaveError, setIntroSaveError] = useState(false);
  const [retryingSave, setRetryingSave] = useState(false);
  const attempts = useRef<AttemptEvent[]>([...(props.initialAttempts ?? [])]);
  const savingAttempt = useRef<string | null>(null);
  const latestState = useRef(state);
  latestState.current = state;
  const entities = useMemo(
    () => new Map(props.pack.entities.map((entity) => [entity.id, entity] as const)),
    [props.pack.entities],
  );

  const commit = async (snapshot: PracticeState) => {
    const attempt = snapshot.pendingAttempt;
    if (attempt === null || savingAttempt.current === attempt.event.attemptId) return;
    savingAttempt.current = attempt.event.attemptId;
    await commitCurrentAttempt({
      state: snapshot,
      repository: props.repository,
      dispatch: (action) => {
        if (action.type === 'ATTEMPT_SAVED') attempts.current.push(attempt.event);
        if (action.type === 'ATTEMPT_SAVE_FAILED') savingAttempt.current = null;
        dispatch(action);
      },
    });
  };

  useEffect(() => {
    if (state.saveStatus === 'saving') void commit(state);
  }, [state]);

  useEffect(() => {
    const pauseForVisibility = () => {
      if (document.visibilityState === 'hidden' && canLeavePractice(latestState.current)) {
        dispatch({ type: 'PAUSED', now: props.now() });
        setPaused(true);
      }
    };
    document.addEventListener('visibilitychange', pauseForVisibility);
    return () => document.removeEventListener('visibilitychange', pauseForVisibility);
  }, [props]);

  const requestPause = () => {
    if (!canLeavePractice(state)) return;
    dispatch({ type: 'PAUSED', now: props.now() });
    setPaused(true);
  };

  const resume = () => {
    dispatch({ type: 'RESUMED', now: props.now() });
    setOptionsOpen(false);
    setPaused(false);
  };

  const submit = () => dispatch({ type: 'ANSWER_SUBMITTED', now: props.now() });
  const requestHint = () => dispatch({ type: 'HINT_REQUESTED' });
  const continuePractice = () => {
    if (!canContinue(state)) return;
    if (state.session.questionCursor >= state.session.questions.length) {
      void props.audio.play('complete', props.settings.audio);
      props.onComplete({ attempts: attempts.current, masteryAfter: state.masteryRecords, session: state.session });
      return;
    }
    dispatch({ type: 'CONTINUED', now: props.now() });
  };

  const continueIntroduction = async () => {
    if (introSaving) return;
    const action: PracticeAction = { type: 'INTRO_CONTINUED', now: props.now() };
    const next = practiceReducer(state, action);
    setIntroSaving(true);
    setIntroSaveError(false);
    try {
      await props.repository.saveSession(next.session);
      dispatch(action);
    } catch {
      setIntroSaveError(true);
    } finally {
      setIntroSaving(false);
    }
  };

  const retrySave = async () => {
    if (!canRetrySave(state) || retryingSave) return;
    setRetryingSave(true);
    try { await commit(state); } finally { setRetryingSave(false); }
  };

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
        event.ctrlKey || event.metaKey || event.altKey || document.querySelector('dialog[open]') !== null) return;
      if (event.key === 'Escape') {
        requestPause();
        event.preventDefault();
        return;
      }
      if (paused || state.phase === 'presenting') return;
      const editable = isEditable(event.target);
      if (state.currentQuestion.presentation === 'text') {
        if (event.key === 'Enter' && editable) {
          if (canContinue(state)) continuePractice();
          else submit();
          event.preventDefault();
        }
        return;
      }
      if (editable) return;
      if (/^[1-4]$/.test(event.key) && state.currentQuestion.presentation === 'choice') {
        const candidate = state.currentQuestion.candidateEntityIds[Number(event.key) - 1];
        const eliminated = state.hint?.kind === 'choice-elimination'
          ? state.hint.eliminatedEntityId
          : null;
        if (candidate !== undefined && candidate !== eliminated) {
          dispatch({ type: 'ANSWER_SELECTED', value: candidate });
        }
        event.preventDefault();
      } else if (event.key.toLowerCase() === 'h') {
        requestHint();
        event.preventDefault();
      } else if (event.code === 'Space') {
        if (canContinue(state)) continuePractice();
        else submit();
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  useEffect(() => {
    const feedback = state.feedback;
    if (feedback === null) return;
    const event = feedback.kind === 'correct' ? 'correct' : feedback.kind === 'revealed' ? 'reveal' : 'incorrect';
    void props.audio.play(event, props.settings.audio);
  }, [props.audio, props.settings.audio, state.feedback]);

  const introductionId = state.session.introductions[state.session.introductionCursor];
  const introduction = introductionId === undefined ? undefined : entities.get(introductionId);
  const selection = mapSelection(state);
  const question = state.currentQuestion;
  const answer = correctEntity(state, props.pack);
  const reveal = state.feedback?.revealAnswer === true;
  const mapMode = reveal ? 'reveal' : state.phase === 'first_retry' ? 'first-retry' : 'quiz';
  const interactiveMap = question.presentation === 'map' && state.phase !== 'presenting';
  const primaryAction = state.pendingAttempt !== null
    ? state.session.questionCursor >= state.session.questions.length ? '查看总结' : '继续'
    : '检查答案';
  const excluded = state.hint?.kind === 'choice-elimination' ? state.hint.eliminatedEntityId : null;
  const questionNumber = Math.min(
    state.pendingAttempt === null ? state.session.questionCursor + 1 : state.session.questionCursor,
    state.session.questions.length,
  );

  const selectChoice = (entityId: string) => dispatch({ type: 'ANSWER_SELECTED', value: entityId });
  const handleTextKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      if (canContinue(state)) continuePractice();
      else submit();
      event.preventDefault();
    }
  };

  return (
    <main className="practice-screen">
      <section className={interactiveMap ? 'practice-map' : 'practice-map practice-map--context'} aria-label="练习地图">
        <MapViewport
          pack={props.pack}
          map={props.map}
          mode={mapMode}
          interactive={interactiveMap}
          selection={introduction === undefined ? selection : { kind: introduction.kind, entityId: introduction.id }}
          {...(reveal ? { answerEntityId: answer.id } : {})}
          {...(interactiveMap ? { selectableKind: question.kind === 'locate_region' ? 'region' as const : 'place' as const } : {})}
          onRegionSelect={(entityId) => { if (interactiveMap) dispatch({ type: 'ANSWER_SELECTED', value: entityId }); }}
          onPlaceSelect={(entityId) => { if (interactiveMap) dispatch({ type: 'ANSWER_SELECTED', value: entityId }); }}
        />
      </section>

      <section className="practice-panel" aria-label="题目与操作">
        <header className="practice-panel__header">
          <div><span className="product-kicker">{props.pack.manifest.title.zh}</span><strong>{questionNumber}/{state.session.questions.length}</strong></div>
          <button type="button" className="product-button product-button--quiet" disabled={!canLeavePractice(state)} onClick={requestPause}>暂停</button>
        </header>

        {state.phase === 'presenting' ? (
          <div className="practice-introduction">
            {introduction === undefined ? (
              <><p className="product-kicker">准备好了</p><h1>开始本次练习</h1><p>答案提交后会先保存，再进入下一题。</p></>
            ) : (
              <>
                <p className="product-kicker">认识 {state.session.introductionCursor + 1}/{state.session.introductions.length}</p>
                <h1>{primaryName(introduction, props.pack)}</h1>
                <p lang={props.pack.manifest.primaryAnswerLanguage === 'zh' ? 'en' : 'zh'}>{bilingual(introduction, props.pack)}</p>
              </>
            )}
            {introSaveError ? <p role="alert" className="practice-error">认识进度未保存，请重试。</p> : null}
            <button type="button" className="product-button product-button--primary" disabled={introSaving} onClick={() => void continueIntroduction()}>
              {introSaving ? '正在保存…' : introduction === undefined ? '开始答题' : '继续认识'}
            </button>
          </div>
        ) : (
          <>
            <div className="practice-question">
              <p className="product-kicker">{question.kind.replace(/_/g, ' ')}</p>
              <h1>{prompt(state, props.pack)}</h1>
              {question.presentation === 'choice' ? (
                <div className="practice-choices" role="group" aria-label="答案选项">
                  {question.candidateEntityIds.map((entityId, index) => {
                    const entity = entityById(props.pack, entityId);
                    const eliminated = excluded === entityId;
                    return <button key={entityId} type="button" disabled={eliminated || state.saveStatus === 'saving'} aria-pressed={state.answerValue === entityId} onClick={() => selectChoice(entityId)}><kbd>{index + 1}</kbd>{primaryName(entity, props.pack)}{eliminated ? '（已排除）' : ''}</button>;
                  })}
                </div>
              ) : question.presentation === 'text' ? (
                <label className="practice-text-answer"><span>输入答案</span><input autoFocus value={state.answerValue ?? ''} disabled={state.saveStatus === 'saving'} onChange={(event) => dispatch({ type: 'ANSWER_TYPED', value: event.target.value })} onKeyDown={handleTextKeyDown} /></label>
              ) : <p className="practice-map-instruction">点击地图，或聚焦地图后用方向键移动、Enter 选择。</p>}
            </div>

            <div className="practice-feedback" role={state.saveStatus === 'failed' ? 'alert' : 'status'} aria-live="polite">
              {state.feedback?.kind === 'incorrect' ? <><strong>再试一次</strong><span>{hintText(state.hint, props.pack)}</span></> : null}
              {state.feedback?.kind === 'correct' ? <><strong>答对了</strong><span>{bilingual(answer, props.pack)}</span></> : null}
              {state.feedback?.kind === 'revealed' ? <><strong>答案已揭示</strong><span>{bilingual(answer, props.pack)}</span></> : null}
              {state.saveStatus === 'saving' ? <span>正在保存本题结果…</span> : null}
              {state.saveStatus === 'failed' ? <><strong>保存失败</strong><span>结果仍保留在当前题，请重试保存。</span></> : null}
            </div>

            <footer className="practice-actions">
              <button type="button" className="product-button product-button--secondary" disabled={state.hint !== null || state.saveStatus !== 'idle'} onClick={requestHint}>提示 <kbd>H</kbd></button>
              {state.saveStatus === 'failed' ? <button type="button" className="product-button product-button--secondary" disabled={retryingSave} onClick={() => void retrySave()}>{retryingSave ? '正在重试…' : '重试保存'}</button> : null}
              <button type="button" className="product-button product-button--primary" aria-label={state.saveStatus === 'saving' ? '正在保存' : primaryAction} disabled={state.saveStatus === 'saving' || state.saveStatus === 'failed' || (!canContinue(state) && !canSubmitAnswer(state))} onClick={canContinue(state) ? continuePractice : submit}>{state.saveStatus === 'saving' ? '正在保存…' : primaryAction} <kbd>{question.presentation === 'text' ? 'Enter' : 'Space'}</kbd></button>
            </footer>
          </>
        )}
      </section>

      {paused && !optionsOpen ? <PauseDialog onResume={resume} onOpenOptions={() => setOptionsOpen(true)} onReturnHome={props.onHome} waitingForSave={!canLeavePractice(state)} /> : null}
      {paused && optionsOpen ? <OptionsPanel value={props.settings.audio} repository={props.repository} onChange={(audio) => props.onSettingsChange({ audio })} onPreview={(packId, volume) => { void props.audio.preview(packId, volume); }} onBack={() => setOptionsOpen(false)} onSavingChange={setSettingsSaving} unavailablePacks={(['crisp', 'soft', 'minimal'] as const).filter((packId) => !props.audio.isAvailable(packId))} /> : null}
      {settingsSaving ? <span className="map-sr-only" role="status">正在保存设置</span> : null}
    </main>
  );
}

import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_APP_SETTINGS } from '../app/settings';
import { mapPack, mapTopology } from '../map/mapTestFixture';
import { projectMap } from '../map/project';
import { InMemoryProgressRepository } from '../persistence/InMemoryProgressRepository';
import { PracticeScreen } from './PracticeScreen';
import { createPracticeState, practiceReducer } from './reducer';

const now = () => '2026-09-12T00:00:00.000Z';
const projection = projectMap(mapPack, mapTopology, { width: 640, height: 360 });
if (!projection.ok) throw new Error(projection.error.message);
const map = projection.map;

function renderPractice(presenting = false) {
  const initialState = createPracticeState({
    session: {
      sessionId: 'practice-cards', learnerId: 'learner',
      request: { mode: 'smart', packId: mapPack.manifest.packId },
      baseQuestionCount: 3, introductions: [], introductionCursor: 0,
      questions: ['west', 'center', 'east'].map((entityId) => ({
        kind: 'locate_region' as const, presentation: 'map' as const, entityId,
      })),
      questionCursor: 0, carryoverRetryDebts: [], startedAt: now(), accumulatedPauseMs: 0,
    },
    masteryRecords: ['west', 'center', 'east'].map((entityId) => ({
      learnerId: 'learner', packId: mapPack.manifest.packId, entityId, skill: 'locate_region',
      stage: 'learning', scheduledIntervalMs: 600_000, dueAt: now(), smoothedResponseMs: null, updatedAt: now(),
    })),
    presentedAt: now(), retryVariations: [], retryRandomValue: 0,
    mapCoordinates: [], delayedRetryQuestionIndexes: [],
  });
  const onComplete = vi.fn();
  render(<PracticeScreen
    initialState={presenting ? initialState : practiceReducer(initialState, { type: 'INTRO_CONTINUED', now: now() })}
    pack={mapPack} map={map} repository={new InMemoryProgressRepository()}
    audio={{ preload: async () => {}, preview: async () => {}, play: async () => {}, isAvailable: () => true }}
    settings={DEFAULT_APP_SETTINGS} now={now} onSettingsChange={vi.fn()} onHome={vi.fn()} onComplete={onComplete}
  />);
  return { onComplete };
}

describe('PracticeScreen classroom progress', () => {
  it('shows zero progress before answering, using the actual session length', () => {
    renderPractice(true);
    const status = screen.getByRole('status', { name: '答题进度' });
    expect(status).toHaveTextContent('0 / 3');
    expect(status).toHaveTextContent('剩余 3 题');
    expect(within(status).getByRole('progressbar')).toHaveAttribute('max', '3');
    expect(within(status).getByRole('progressbar')).toHaveAttribute('value', '0');
  });

  it('updates numeric, semantic and remaining progress through a full session', async () => {
    const user = userEvent.setup();
    const { onComplete } = renderPractice();
    const status = screen.getByRole('status', { name: '答题进度' });
    expect(status).toHaveTextContent('1 / 3');
    expect(status).toHaveTextContent('剩余 2 题');
    expect(within(status).getByRole('progressbar')).toHaveAttribute('value', '1');
    await user.click(screen.getByRole('option', { name: '西区 / West' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await user.click(await screen.findByRole('button', { name: '继续' }));
    await waitFor(() => expect(status).toHaveTextContent('2 / 3'));
    expect(status).toHaveTextContent('剩余 1 题');
    expect(within(status).getByRole('progressbar')).toHaveAttribute('value', '2');
    await user.click(screen.getByRole('option', { name: '中区 / Center' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await user.click(await screen.findByRole('button', { name: '继续' }));
    await waitFor(() => expect(status).toHaveTextContent('3 / 3'));
    await user.click(screen.getByRole('option', { name: '东区 / East' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    expect(status).toHaveTextContent('3 / 3');
    expect(status).toHaveTextContent('剩余 0 题');
    expect(within(status).getByRole('progressbar')).toHaveAttribute('value', '3');
    await user.click(await screen.findByRole('button', { name: '查看总结' }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('lets Space activate map controls without submitting the selected answer', async () => {
    const user = userEvent.setup();
    renderPractice();
    await user.click(screen.getByRole('option', { name: '西区 / West' }));
    screen.getByRole('button', { name: '放大地图' }).focus();
    await user.keyboard(' ');
    expect(screen.getByTestId('map-transform')).toHaveAttribute('transform', 'translate(0 0) scale(1.2)');
    expect(screen.getByRole('button', { name: '检查答案' })).toBeEnabled();
    expect(screen.queryByText('答对了')).not.toBeInTheDocument();
  });

  it('shows only blank remaining cards and flies the old card over the next question', async () => {
    const user = userEvent.setup();
    renderPractice();
    const deck = document.querySelector('.practice-queue')!;
    expect(deck).toHaveAttribute('aria-hidden', 'true');
    expect(deck.children).toHaveLength(2);
    expect(deck).toHaveTextContent('');
    await user.click(screen.getByRole('option', { name: '西区 / West' }));
    await user.click(screen.getByRole('button', { name: '检查答案' }));
    await user.click(await screen.findByRole('button', { name: '继续' }));
    const departure = document.querySelector('.practice-card-departure');
    expect(departure).toHaveAttribute('aria-hidden', 'true');
    expect(departure).toHaveTextContent('西区');
    expect(screen.getByRole('heading')).toHaveTextContent('中区');
    await waitFor(() => expect(document.querySelector('.practice-card-departure')).not.toBeInTheDocument());
    expect(document.querySelector('.practice-queue')).not.toBeInTheDocument();
  });

  it('continues immediately without a flight when reduced motion is preferred', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      renderPractice();
      await user.click(screen.getByRole('option', { name: '西区 / West' }));
      await user.click(screen.getByRole('button', { name: '检查答案' }));
      await user.click(await screen.findByRole('button', { name: '继续' }));
      expect(screen.getByRole('heading')).toHaveTextContent('中区');
      expect(document.querySelector('.practice-card-departure')).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

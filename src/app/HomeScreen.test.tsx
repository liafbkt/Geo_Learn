import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import type { ContentPack } from '../content/types';
import { minimalPack } from '../content/fixtures/minimal-pack';
import { CustomPracticeForm } from '../practice/CustomPracticeForm';
import type { PracticeSession } from '../practice/session';
import { HomeScreen } from './HomeScreen';

function resumableSession(packId: string): PracticeSession {
  return {
    sessionId: `resume-${packId}`,
    learnerId: 'learner-1',
    request: { mode: 'smart', packId },
    baseQuestionCount: 1,
    introductions: [],
    introductionCursor: 0,
    questions: [{ kind: 'locate_region', presentation: 'map', entityId: 'region-a' }],
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: '2026-08-30T00:00:00.000Z',
    accumulatedPauseMs: 0,
  };
}

describe('HomeScreen', () => {
  it('shows three pack summaries and promotes the resumable session action', () => {
    const onExplore = vi.fn();
    const packs = [
      {
        packId: 'cn-provincial-divisions',
        title: { zh: '中国省级行政区', en: 'China Provinces' },
        overallMastery: 68,
        dueCount: 7,
        fragileCount: 2,
        resumableSession: resumableSession('cn-provincial-divisions'),
      },
      {
        packId: 'cn-shanghai-districts',
        title: { zh: '上海行政区', en: 'Shanghai Districts' },
        overallMastery: 42,
        dueCount: 3,
        fragileCount: 1,
        resumableSession: null,
      },
      {
        packId: 'us-states',
        title: { zh: '美国州与州府', en: 'US States and Capitals' },
        overallMastery: 81,
        dueCount: 4,
        fragileCount: 0,
        resumableSession: null,
      },
    ] as const;

    render(
      <HomeScreen
        packs={packs}
        onResume={vi.fn()}
        onStartSmart={vi.fn()}
        onStartCustom={vi.fn()}
        onExplore={onExplore}
        onOpenDataManagement={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: '中国省级行政区' })).toBeInTheDocument();
    const provincesCard = screen.getByRole('heading', { name: '中国省级行政区' }).closest('article');
    expect(provincesCard).not.toBeNull();
    const provinces = within(provincesCard!);
    expect(provinces.getByText('总掌握度 68%')).toBeInTheDocument();
    expect(provinces.getByText('待复习').nextElementSibling).toHaveTextContent('7');
    expect(provinces.getByText('易忘').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: '继续上次练习' })).toHaveAttribute(
      'data-priority',
      'primary',
    );
    expect(screen.getAllByRole('button', { name: '智能练习' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '自定义练习' })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '探索地图' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: '数据管理' })).toBeInTheDocument();
    expect(provincesCard).toHaveAttribute('data-pack-id', 'cn-provincial-divisions');

    const usCard = screen.getByRole('heading', { name: '美国州与州府' }).closest('article');
    expect(usCard).toHaveAttribute('data-pack-id', 'us-states');
    expect(usCard).toHaveAttribute('data-pack-variant', 'us');

    fireEvent.click(provinces.getByRole('button', { name: '探索地图' }));
    expect(onExplore).toHaveBeenCalledWith('cn-provincial-divisions');
  });
});

describe('CustomPracticeForm', () => {
  it('builds a custom SessionRequest from entity, skill, status and count filters', () => {
    const onSubmit = vi.fn();
    render(
      <CustomPracticeForm
        pack={minimalPack as unknown as ContentPack}
        fragileKeys={['region-a|locate_region']}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '甲区 / Region A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '地图定位行政区' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '新内容' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '易忘' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: '题量' }), {
      target: { value: '24' },
    });
    fireEvent.click(screen.getByRole('button', { name: '开始自定义练习' }));

    expect(onSubmit).toHaveBeenCalledWith({
      mode: 'custom',
      packId: 'fixture-pack',
      questionCount: 24,
      entityIds: ['region-a'],
      skills: ['locate_region'],
      statuses: ['new', 'fragile'],
    });
  });

  it('prevents an entity-skill selection with no schedulable pair', () => {
    render(
      <CustomPracticeForm
        pack={minimalPack as unknown as ContentPack}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '甲城 / City A' }));

    expect(screen.getByRole('checkbox', { name: '地图定位行政区' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '开始自定义练习' })).toBeDisabled();
  });

  it('allows mixed entity kinds when each selected skill has a compatible target', () => {
    const onSubmit = vi.fn();
    render(
      <CustomPracticeForm
        pack={minimalPack as unknown as ContentPack}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '甲区 / Region A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '甲城 / City A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '地图定位行政区' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '地图定位地点' }));
    fireEvent.click(screen.getByRole('button', { name: '开始自定义练习' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'custom',
      entityIds: ['region-a', 'city-a'],
      skills: ['locate_region', 'locate_place'],
    }));
  });

  it('allows the question count field to be cleared without a React NaN warning', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <CustomPracticeForm
        pack={minimalPack as unknown as ContentPack}
        onSubmit={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('spinbutton', { name: '题量' }), {
      target: { value: '' },
    });

    const messages = consoleError.mock.calls.flat().join(' ');
    consoleError.mockRestore();
    expect(messages).not.toMatch(/NaN/);
    expect(screen.getByRole('spinbutton', { name: '题量' })).toHaveValue(null);
  });
});

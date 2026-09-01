import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import type { ContentPack } from '../content/types';
import type { MasteryRecord } from '../learning/types';
import { mapPack } from '../map/mapTestFixture';
import type { ProjectedMap } from '../map/types';
import { ExploreScreen } from './ExploreScreen';

const pack: ContentPack = {
  ...mapPack,
  entities: mapPack.entities.map((entity) =>
    entity.id === 'west' && entity.kind === 'region'
      ? { ...entity, capitalId: 'capital' }
      : entity,
  ),
};

const map: ProjectedMap = {
  cacheKey: 'fixture',
  packId: pack.manifest.packId,
  contentVersion: pack.manifest.contentVersion,
  size: { width: 600, height: 400 },
  viewBox: '0 0 600 400',
  regions: [
    { entityId: 'west', path: 'M0 0H180V180H0Z', centroid: [90, 90] },
    { entityId: 'center', path: 'M200 0H380V180H200Z', centroid: [290, 90] },
    { entityId: 'east', path: 'M400 0H580V180H400Z', centroid: [490, 90] },
  ],
  places: [{ entityId: 'capital', point: [100, 100] }],
  hydroPaths: ['M0 200H600'],
  boundaryPath: null,
  zoomLimits: { min: 1, max: 4 },
};

const mastery: MasteryRecord = {
  learnerId: 'learner-1',
  packId: pack.manifest.packId,
  entityId: 'west',
  skill: 'locate_region',
  stage: 'weak',
  scheduledIntervalMs: 86_400_000,
  dueAt: '2026-08-30T00:00:00.000Z',
  smoothedResponseMs: 1000,
  updatedAt: '2026-08-29T00:00:00.000Z',
};

describe('ExploreScreen', () => {
  it('shows all labels, toggles hydrography and launches unscored focused practice', () => {
    const onStartPractice = vi.fn();
    const { container } = render(
      <ExploreScreen
        pack={pack}
        map={map}
        masteryRecords={[mastery]}
        fragileKeys={['west|locate_region']}
        onStartPractice={onStartPractice}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText('西区 / West')).toBeInTheDocument();
    expect(screen.getByText('中区 / Center')).toBeInTheDocument();
    expect(screen.getByText('首府 / Capital')).toBeInTheDocument();
    expect(screen.getByText('探索模式不计分')).toBeInTheDocument();
    expect(screen.getByText('易忘地点 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看易忘地点：西区 / West' })).toHaveTextContent('西区 · West');

    const hydroToggle = screen.getByRole('checkbox', { name: '显示水系' });
    expect(hydroToggle).toBeChecked();
    fireEvent.click(hydroToggle);
    expect(container.querySelector('.explore-screen')).toHaveClass('explore-screen--hydro-hidden');

    fireEvent.click(screen.getByRole('option', { name: '西区 / West' }));
    expect(screen.getByRole('heading', { name: '西区' })).toBeInTheDocument();
    expect(screen.getByText('West')).toBeInTheDocument();
    const panel = screen.getByRole('complementary', { name: '地点学习详情' });
    expect(within(panel).getAllByText('行政区')).toHaveLength(2);
    expect(within(panel).getByText('首府关联').nextElementSibling).toHaveTextContent('首府 / Capital');
    expect(within(panel).getByText('地图定位行政区')).toBeInTheDocument();
    expect(within(panel).getByText('薄弱')).toBeInTheDocument();
    expect(within(panel).getAllByText('易忘')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '练习这个地点' }));
    expect(onStartPractice).toHaveBeenCalledWith({
      mode: 'custom',
      packId: 'fixture-map',
      questionCount: 12,
      entityIds: ['west'],
      skills: ['locate_region', 'identify_region'],
      statuses: [],
    });
  });
});

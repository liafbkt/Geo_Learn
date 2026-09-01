import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MapViewport } from './MapViewport';
import { mapPack, mapTopology } from './mapTestFixture';
import { projectMap } from './project';

const projection = projectMap(mapPack, mapTopology, { width: 640, height: 360 });
if (!projection.ok) throw new Error(projection.error.message);
const projectedMap = projection.map;

function renderMap(
  overrides: Partial<React.ComponentProps<typeof MapViewport>> = {},
) {
  const onRegionSelect = vi.fn();
  const onPlaceSelect = vi.fn();
  const onViewportChange = vi.fn();
  const view = render(
    <MapViewport
      pack={mapPack}
      map={projectedMap}
      mode="quiz"
      selection={null}
      onRegionSelect={onRegionSelect}
      onPlaceSelect={onPlaceSelect}
      onViewportChange={onViewportChange}
      {...overrides}
    />,
  );
  return { ...view, onRegionSelect, onPlaceSelect, onViewportChange };
}

describe('MapViewport accessibility and labels', () => {
  it('uses one Tab stop, navigates to the nearest directional centroid and activates with Enter', () => {
    const { onRegionSelect } = renderMap({ selectableKind: 'region' });
    const map = screen.getByRole('listbox', { name: '测试地图' });

    expect(map).toHaveAttribute('tabindex', '0');
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);

    map.focus();
    fireEvent.keyDown(map, { key: 'ArrowRight' });
    fireEvent.keyDown(map, { key: 'Enter' });
    expect(onRegionSelect).toHaveBeenCalledWith('center');

    fireEvent.keyDown(map, { key: 'ArrowRight' });
    fireEvent.keyDown(map, { key: 'Enter' });
    expect(onRegionSelect).toHaveBeenLastCalledWith('east');
  });

  it('lets place questions select a place without adding another Tab stop', () => {
    const { onPlaceSelect } = renderMap({ selectableKind: 'place' });
    const map = screen.getByRole('listbox');

    map.focus();
    fireEvent.keyDown(map, { key: 'Enter' });

    expect(onPlaceSelect).toHaveBeenCalledWith('capital');
    expect(document.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it('draws region fills without duplicate per-region border strokes', () => {
    renderMap();

    screen.getAllByRole('option').forEach((option) => {
      if (option.tagName.toLowerCase() === 'path') {
        expect(option).toHaveAttribute('stroke', 'none');
      }
    });
    expect(document.querySelectorAll('.map-boundaries')).toHaveLength(1);
  });

  it('exposes only objects that are selectable for the current question', () => {
    renderMap({ selectableKind: 'region' });

    expect(screen.getAllByRole('option')).toHaveLength(projectedMap.regions.length);
    expect(screen.queryByRole('option', { name: '首府 / Capital' })).not.toBeInTheDocument();
  });

  it('renders a contextual map without exposing answer options or a Tab stop', () => {
    renderMap({ interactive: false, selection: { kind: 'region', entityId: 'center' } });

    expect(screen.getByRole('img', { name: '测试地图' })).not.toHaveAttribute('tabindex');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
  });

  it('announces the current map selection', () => {
    renderMap({ selection: { kind: 'region', entityId: 'center' } });

    expect(screen.getByRole('status')).toHaveTextContent('已选择：中区 / Center');
    const map = screen.getByRole('listbox');
    const activeId = map.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId!)).toHaveAccessibleName('中区 / Center');
  });

  it.each(['quiz', 'first-retry'] as const)('%s mode hides answer labels', (mode) => {
    renderMap({ mode, answerEntityId: 'center' });
    expect(screen.queryByText('中区 / Center')).not.toBeInTheDocument();
  });

  it('reveal mode shows only the target answer label', () => {
    renderMap({ mode: 'reveal', answerEntityId: 'center' });
    expect(screen.getByText('中区 / Center')).toBeVisible();
    expect(screen.queryByText('西区 / West')).not.toBeInTheDocument();
  });

  it('explore mode shows all region and place labels', () => {
    renderMap({ mode: 'explore' });
    expect(screen.getByText('西区 / West')).toBeVisible();
    expect(screen.getByText('中区 / Center')).toBeVisible();
    expect(screen.getByText('东区 / East')).toBeVisible();
    expect(screen.getByText('首府 / Capital')).toBeVisible();
  });

  it('keeps focus on the map selection when reveal is rendered', () => {
    const { rerender } = renderMap({ selection: { kind: 'region', entityId: 'center' } });
    const map = screen.getByRole('listbox');
    map.focus();

    rerender(
      <MapViewport
        pack={mapPack}
        map={projectedMap}
        mode="reveal"
        selection={{ kind: 'region', entityId: 'center' }}
        answerEntityId="center"
        onRegionSelect={vi.fn()}
        onPlaceSelect={vi.fn()}
      />,
    );

    expect(map).toHaveFocus();
    const activeId = map.getAttribute('aria-activedescendant');
    expect(activeId).not.toBeNull();
    expect(document.getElementById(activeId!)).toHaveAccessibleName('中区 / Center');
  });

  it('does not activate a stale selection from a different selectable kind', () => {
    const { onPlaceSelect, onRegionSelect } = renderMap({
      selectableKind: 'place',
      selection: { kind: 'region', entityId: 'center' },
    });
    const map = screen.getByRole('listbox');

    fireEvent.keyDown(map, { key: 'Enter' });

    expect(onPlaceSelect).toHaveBeenCalledWith('capital');
    expect(onRegionSelect).not.toHaveBeenCalled();
  });

  it('uses unique valid descendant and status references for multiple maps', () => {
    render(
      <>
        <MapViewport
          pack={mapPack}
          map={projectedMap}
          mode="quiz"
          selection={{ kind: 'region', entityId: 'center' }}
          selectableKind="region"
          onRegionSelect={vi.fn()}
          onPlaceSelect={vi.fn()}
        />
        <MapViewport
          pack={mapPack}
          map={projectedMap}
          mode="quiz"
          selection={{ kind: 'region', entityId: 'center' }}
          selectableKind="region"
          onRegionSelect={vi.fn()}
          onPlaceSelect={vi.fn()}
        />
      </>,
    );

    const maps = screen.getAllByRole('listbox');
    const activeIds = maps.map((map) => map.getAttribute('aria-activedescendant'));
    const statusIds = maps.map((map) => map.getAttribute('aria-describedby'));
    expect(new Set(activeIds).size).toBe(2);
    expect(new Set(statusIds).size).toBe(2);
    [...activeIds, ...statusIds].forEach((id) => {
      expect(id).not.toMatch(/\s/);
      expect(document.getElementById(id!)).not.toBeNull();
    });
  });
});

describe('MapViewport pan and zoom', () => {
  it('keeps a click on a selectable region targeted at the region', () => {
    const { onRegionSelect } = renderMap({ selectableKind: 'region' });
    const map = screen.getByRole('listbox');
    const region = screen.getByRole('option', { name: '中区 / Center' });
    const capture = vi.fn();
    Object.defineProperty(map, 'setPointerCapture', { configurable: true, value: capture });

    fireEvent.pointerDown(region, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(region, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fireEvent.click(region);

    expect(capture).not.toHaveBeenCalled();
    expect(onRegionSelect).toHaveBeenCalledWith('center');
  });

  it('captures only after a drag threshold and suppresses accidental selection', () => {
    const { onRegionSelect } = renderMap({ selectableKind: 'region' });
    const map = screen.getByRole('listbox');
    const region = screen.getByRole('option', { name: '中区 / Center' });
    const capture = vi.fn();
    Object.defineProperty(map, 'setPointerCapture', { configurable: true, value: capture });

    fireEvent.pointerDown(region, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 10,
      clientY: 20,
    });
    fireEvent.pointerMove(map, {
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 30,
      clientY: 55,
    });
    fireEvent.pointerUp(map, { pointerId: 1, pointerType: 'mouse' });
    fireEvent.click(region);

    expect(capture).toHaveBeenCalledWith(1);
    expect(onRegionSelect).not.toHaveBeenCalled();
  });

  it('pans with pointer drag, clamps wheel zoom and resets with Home', () => {
    const { onViewportChange } = renderMap();
    const map = screen.getByRole('listbox');

    fireEvent.pointerDown(map, { pointerId: 1, pointerType: 'mouse', clientX: 10, clientY: 20 });
    fireEvent.pointerMove(map, { pointerId: 1, pointerType: 'mouse', clientX: 30, clientY: 55 });
    fireEvent.pointerUp(map, { pointerId: 1, pointerType: 'mouse', clientX: 30, clientY: 55 });
    expect(onViewportChange).toHaveBeenLastCalledWith({ panX: 20, panY: 35, zoom: 1 });

    for (let index = 0; index < 30; index += 1) {
      fireEvent.wheel(map, { deltaY: -100 });
    }
    expect(onViewportChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: projectedMap.zoomLimits.max }),
    );

    fireEvent.keyDown(map, { key: 'Home' });
    expect(onViewportChange).toHaveBeenLastCalledWith({ panX: 0, panY: 0, zoom: 1 });
  });

  it('supports touch pinch zoom within the pack-derived limits', () => {
    const { onViewportChange } = renderMap();
    const map = screen.getByRole('listbox');

    fireEvent.pointerDown(map, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerDown(map, { pointerId: 2, pointerType: 'touch', clientX: 200, clientY: 100 });
    fireEvent.pointerMove(map, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 100 });

    expect(onViewportChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ zoom: 2 }),
    );
  });

  it('uses immediate transform changes when reduced motion is requested', () => {
    renderMap({ reducedMotion: true });
    const viewport = screen.getByTestId('map-transform');

    expect(viewport).toHaveStyle({ transition: 'none' });
  });
});

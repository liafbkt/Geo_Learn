import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, WheelEvent } from 'react';
import { HydroLayer } from './HydroLayer';
import { LabelLayer } from './LabelLayer';
import { PlaceLayer } from './PlaceLayer';
import type {
  MapSelection,
  MapViewportProps,
  MapViewportState,
  ProjectedEntity,
} from './types';
import './map.css';

const initialViewport: MapViewportState = { panX: 0, panY: 0, zoom: 1 };

function useReducedMotion(override: boolean | undefined): boolean {
  const [preferred, setPreferred] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  useEffect(() => {
    if (override !== undefined || window.matchMedia === undefined) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPreferred(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [override]);
  return override ?? preferred;
}

function entityDomId(selection: MapSelection): string {
  return `map-${selection.kind}-${selection.entityId}`;
}

function nearestInDirection(
  items: readonly ProjectedEntity[],
  current: ProjectedEntity,
  key: string,
): ProjectedEntity | undefined {
  return items
    .filter((candidate) => candidate.entity.id !== current.entity.id)
    .map((candidate) => {
      const dx = candidate.point[0] - current.point[0];
      const dy = candidate.point[1] - current.point[1];
      const inDirection =
        (key === 'ArrowRight' && dx > 0) ||
        (key === 'ArrowLeft' && dx < 0) ||
        (key === 'ArrowDown' && dy > 0) ||
        (key === 'ArrowUp' && dy < 0);
      return { candidate, distance: inDirection ? dx * dx + dy * dy : Number.POSITIVE_INFINITY };
    })
    .filter(({ distance }) => Number.isFinite(distance))
    .sort((a, b) => a.distance - b.distance || a.candidate.entity.id.localeCompare(b.candidate.entity.id))[0]
    ?.candidate;
}

export function MapViewport({
  pack,
  map,
  mode,
  selection,
  answerEntityId,
  selectableKind,
  reducedMotion,
  onRegionSelect,
  onPlaceSelect,
  onViewportChange,
  className,
}: MapViewportProps) {
  const entities = useMemo(
    () => new Map(pack.entities.map((entity) => [entity.id, entity] as const)),
    [pack.entities],
  );
  const projectedEntities = useMemo<readonly ProjectedEntity[]>(() => {
    const regions = map.regions.flatMap(({ entityId, centroid }) => {
      const entity = entities.get(entityId);
      return entity?.kind === 'region' ? [{ entity, kind: 'region' as const, point: centroid }] : [];
    });
    const places = map.places.flatMap(({ entityId, point }) => {
      const entity = entities.get(entityId);
      return entity?.kind === 'place' ? [{ entity, kind: 'place' as const, point }] : [];
    });
    return [...regions, ...places];
  }, [entities, map.places, map.regions]);
  const selectedItem = selection === null
    ? undefined
    : projectedEntities.find(
        ({ entity, kind }) => kind === selection.kind && entity.id === selection.entityId,
      );
  const selectableEntities = useMemo(
    () =>
      selectableKind === undefined
        ? projectedEntities
        : projectedEntities.filter(({ kind }) => kind === selectableKind),
    [projectedEntities, selectableKind],
  );
  const [active, setActive] = useState<ProjectedEntity | undefined>(
    selectedItem ?? selectableEntities[0],
  );
  const [viewport, setViewport] = useState<MapViewportState>(initialViewport);
  const prefersReducedMotion = useReducedMotion(reducedMotion);
  const pointers = useRef(new Map<number, Readonly<{ x: number; y: number; type: string }>>());
  const pinch = useRef<Readonly<{ distance: number; zoom: number }> | null>(null);

  useEffect(() => {
    setActive((current) => {
      if (selectedItem !== undefined) return selectedItem;
      if (
        current !== undefined &&
        selectableEntities.some(
          ({ entity, kind }) => kind === current.kind && entity.id === current.entity.id,
        )
      ) {
        return current;
      }
      return selectableEntities[0];
    });
  }, [selectableEntities, selectedItem]);

  const updateViewport = (update: (current: MapViewportState) => MapViewportState) => {
    setViewport((current) => {
      const next = update(current);
      onViewportChange?.(next);
      return next;
    });
  };

  const selectActive = () => {
    if (active?.kind === 'region') onRegionSelect(active.entity.id);
    if (active?.kind === 'place') onPlaceSelect(active.entity.id);
  };

  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key.startsWith('Arrow') && active !== undefined) {
      const next = nearestInDirection(selectableEntities, active, event.key);
      if (next !== undefined) setActive(next);
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter') {
      selectActive();
      event.preventDefault();
      return;
    }
    if (event.key === 'Home') {
      updateViewport(() => initialViewport);
      event.preventDefault();
    }
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const pointerId = event.pointerId ?? 0;
    pointers.current.set(pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    event.currentTarget.setPointerCapture?.(pointerId);
    const touchPoints = [...pointers.current.values()].filter(({ type }) => type === 'touch');
    if (touchPoints.length === 2) {
      pinch.current = {
        distance: Math.hypot(
          touchPoints[1]!.x - touchPoints[0]!.x,
          touchPoints[1]!.y - touchPoints[0]!.y,
        ),
        zoom: viewport.zoom,
      };
    }
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const pointerId = event.pointerId ?? 0;
    const previous = pointers.current.get(pointerId);
    if (previous === undefined) return;
    pointers.current.set(pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    const touchPoints = [...pointers.current.values()].filter(({ type }) => type === 'touch');
    if (touchPoints.length === 2 && pinch.current !== null && pinch.current.distance > 0) {
      const distance = Math.hypot(
        touchPoints[1]!.x - touchPoints[0]!.x,
        touchPoints[1]!.y - touchPoints[0]!.y,
      );
      const zoom = Math.min(
        map.zoomLimits.max,
        Math.max(map.zoomLimits.min, pinch.current.zoom * (distance / pinch.current.distance)),
      );
      updateViewport((current) => ({ ...current, zoom }));
      return;
    }
    updateViewport((current) => ({
      ...current,
      panX: current.panX + event.clientX - previous.x,
      panY: current.panY + event.clientY - previous.y,
    }));
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId ?? 0);
    if (pointers.current.size < 2) pinch.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId ?? 0);
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    updateViewport((current) => {
      const requested = current.zoom * (event.deltaY < 0 ? 1.2 : 1 / 1.2);
      return {
        ...current,
        zoom: Math.min(map.zoomLimits.max, Math.max(map.zoomLimits.min, requested)),
      };
    });
  };

  const selectedEntity = selection === null ? undefined : entities.get(selection.entityId);
  const status = selectedEntity === undefined
    ? '尚未选择地图对象'
    : `已选择：${selectedEntity.names.zh} / ${selectedEntity.names.en}`;
  const activeSelection = active === undefined
    ? undefined
    : ({ kind: active.kind, entityId: active.entity.id } satisfies MapSelection);

  return (
    <div className={['map-viewport', className].filter(Boolean).join(' ')}>
      <svg
        role="application"
        aria-label={pack.manifest.title.zh}
        aria-activedescendant={activeSelection === undefined ? undefined : entityDomId(activeSelection)}
        aria-describedby="map-selection-status"
        tabIndex={0}
        viewBox={map.viewBox}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
      >
        <g
          data-testid="map-transform"
          style={{ transition: prefersReducedMotion ? 'none' : 'transform var(--motion-standard) ease' }}
          transform={`translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`}
        >
          <HydroLayer map={map} />
          <g className="map-regions">
            {map.regions.map(({ entityId, path }) => {
              const entity = entities.get(entityId);
              if (entity?.kind !== 'region') return null;
              const selected = selection?.kind === 'region' && selection.entityId === entityId;
              return (
                <path
                  id={`map-region-${entityId}`}
                  key={entityId}
                  role="option"
                  aria-label={`${entity.names.zh} / ${entity.names.en}`}
                  aria-selected={selected}
                  className={active?.entity.id === entityId ? 'is-active' : undefined}
                  d={path}
                  stroke="none"
                  onClick={
                    selectableKind === undefined || selectableKind === 'region'
                      ? () => onRegionSelect(entityId)
                      : undefined
                  }
                />
              );
            })}
          </g>
          {map.boundaryPath === null ? null : (
            <path className="map-boundaries" d={map.boundaryPath} aria-hidden="true" />
          )}
          <PlaceLayer
            pack={pack}
            map={map}
            activeEntityId={active?.entity.id ?? null}
            selection={selection}
            selectable={selectableKind === undefined || selectableKind === 'place'}
            onSelect={onPlaceSelect}
          />
          <LabelLayer
            pack={pack}
            map={map}
            mode={mode}
            {...(answerEntityId === undefined ? {} : { answerEntityId })}
          />
        </g>
      </svg>
      <span id="map-selection-status" role="status" className="map-sr-only">
        {status}
      </span>
    </div>
  );
}

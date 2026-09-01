import { useEffect, useId, useMemo, useRef, useState } from 'react';
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

function selectionKey(selection: MapSelection): string {
  return `${selection.kind}:${selection.entityId}`;
}

const dragThreshold = 4;

type TrackedPointer = Readonly<{
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
  captured: boolean;
}>;

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
  interactive = true,
  answerEntityId,
  selectableKind,
  reducedMotion,
  onRegionSelect,
  onPlaceSelect,
  onViewportChange,
  className,
}: MapViewportProps) {
  const instanceId = useId();
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
  const selectableEntities = useMemo(
    () =>
      selectableKind === undefined
        ? projectedEntities
        : projectedEntities.filter(({ kind }) => kind === selectableKind),
    [projectedEntities, selectableKind],
  );
  const selectedItem = selection === null
    ? undefined
    : selectableEntities.find(
        ({ entity, kind }) => kind === selection.kind && entity.id === selection.entityId,
      );
  const entityDomIds = useMemo(
    () => new Map(
      projectedEntities.map((item, index) => [
        selectionKey({ kind: item.kind, entityId: item.entity.id }),
        `${instanceId}-map-option-${index}`,
      ] as const),
    ),
    [instanceId, projectedEntities],
  );
  const statusId = `${instanceId}-map-selection-status`;
  const [active, setActive] = useState<ProjectedEntity | undefined>(
    selectedItem ?? selectableEntities[0],
  );
  const [viewport, setViewport] = useState<MapViewportState>(initialViewport);
  const prefersReducedMotion = useReducedMotion(reducedMotion);
  const pointers = useRef(new Map<number, TrackedPointer>());
  const pinch = useRef<Readonly<{ distance: number; zoom: number }> | null>(null);
  const dragged = useRef(false);

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
    if (
      !interactive ||
      active === undefined ||
      (selectableKind !== undefined && active.kind !== selectableKind) ||
      !selectableEntities.some(
        ({ entity, kind }) => kind === active.kind && entity.id === active.entity.id,
      )
    ) {
      return;
    }
    if (active.kind === 'region') onRegionSelect(active.entity.id);
    if (active.kind === 'place') onPlaceSelect(active.entity.id);
  };

  const selectFromPointer = (kind: MapSelection['kind'], entityId: string) => {
    if (!interactive) return;
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    if (selectableKind !== undefined && selectableKind !== kind) return;
    if (kind === 'region') onRegionSelect(entityId);
    if (kind === 'place') onPlaceSelect(entityId);
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
    if (pointers.current.size === 0) dragged.current = false;
    pointers.current.set(pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      type: event.pointerType,
      captured: false,
    });
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
    const touchCount = [...pointers.current.values()].filter(({ type }) => type === 'touch').length;
    const crossedThreshold = Math.hypot(
      event.clientX - previous.startX,
      event.clientY - previous.startY,
    ) > dragThreshold;
    const captured = previous.captured || crossedThreshold || touchCount >= 2;
    if (captured && !previous.captured) {
      dragged.current = true;
      event.currentTarget.setPointerCapture?.(pointerId);
    }
    pointers.current.set(pointerId, {
      ...previous,
      x: event.clientX,
      y: event.clientY,
      captured,
    });
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
    if (!captured) return;
    const deltaX = previous.captured ? event.clientX - previous.x : event.clientX - previous.startX;
    const deltaY = previous.captured ? event.clientY - previous.y : event.clientY - previous.startY;
    updateViewport((current) => ({
      ...current,
      panX: current.panX + deltaX,
      panY: current.panY + deltaY,
    }));
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const pointerId = event.pointerId ?? 0;
    const pointer = pointers.current.get(pointerId);
    pointers.current.delete(pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointer?.captured) event.currentTarget.releasePointerCapture?.(pointerId);
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
  const activeDescendant = activeSelection === undefined
    ? undefined
    : entityDomIds.get(selectionKey(activeSelection));

  return (
    <div className={['map-viewport', className].filter(Boolean).join(' ')}>
      <svg
        role={interactive ? 'listbox' : 'img'}
        aria-label={pack.manifest.title.zh}
        aria-activedescendant={interactive ? activeDescendant : undefined}
        aria-describedby={interactive ? statusId : undefined}
        tabIndex={interactive ? 0 : undefined}
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
              const selectable = interactive && (selectableKind === undefined || selectableKind === 'region');
              return (
                <path
                  id={entityDomIds.get(selectionKey({ kind: 'region', entityId }))}
                  key={entityId}
                  role={selectable ? 'option' : undefined}
                  aria-hidden={selectable ? undefined : true}
                  aria-label={selectable ? `${entity.names.zh} / ${entity.names.en}` : undefined}
                  aria-selected={selectable ? selected : undefined}
                  className={active?.entity.id === entityId ? 'is-active' : undefined}
                  d={path}
                  stroke="none"
                  onClick={selectable ? () => selectFromPointer('region', entityId) : undefined}
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
            selectable={interactive && (selectableKind === undefined || selectableKind === 'place')}
            domIdFor={(entityId) => entityDomIds.get(selectionKey({ kind: 'place', entityId }))}
            onSelect={(entityId) => selectFromPointer('place', entityId)}
          />
          <LabelLayer
            pack={pack}
            map={map}
            mode={mode}
            {...(answerEntityId === undefined ? {} : { answerEntityId })}
          />
        </g>
      </svg>
      {interactive ? <span id={statusId} role="status" className="map-sr-only">{status}</span> : null}
    </div>
  );
}

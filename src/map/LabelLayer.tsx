import type { ContentPack } from '../content/types';
import type { MapMode, ProjectedMap } from './types';

type LabelLayerProps = Readonly<{
  pack: ContentPack;
  map: ProjectedMap;
  mode: MapMode;
  answerEntityId?: string;
}>;

export function LabelLayer({ pack, map, mode, answerEntityId }: LabelLayerProps) {
  if (mode === 'quiz' || mode === 'first-retry') return null;
  const visibleIds =
    mode === 'explore'
      ? new Set(pack.entities.map(({ id }) => id))
      : new Set(answerEntityId === undefined ? [] : [answerEntityId]);
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity] as const));
  const positions = [
    ...map.regions.map(({ entityId, centroid }) => ({ entityId, point: centroid })),
    ...map.places.map(({ entityId, point }) => ({ entityId, point })),
  ];
  return (
    <g className={mode === 'reveal' ? 'map-labels map-labels--answer' : 'map-labels'} aria-hidden="true">
      {positions.map(({ entityId, point }) => {
        const entity = entities.get(entityId);
        if (entity === undefined || !visibleIds.has(entityId)) return null;
        return (
          <text key={entityId} x={point[0]} y={point[1]}>
            {entity.names.zh} / {entity.names.en}
          </text>
        );
      })}
    </g>
  );
}

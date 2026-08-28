import type { ContentPack } from '../content/types';
import type { MapSelection, ProjectedMap } from './types';

type PlaceLayerProps = Readonly<{
  pack: ContentPack;
  map: ProjectedMap;
  activeEntityId: string | null;
  selection: MapSelection | null;
  selectable: boolean;
  onSelect: (entityId: string) => void;
}>;

export function PlaceLayer({
  pack,
  map,
  activeEntityId,
  selection,
  selectable,
  onSelect,
}: PlaceLayerProps) {
  const entities = new Map(pack.entities.map((entity) => [entity.id, entity] as const));
  return (
    <g className="map-places">
      {map.places.map(({ entityId, point }) => {
        const entity = entities.get(entityId);
        if (entity?.kind !== 'place') return null;
        const selected = selection?.kind === 'place' && selection.entityId === entityId;
        return (
          <circle
            id={`map-place-${entityId}`}
            key={entityId}
            role="option"
            aria-label={`${entity.names.zh} / ${entity.names.en}`}
            aria-selected={selected}
            className={activeEntityId === entityId ? 'is-active' : undefined}
            cx={point[0]}
            cy={point[1]}
            r={6}
            onClick={selectable ? () => onSelect(entityId) : undefined}
          />
        );
      })}
    </g>
  );
}

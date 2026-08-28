import type { ContentPack, Entity } from '../content/types';

export type MapMode = 'quiz' | 'first-retry' | 'reveal' | 'explore';

export type MapSelection =
  | Readonly<{ kind: 'region'; entityId: string }>
  | Readonly<{ kind: 'place'; entityId: string }>;

export type MapSize = Readonly<{ width: number; height: number }>;

export type MapViewportState = Readonly<{
  panX: number;
  panY: number;
  zoom: number;
}>;

export type ProjectedRegion = Readonly<{
  entityId: string;
  path: string;
  centroid: readonly [x: number, y: number];
}>;

export type ProjectedPlace = Readonly<{
  entityId: string;
  point: readonly [x: number, y: number];
}>;

export type ProjectedMap = Readonly<{
  cacheKey: string;
  packId: string;
  contentVersion: string;
  size: MapSize;
  viewBox: string;
  regions: readonly ProjectedRegion[];
  places: readonly ProjectedPlace[];
  hydroPaths: readonly string[];
  boundaryPath: string | null;
  zoomLimits: Readonly<{ min: number; max: number }>;
}>;

export type MapProjectionError = Readonly<{
  code: 'invalid-viewport' | 'invalid-geometry' | 'missing-region-geometry';
  message: string;
}>;

export type ProjectMapResult =
  | Readonly<{ ok: true; map: ProjectedMap }>
  | Readonly<{ ok: false; error: MapProjectionError }>;

export type MapViewportProps = Readonly<{
  pack: ContentPack;
  map: ProjectedMap;
  mode: MapMode;
  selection: MapSelection | null;
  answerEntityId?: string;
  selectableKind?: MapSelection['kind'];
  reducedMotion?: boolean;
  onRegionSelect: (entityId: string) => void;
  onPlaceSelect: (entityId: string) => void;
  onViewportChange?: (viewport: MapViewportState) => void;
  className?: string;
}>;

export type ProjectedEntity = Readonly<{
  entity: Entity;
  kind: MapSelection['kind'];
  point: readonly [x: number, y: number];
}>;

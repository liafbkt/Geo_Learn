import type { ProjectedMap } from './types';

export function HydroLayer({ map }: Readonly<{ map: ProjectedMap }>) {
  return (
    <g className="map-hydro" aria-hidden="true">
      {map.hydroPaths.map((path, index) => (
        <path key={`${index}-${path}`} d={path} />
      ))}
    </g>
  );
}

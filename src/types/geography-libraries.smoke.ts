import { geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

export const geographyLibrarySmokeImports = [geoPath, feature] as const;

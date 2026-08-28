import type { ContentPack } from '../content/types';

export const mapPack: ContentPack = {
  manifest: {
    schemaVersion: 1,
    contentVersion: '1.0.0',
    packId: 'fixture-map',
    title: { zh: '测试地图', en: 'Fixture Map' },
    primaryAnswerLanguage: 'zh',
    expectedEntityCounts: { region: 3, place: 1 },
    capabilities: ['locate_region', 'identify_region', 'locate_place', 'identify_place'],
    defaultViewport: { center: [1.5, 0.5], scale: 100 },
    distributionStatus: 'development-only',
    checksums: {
      entities: '0'.repeat(64),
      topology: '1'.repeat(64),
      sources: '2'.repeat(64),
    },
  },
  entities: [
    {
      id: 'west',
      kind: 'region',
      names: { zh: '西区', en: 'West' },
      aliases: [],
    },
    {
      id: 'center',
      kind: 'region',
      names: { zh: '中区', en: 'Center' },
      aliases: [],
    },
    {
      id: 'east',
      kind: 'region',
      names: { zh: '东区', en: 'East' },
      aliases: [],
    },
    {
      id: 'capital',
      kind: 'place',
      names: { zh: '首府', en: 'Capital' },
      aliases: [],
      coordinate: [1.5, 0.5],
    },
  ],
  topologyObjectIds: ['west', 'center', 'east'],
  topologyPoints: [{ id: 'capital', coordinate: [1.5, 0.5] }],
  sources: [],
};

export const mapTopology: unknown = {
  type: 'Topology',
  objects: {
    regions: {
      type: 'GeometryCollection',
      geometries: [
        { type: 'Polygon', id: 'west', arcs: [[-4, -3, -2, -1]] },
        { type: 'Polygon', id: 'center', arcs: [[1, -7, -6, -5]] },
        { type: 'Polygon', id: 'east', arcs: [[5, -10, -9, -8]] },
      ],
    },
    hydro: {
      type: 'LineString',
      id: 'river',
      arcs: [10],
      properties: { layer: 'hydro' },
    },
  },
  arcs: [
    [[0, 0], [1, 0]],
    [[1, 0], [1, 1]],
    [[1, 1], [0, 1]],
    [[0, 1], [0, 0]],
    [[1, 0], [2, 0]],
    [[2, 0], [2, 1]],
    [[2, 1], [1, 1]],
    [[2, 0], [3, 0]],
    [[3, 0], [3, 1]],
    [[3, 1], [2, 1]],
    [[0, 0.25], [3, 0.75]],
  ],
};

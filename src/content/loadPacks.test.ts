import { describe, expect, it } from 'vitest';
import { minimalPack } from './fixtures/minimal-pack';
import { loadAvailablePacks } from './loadPacks';
import { InMemoryContentSource } from '../persistence/InMemoryContentSource';

const validTopology = {
  type: 'Topology',
  objects: {
    regions: {
      type: 'GeometryCollection',
      geometries: [{ type: 'Polygon', id: 'region-a', arcs: [] }],
    },
    places: {
      type: 'GeometryCollection',
      geometries: [{ type: 'Point', id: 'city-a', coordinates: [121.47, 31.23] }],
    },
  },
};

function resourcesFor(
  pack: Readonly<{ manifest: unknown; entities: unknown; sources: unknown }>,
  map: unknown = validTopology,
) {
  return {
    'manifest.json': pack.manifest,
    'entities.json': pack.entities,
    'sources.json': pack.sources,
    'map.topojson': map,
  } as const;
}

describe('loadAvailablePacks', () => {
  it('isolates a pack with a missing reference while keeping valid packs available', async () => {
    const invalidPack = {
      ...minimalPack,
      manifest: { ...minimalPack.manifest, packId: 'broken-pack' },
      entities: minimalPack.entities.map((entity) =>
        entity.id === 'region-a' ? { ...entity, capitalId: 'missing-city' } : entity,
      ),
    };
    const source = new InMemoryContentSource({
      'fixture-pack': resourcesFor(minimalPack),
      'broken-pack': resourcesFor(invalidPack),
    });

    const result = await loadAvailablePacks(source);

    expect(result.available.map((pack) => pack.manifest.packId)).toEqual(['fixture-pack']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ packId: 'broken-pack' });
    expect(result.rejected[0]?.issues).toContainEqual(
      expect.objectContaining({ code: 'missing_reference', path: 'entities.0.capitalId' }),
    );
  });

  it('extracts topology IDs and point summaries without changing source resources', async () => {
    const resources = resourcesFor(minimalPack);
    const before = structuredClone(resources['map.topojson']);
    const source = new InMemoryContentSource({ 'fixture-pack': resources });

    const result = await loadAvailablePacks(source);

    expect(result.available[0]?.topologyObjectIds).toEqual(['region-a']);
    expect(result.available[0]?.topologyPoints).toEqual([{ id: 'city-a', coordinate: [121.47, 31.23] }]);
    expect(resources['map.topojson']).toEqual(before);
  });

  it('rejects a source directory whose manifest claims a different pack ID', async () => {
    const source = new InMemoryContentSource({
      'directory-pack': resourcesFor(minimalPack),
    });

    const result = await loadAvailablePacks(source);

    expect(result.available).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        packId: 'directory-pack',
        issues: [expect.objectContaining({ code: 'schema', path: 'manifest.packId' })],
      }),
    ]);
  });

  it('rejects malformed summarized topology values instead of discarding them', async () => {
    const source = new InMemoryContentSource({
      'fixture-pack': resourcesFor(minimalPack, {
        topologyObjectIds: ['region-a', 9],
        topologyPoints: [{ id: 'city-a', coordinate: [121.47, 31.23] }],
      }),
    });

    const result = await loadAvailablePacks(source);

    expect(result.available).toEqual([]);
    expect(result.rejected[0]?.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_topology', path: 'map.topojson.topologyObjectIds.1' }),
    );
  });

  it('rejects malformed TopoJSON point geometry instead of silently omitting it', async () => {
    const source = new InMemoryContentSource({
      'fixture-pack': resourcesFor(minimalPack, {
        ...validTopology,
        objects: {
          ...validTopology.objects,
          places: {
            type: 'GeometryCollection',
            geometries: [{ type: 'Point', id: 'city-a', coordinates: [121.47] }],
          },
        },
      }),
    });

    const result = await loadAvailablePacks(source);

    expect(result.available).toEqual([]);
    expect(result.rejected[0]?.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid_topology', path: 'map.topojson.objects.places.geometries.0.coordinates' }),
    );
  });

  it('decodes quantized TopoJSON point coordinates before validating the pack', async () => {
    const source = new InMemoryContentSource({
      'fixture-pack': resourcesFor(minimalPack, {
        type: 'Topology',
        transform: { scale: [0.01, 0.01], translate: [120, 30] },
        objects: {
          regions: {
            type: 'GeometryCollection',
            geometries: [{ type: 'Polygon', id: 'region-a', arcs: [] }],
          },
          places: {
            type: 'GeometryCollection',
            geometries: [{ type: 'Point', id: 'city-a', coordinates: [147, 123] }],
          },
        },
      }),
    });

    const result = await loadAvailablePacks(source);

    expect(result.available[0]?.topologyPoints).toEqual([{ id: 'city-a', coordinate: [121.47, 31.23] }]);
  });
});

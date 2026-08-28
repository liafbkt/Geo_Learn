import { mapPack, mapTopology } from './mapTestFixture';
import { projectMap } from './project';

describe('projectMap', () => {
  it('returns stable projected paths and keeps place points inside the viewport', () => {
    const first = projectMap(mapPack, structuredClone(mapTopology), { width: 640, height: 360 });
    const second = projectMap(mapPack, structuredClone(mapTopology), { width: 640, height: 360 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.map.cacheKey).toBe('fixture-map@1.0.0:640x360');
    expect(first.map.regions.map(({ path }) => path)).toEqual(
      second.map.regions.map(({ path }) => path),
    );
    expect(first.map.regions.every(({ path }) => path.startsWith('M') && path.endsWith('Z'))).toBe(true);
    expect(first.map.places).toEqual([
      expect.objectContaining({ entityId: 'capital' }),
    ]);
    expect(first.map.places[0]?.point[0]).toBeGreaterThanOrEqual(0);
    expect(first.map.places[0]?.point[0]).toBeLessThanOrEqual(640);
    expect(first.map.places[0]?.point[1]).toBeGreaterThanOrEqual(0);
    expect(first.map.places[0]?.point[1]).toBeLessThanOrEqual(360);
  });

  it('caches by pack id, content version, width and height', () => {
    const first = projectMap(mapPack, mapTopology, { width: 640, height: 360 });
    const same = projectMap(mapPack, mapTopology, { width: 640, height: 360 });
    const resized = projectMap(mapPack, mapTopology, { width: 641, height: 360 });
    const revised = projectMap(
      {
        ...mapPack,
        manifest: { ...mapPack.manifest, contentVersion: '1.0.1' },
      },
      mapTopology,
      { width: 640, height: 360 },
    );

    expect(first.ok && same.ok && first.map).toBe(same.ok && same.map);
    expect(resized.ok && resized.map.cacheKey).toBe('fixture-map@1.0.0:641x360');
    expect(revised.ok && revised.map.cacheKey).toBe('fixture-map@1.0.1:640x360');
  });

  it('uses one de-duplicated boundary mesh path instead of per-region borders', () => {
    const result = projectMap(mapPack, mapTopology, { width: 640, height: 360 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map.boundaryPath).not.toBeNull();
    expect(result.map.boundaryPath).toMatch(/^M/);
  });

  it('returns a stable handleable error for malformed geometry', () => {
    const result = projectMap(
      mapPack,
      { type: 'Topology', objects: { regions: { type: 'Polygon', arcs: [['bad']] } }, arcs: [] },
      { width: 640, height: 360 },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid-geometry',
        message: 'Map topology could not be projected.',
      },
    });
  });
});

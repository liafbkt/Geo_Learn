// Test-navigation aid using the unchanged projector; actual keypresses must still
// be checked against DOM selection, so these predictions are not pass evidence.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAvailablePacks } from '../../../../../../src/content/loadPacks';
import { projectMap } from '../../../../../../src/map/project';
const here = dirname(fileURLToPath(import.meta.url));
const directory = resolve(here, '../..');
const loaded = await loadAvailablePacks({
  readPackIds: async () => ['us-states'],
  readJson: async (_, file) => JSON.parse(await readFile(resolve(directory, file), 'utf8')),
});
const pack = loaded.available[0]!;
const result = projectMap(pack, JSON.parse(await readFile(resolve(directory, 'map.topojson'), 'utf8')), { width: 1200, height: 800 });
if (!result.ok) throw new Error(result.error.message);
const regions = result.map.regions;
const graph = Object.fromEntries(regions.map(current => [current.entityId,
  Object.fromEntries(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].map(key => {
    const next = regions.map(candidate => {
      const dx = candidate.centroid[0] - current.centroid[0], dy = candidate.centroid[1] - current.centroid[1];
      const valid = key === 'ArrowUp' ? dy < 0 : key === 'ArrowDown' ? dy > 0 : key === 'ArrowLeft' ? dx < 0 : dx > 0;
      return { id: candidate.entityId, distance: valid ? dx * dx + dy * dy : Infinity };
    }).filter(candidate => Number.isFinite(candidate.distance)).sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0];
    return [key, next?.id ?? current.entityId];
  })),
]));
await writeFile(resolve(here, 'keyboard-graph.json'), JSON.stringify(graph, null, 2) + '\n');

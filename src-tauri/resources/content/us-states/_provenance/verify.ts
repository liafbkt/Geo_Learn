/** Reproduce twice with the existing converter, validate twice, and compare bytes. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformContent } from '../../../../../scripts/content/transform';
import { validateContentPack } from '../../../../../scripts/content/validate';
import { verifyRetainedSources } from './source-checks';

const here = dirname(fileURLToPath(import.meta.url));
const pack = resolve(here, '..');
const files = ['manifest.json', 'entities.json', 'map.topojson', 'sources.json'];
async function hashes(directory: string) {
  return Object.fromEntries(await Promise.all(files.map(async file => [file,
    createHash('sha256').update(await readFile(join(directory, file))).digest('hex'),
  ])));
}
// Fail before conversion/publication if retained raw or intermediate bytes changed.
const sourceEvidence = await verifyRetainedSources(here);
const temporaryParent = resolve(tmpdir());
const fromResources = relative(resolve(here, '../..'), temporaryParent);
assert.ok(isAbsolute(fromResources) || fromResources === '..' || fromResources.startsWith('..\\') || fromResources.startsWith('../'),
  'Verification temp directory must be outside installable content resources');
const scratch = await mkdtemp(join(temporaryParent, 'us-states-verification-'));
const options = {
  regionsPath: join(here, 'regions.geojson'), entitiesPath: join(here, 'entities.input.json'),
  manifestPath: join(here, 'manifest.template.json'), sourcePath: join(here, 'source.input.json'),
  sourceCrs: 'EPSG:4326', simplificationTolerance: 0, quantizationGridSize: 1000000,
};
const evidence = await (async () => {
  try {
    await transformContent({ ...options, outputDirectory: join(scratch, 'a') });
    await transformContent({ ...options, outputDirectory: join(scratch, 'b') });
    const first = await hashes(join(scratch, 'a'));
    assert.deepEqual(await hashes(join(scratch, 'b')), first);
    if (process.argv.includes('--publish')) {
      for (const file of files) await copyFile(join(scratch, 'a', file), join(pack, file));
    }
    assert.deepEqual(await hashes(pack), first, 'Existing pack differs from reproduced bytes');
    const validation1 = await validateContentPack(pack);
    assert.deepEqual(validation1, { ok: true, packId: 'us-states' });
    assert.deepEqual(await hashes(pack), first);
    const validation2 = await validateContentPack(pack);
    assert.deepEqual(validation2, validation1);
    assert.deepEqual(await hashes(pack), first);
    return { generatedTwiceIdentical: true, validation1, validation2, unchangedAfterValidation: true, hashes: first,
      sourceEvidence, scratchOutsideResources: true, scratchCleaned: true };
  } finally {
    // Only remove the unique directory created above, never its parent or a glob.
    assert.equal(dirname(resolve(scratch)), temporaryParent, 'Unsafe scratch cleanup parent');
    assert.ok(basename(scratch).startsWith('us-states-verification-'), 'Unsafe scratch cleanup name');
    await rm(scratch, { recursive: true, force: true });
  }
})();
await writeFile(join(here, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));

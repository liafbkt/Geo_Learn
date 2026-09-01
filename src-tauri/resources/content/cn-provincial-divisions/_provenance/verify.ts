/** Reproduce either Chinese pack from raw files; never overwrite differing published bytes. */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reproducePack, resourceHashes } from './build';

const here = dirname(fileURLToPath(import.meta.url));
const contentRoot = resolve(here, '../..');
const [id, ...flags] = process.argv.slice(2);
assert(id === 'cn-provincial-divisions' || id === 'cn-shanghai-districts', 'Supply cn-provincial-divisions or cn-shanghai-districts');
assert(flags.length === 0 || (flags.length === 1 && flags[0] === '--publish'), 'Only --publish is accepted');
const pack = join(contentRoot, id);
const tempParent = resolve(tmpdir());
const fromContent = relative(contentRoot, tempParent);
assert(isAbsolute(fromContent) || fromContent === '..' || fromContent.startsWith('../') || fromContent.startsWith('..\\'), 'Scratch must be outside installable content');
const scratch = await mkdtemp(join(tempParent, 'cn-pack-verification-'));
const evidence = await (async () => {
  try {
    const first = await reproducePack(pack, join(scratch, 'first'));
    assert.deepEqual(await reproducePack(pack, join(scratch, 'second')), first);
    if (flags.includes('--publish')) {
      const entries = [
        ...Object.keys(first.hashes).map(file => [join(scratch, 'first/pack', file), join(pack, file)] as const),
        ...['regions.geojson', 'entities.input.json', 'manifest.template.json', 'source.input.json'].map(file => [join(scratch, 'first/inputs', file), join(pack, '_provenance', file)] as const),
      ];
      // Check every destination before the first copy, preserving earlier work.
      for (const [source, destination] of entries) {
        let existing: Buffer;
        try { existing = await readFile(destination); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        assert(existing.equals(await readFile(source)), `Refusing to replace differing file: ${destination}`);
      }
      for (const [source, destination] of entries) await copyFile(source, destination);
    }
    assert.deepEqual(await resourceHashes(pack), first.hashes, 'Retained runtime differs from original-source reproduction');
    for (const file of ['regions.geojson', 'entities.input.json', 'manifest.template.json', 'source.input.json']) {
      assert((await readFile(join(pack, '_provenance', file))).equals(await readFile(join(scratch, 'first/inputs', file))), `Retained input mismatch: ${file}`);
    }
    return { ...first, generatedTwiceIdentical: true, retainedInputsIdentical: true, scratchOutsideResources: true, scratchCleaned: true };
  } finally {
    assert.equal(dirname(resolve(scratch)), tempParent, 'Unsafe cleanup parent');
    assert(basename(scratch).startsWith('cn-pack-verification-'), 'Unsafe cleanup name');
    await rm(scratch, { recursive: true, force: true });
  }
})();
await writeFile(join(pack, '_provenance/verification.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence, null, 2));

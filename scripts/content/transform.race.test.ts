import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishStagedDirectory } from './transform';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('content pack publication', () => {
  it('preserves files concurrently inserted into a previously empty output directory', async () => {
    const outputDirectory = await mkdtemp(join(tmpdir(), 'content-publish-race-'));
    const stagingDirectory = await mkdtemp(join(tmpdir(), 'content-publish-staging-'));
    temporaryDirectories.push(outputDirectory, stagingDirectory);
    await writeFile(join(outputDirectory, 'concurrent.txt'), 'preserve me');
    await writeFile(join(stagingDirectory, 'manifest.json'), 'staged');

    await expect(publishStagedDirectory(
      stagingDirectory,
      outputDirectory,
      'empty',
    )).rejects.toThrow();

    await expect(readFile(join(outputDirectory, 'concurrent.txt'), 'utf8')).resolves.toBe('preserve me');
  });
});

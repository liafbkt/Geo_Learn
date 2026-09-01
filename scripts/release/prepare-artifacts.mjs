import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactNames, cli, collectInstaller, downloadUrl, outputDirectory, preflight } from './lib.mjs';

await cli(async () => {
  if (process.argv.length !== 2) throw new Error('Artifact preparation accepts no arguments.');
  const root = process.cwd();
  const { version, tag } = await preflight(root, process.env);
  const source = await collectInstaller(root);
  const names = artifactNames(version);
  const output = join(root, outputDirectory);
  // Never merge output with stale files from another run.
  await mkdir(output);
  await copyFile(source.installer, join(output, names.installer));
  await copyFile(source.signaturePath, join(output, names.signature));
  await writeFile(join(output, names.manifest), `${JSON.stringify({
    version,
    notes: 'Windows x64 update. Publication requires human content/map review.',
    pub_date: new Date().toISOString(),
    platforms: { 'windows-x86_64': { signature: source.signature, url: downloadUrl(tag, names.installer) } },
  }, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write('Prepared exactly three Windows x64 release artifacts.\n');
});

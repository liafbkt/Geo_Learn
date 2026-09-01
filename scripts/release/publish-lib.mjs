import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { artifactNames, collectInstaller, downloadUrl, nonemptyFile, outputDirectory, preflight, readJson, repository, validateSignature } from './lib.mjs';

export async function publishDraft(root, env, run = (args) => spawnSync('gh', args, { cwd: root, env, encoding: 'utf8', shell: false, windowsHide: true })) {
  const { version, tag } = await preflight(root, env);
  const directory = join(root, outputDirectory);
  const names = artifactNames(version);
  const files = [names.installer, names.signature, names.manifest];
  const actual = await readdir(directory);
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...files].sort())) throw new Error('Release requires exactly the three expected artifacts.');
  for (const name of files) await nonemptyFile(join(directory, name), 'release artifact');
  const signature = (await readFile(join(directory, names.signature), 'utf8')).trim();
  validateSignature(signature);
  const source = await collectInstaller(root);
  const [preparedInstaller, verifiedInstaller] = await Promise.all([
    readFile(join(directory, names.installer)), readFile(source.installer),
  ]);
  if (!preparedInstaller.equals(verifiedInstaller) || signature !== source.signature) {
    throw new Error('Prepared installer/signature differs from the verified build artifacts.');
  }
  const manifest = await readJson(join(directory, names.manifest));
  const platform = manifest.platforms?.['windows-x86_64'];
  if (manifest.version !== version || Object.keys(manifest.platforms ?? {}).length !== 1 || platform?.signature !== signature || platform?.url !== downloadUrl(tag, names.installer) || !Number.isFinite(Date.parse(manifest.pub_date))) {
    throw new Error('Invalid release updater manifest.');
  }
  // A successful authenticated listing distinguishes absence from API/network/permission failures.
  const inspected = run(['api', `repos/${repository}/releases`, '--paginate', '--slurp']);
  if (inspected.status !== 0) throw new Error('Cannot inspect existing GitHub Releases; no changes made.');
  let pages;
  try { pages = JSON.parse(inspected.stdout); } catch { throw new Error('Cannot inspect malformed GitHub Releases response.'); }
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page) || page.some((release) => typeof release?.tag_name !== 'string' || typeof release?.draft !== 'boolean'))) {
    throw new Error('Cannot inspect malformed GitHub Releases response.');
  }
  if (pages.flat().some((release) => release.tag_name === tag)) throw new Error('Release already exists; refusing to overwrite a draft or published release.');
  const created = run([
    'release', 'create', tag, ...files.map((name) => join(directory, name)),
    '--repo', repository, '--draft', '--verify-tag', '--title', `Geo Learn ${tag}`,
    '--notes', 'Draft only. Human content/map review and release checklist approval are required before publication.',
  ]);
  if (created.status !== 0) throw new Error('GitHub draft creation/upload failed; inspect the draft before retrying.');
}

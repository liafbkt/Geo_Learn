import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { artifactNames, collectInstaller, downloadUrl, nonemptyFile, outputDirectory, preflight, readJson, repository, validateSignature, verifyChecksumManifest } from './lib.mjs';

const expectedFiles = (names) => [names.installer, names.signature, names.manifest, names.checksums];

async function validatePreparedDirectory(root, version, tag) {
  const directory = join(root, outputDirectory);
  const names = artifactNames(version);
  const files = expectedFiles(names);
  const actual = await readdir(directory);
  if (JSON.stringify(actual.sort()) !== JSON.stringify([...files].sort())) throw new Error('Release requires exactly the four expected artifacts.');
  for (const name of files) await nonemptyFile(join(directory, name), 'release artifact');
  const signature = (await readFile(join(directory, names.signature), 'utf8')).trim();
  validateSignature(signature);
  const manifest = await readJson(join(directory, names.manifest));
  const platform = manifest.platforms?.['windows-x86_64'];
  if (manifest.version !== version || Object.keys(manifest.platforms ?? {}).length !== 1 || platform?.signature !== signature || platform?.url !== downloadUrl(tag, names.installer) || !Number.isFinite(Date.parse(manifest.pub_date))) {
    throw new Error('Invalid release updater manifest.');
  }
  const contents = Object.fromEntries(await Promise.all([names.installer, names.signature, names.manifest]
    .map(async (name) => [name, await readFile(join(directory, name))])));
  verifyChecksumManifest(await readFile(join(directory, names.checksums), 'utf8'), contents);
  return { directory, files, names, signature };
}

export async function publishDraft(root, env, run = (args) => spawnSync('gh', args, { cwd: root, env, encoding: 'utf8', shell: false, windowsHide: true })) {
  const { version, tag, channel } = await preflight(root, env);
  const { directory, files, names, signature } = await validatePreparedDirectory(root, version, tag);
  const source = await collectInstaller(root);
  const [preparedInstaller, verifiedInstaller] = await Promise.all([
    readFile(join(directory, names.installer)), readFile(source.installer),
  ]);
  if (!preparedInstaller.equals(verifiedInstaller) || signature !== source.signature) {
    throw new Error('Prepared installer/signature differs from the verified build artifacts.');
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
    '--repo', repository, '--draft', ...(channel === 'candidate' ? ['--prerelease'] : []), '--verify-tag', '--title', `Geo Learn ${tag}`,
    '--notes', 'Draft only. Personal-use Windows x64 release; current-user smoke and release checklist approval are required before publication.',
  ]);
  if (created.status !== 0) throw new Error('GitHub draft creation/upload failed; inspect the draft before retrying.');
}

export async function promoteRelease(root, env, run = (args, { binary = false } = {}) => spawnSync('gh', args, {
  cwd: root, env, encoding: binary ? null : 'utf8', shell: false, windowsHide: true,
})) {
  const { version, tag, channel } = await preflight(root, env);
  const inspected = run(['api', `repos/${repository}/releases/tags/${tag}`]);
  if (inspected.status !== 0) throw new Error('Cannot inspect the GitHub draft; no changes made.');
  let release;
  try { release = JSON.parse(inspected.stdout); } catch { throw new Error('Cannot inspect malformed GitHub draft response.'); }
  const expectedPrerelease = channel === 'candidate';
  if (!release || !Number.isInteger(release.id) || release.id < 1 || typeof release.tag_name !== 'string' || typeof release.draft !== 'boolean' || typeof release.prerelease !== 'boolean' || !Array.isArray(release.assets)) {
    throw new Error('Cannot inspect malformed GitHub draft response.');
  }
  if (!release.draft) throw new Error('Release is already published; refusing mutation.');
  if (release.tag_name !== tag) throw new Error('GitHub draft tag does not match the requested release.');
  if (release.prerelease !== expectedPrerelease) throw new Error('GitHub draft channel does not match its tag.');
  const names = artifactNames(version);
  const files = expectedFiles(names);
  if (release.assets.length !== files.length || JSON.stringify(release.assets.map((asset) => asset?.name).sort()) !== JSON.stringify([...files].sort())) {
    throw new Error('GitHub draft does not contain exactly the four expected assets.');
  }
  const contents = {};
  for (const asset of release.assets) {
    if (!Number.isInteger(asset.id) || asset.id < 1 || !Number.isInteger(asset.size) || asset.size < 1 || asset.url !== `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`) {
      throw new Error('Cannot inspect malformed GitHub draft asset metadata.');
    }
    const downloaded = run(['api', asset.url, '-H', 'Accept: application/octet-stream'], { binary: true });
    if (downloaded.status !== 0) throw new Error('Cannot download GitHub draft assets for verification.');
    const bytes = Buffer.isBuffer(downloaded.stdout) ? downloaded.stdout : Buffer.from(downloaded.stdout ?? '');
    if (bytes.length !== asset.size) throw new Error('Downloaded GitHub draft asset size mismatch.');
    contents[asset.name] = bytes;
  }
  const signature = contents[names.signature].toString('utf8').trim();
  validateSignature(signature);
  let manifest;
  try { manifest = JSON.parse(contents[names.manifest].toString('utf8')); } catch { throw new Error('Invalid release updater manifest.'); }
  const platform = manifest.platforms?.['windows-x86_64'];
  if (manifest.version !== version || Object.keys(manifest.platforms ?? {}).length !== 1 || platform?.signature !== signature || platform?.url !== downloadUrl(tag, names.installer) || !Number.isFinite(Date.parse(manifest.pub_date))) {
    throw new Error('Invalid release updater manifest.');
  }
  verifyChecksumManifest(contents[names.checksums].toString('utf8'), Object.fromEntries([
    names.installer, names.signature, names.manifest,
  ].map((name) => [name, contents[name]])));
  const fields = ['-f', 'draft=false', '-f', `prerelease=${expectedPrerelease}`];
  if (channel === 'stable') fields.push('-f', 'make_latest=true');
  const promoted = run(['api', `repos/${repository}/releases/${release.id}`, '-X', 'PATCH', ...fields]);
  if (promoted.status !== 0) throw new Error('GitHub Release promotion failed after validation.');
}

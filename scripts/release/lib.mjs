import { lstat, readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readVersions, validateVersion } from './version-lib.mjs';

export const repository = 'liafbkt/Geo_Learn';
export const updaterEndpoint = `https://github.com/${repository}/releases/latest/download/latest.json`;
export const installerDirectory = 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis';
export const outputDirectory = 'release-artifacts';
const requiredPacks = ['cn-provincial-divisions', 'cn-shanghai-districts', 'us-states'];
const requiredFiles = ['manifest.json', 'entities.json', 'sources.json', 'map.topojson'];
const requiredResourceGlobs = requiredFiles.map((file) => `resources/content/*/${file}`);

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export function parseReleaseTag(ref) {
  const match = /^refs\/tags\/v(.+)$/.exec(ref ?? '');
  if (!match) throw new Error('Release requires a vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-rc.N tag ref.');
  const version = validateVersion(match[1]);
  return { version, tag: `v${version}`, channel: version.includes('-rc.') ? 'candidate' : 'stable' };
}

export async function releaseIdentity(root, env) {
  if (env.GITHUB_REPOSITORY !== repository) throw new Error('Release repository is not allowed.');
  const identity = parseReleaseTag(env.GITHUB_REF);
  const { version } = identity;
  const pkg = await readJson(join(root, 'package.json'));
  const config = await readJson(join(root, 'src-tauri/tauri.conf.json'));
  const versions = await readVersions(root);
  if (pkg.version !== version || config.version !== version || Object.values(versions).some((value) => value !== version)) {
    throw new Error('Release tag and all four release version sources must match.');
  }
  return { ...identity, config };
}

function decodeBase64(value, label) {
  if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`Invalid ${label} format.`);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error(`Invalid ${label} format.`);
  return bytes;
}

export function validatePublicKey(value) {
  const label = 'updater public key';
  const lines = decodeBase64(value, label).toString('utf8').trimEnd().split(/\r?\n/);
  if (lines.length !== 2 || !lines[0].startsWith('untrusted comment: ')) throw new Error(`Invalid ${label} format.`);
  const packet = decodeBase64(lines[1], label);
  if (packet.length !== 42 || packet.subarray(0, 2).toString() !== 'Ed') throw new Error(`Invalid ${label} format.`);
}

export function validateSignature(value) {
  const label = 'updater signature';
  const lines = decodeBase64(value, label).toString('utf8').trimEnd().split(/\r?\n/);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment: ') || !lines[2].startsWith('trusted comment: ')) {
    throw new Error(`Invalid ${label} format.`);
  }
  const packet = decodeBase64(lines[1], label);
  if (packet.length !== 74 || !['Ed', 'ED'].includes(packet.subarray(0, 2).toString()) || decodeBase64(lines[3], label).length !== 64) {
    throw new Error(`Invalid ${label} format.`);
  }
}

export async function nonemptyFile(path, label) {
  let stat;
  try { stat = await lstat(path); } catch { throw new Error(`Missing ${label}.`); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) throw new Error(`Invalid ${label}: requires a nonempty regular file.`);
}

export async function preflight(root, env, { secrets = false, identityOnly = false } = {}) {
  if (secrets) {
    const missing = ['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'].filter((name) => !env[name]?.trim());
    if (missing.length) throw new Error(`Missing required secrets: ${missing.join(', ')}.`);
  }
  const identity = await releaseIdentity(root, env);
  if (identityOnly) return identity;
  const { config } = identity;
  validatePublicKey(config.plugins?.updater?.pubkey);
  const updater = config.plugins.updater;
  if (JSON.stringify(updater.endpoints) !== JSON.stringify([updaterEndpoint]) || updater.dangerousInsecureTransportProtocol === true) {
    throw new Error('Updater must use the fixed HTTPS GitHub Releases endpoint.');
  }
  if (config.bundle?.createUpdaterArtifacts !== true || JSON.stringify(config.bundle.targets) !== '["nsis"]') {
    throw new Error('Release must create Tauri 2 updater artifacts with NSIS only.');
  }
  if (!Array.isArray(config.bundle.resources) ||
      !requiredResourceGlobs.every((resource) => config.bundle.resources.includes(resource))) {
    throw new Error('Release must bundle the content resources.');
  }
  for (const pack of requiredPacks) {
    const directory = join(root, 'src-tauri/resources/content', pack);
    let stat;
    try { stat = await lstat(directory); } catch { throw new Error(`Missing required content pack: ${pack}.`); }
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Invalid required content pack: ${pack}.`);
    for (const file of requiredFiles) {
      await nonemptyFile(join(directory, file), `${pack}/${file}`);
      try { await readJson(join(directory, file)); } catch { throw new Error(`Invalid JSON content resource: ${pack}/${file}.`); }
    }
  }
  return identity;
}

export function artifactNames(version) {
  const installer = `GeoLearn_${version}_x64-setup.exe`;
  return { installer, signature: `${installer}.sig`, manifest: 'latest.json', checksums: 'SHA256SUMS.txt' };
}

export function checksumManifest(contents) {
  return `${Object.entries(contents)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, bytes]) => `${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
    .join('\n')}\n`;
}

export function verifyChecksumManifest(source, contents) {
  if (source !== checksumManifest(contents)) throw new Error('Invalid SHA256SUMS.txt contents.');
}

export function downloadUrl(tag, name) {
  return `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

export async function collectInstaller(root) {
  const directory = join(root, installerDirectory);
  const entries = await readdir(directory, { withFileTypes: true });
  const installers = entries.filter((entry) => entry.name.endsWith('.exe'));
  const signatures = entries.filter((entry) => entry.name.endsWith('.sig'));
  if (installers.length !== 1 || signatures.length !== 1 || signatures[0].name !== `${installers[0].name}.sig`) {
    throw new Error('Expected exactly one NSIS installer and its matching .exe.sig.');
  }
  const installer = join(directory, installers[0].name);
  const signaturePath = join(directory, signatures[0].name);
  await nonemptyFile(installer, 'NSIS installer');
  await nonemptyFile(signaturePath, 'NSIS signature');
  const bytes = await readFile(installer);
  if (bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('Invalid Windows installer header.');
  const signature = (await readFile(signaturePath, 'utf8')).trim();
  validateSignature(signature);
  return { installer, signaturePath, signature };
}

export async function cli(action) {
  try { await action(); } catch (error) {
    // Filesystem/runtime errors can contain raw data. Only emit our controlled validation messages.
    const message = error instanceof Error && !error.code && !['SyntaxError', 'TypeError', 'RangeError'].includes(error.name)
      ? error.message : 'Release validation failed while reading required inputs.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

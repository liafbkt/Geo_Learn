import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/;
const files = {
  packageJson: 'package.json',
  tauriConfig: 'src-tauri/tauri.conf.json',
  cargoToml: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
};

export function validateVersion(version) {
  if (typeof version !== 'string' || !versionPattern.test(version)) {
    throw new Error('Invalid release version; expected MAJOR.MINOR.PATCH or MAJOR.MINOR.PATCH-rc.N.');
  }
  return version;
}

function parseJson(source, label) {
  try { return JSON.parse(source); } catch { throw new Error(`Invalid ${label}.`); }
}

function packageSection(source, heading) {
  const start = source.indexOf(`${heading}\n`);
  const crlfStart = source.indexOf(`${heading}\r\n`);
  const index = start === -1 ? crlfStart : start;
  if (index === -1) throw new Error(`Missing ${heading} section.`);
  const next = source.indexOf('\n[', index + heading.length + 1);
  return { start: index, end: next === -1 ? source.length : next + 1 };
}

function readTomlVersion(source, heading, label) {
  const section = packageSection(source, heading);
  const matches = [...source.slice(section.start, section.end).matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error(`Invalid ${label} package version.`);
  return matches[0][1];
}

function replaceTomlVersion(source, heading, label, version) {
  const section = packageSection(source, heading);
  const current = source.slice(section.start, section.end);
  const matches = [...current.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error(`Invalid ${label} package version.`);
  const updated = current.replace(/^version\s*=\s*"[^"]+"\s*$/m, `version = "${version}"`);
  return source.slice(0, section.start) + updated + source.slice(section.end);
}

function rootLockSection(source) {
  const sections = source.split(/(?=^\[\[package\]\]\s*$)/m);
  const matches = sections.filter((section) => /^name\s*=\s*"spatial-memory-coach"\s*$/m.test(section));
  if (matches.length !== 1) throw new Error('Invalid Cargo.lock root package entry.');
  return matches[0];
}

function readLockVersion(source) {
  const section = rootLockSection(source);
  const matches = [...section.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)];
  if (matches.length !== 1) throw new Error('Invalid Cargo.lock root package version.');
  return matches[0][1];
}

function replaceLockVersion(source, version) {
  const section = rootLockSection(source);
  const updated = section.replace(/^version\s*=\s*"[^"]+"\s*$/m, `version = "${version}"`);
  return source.replace(section, updated);
}

async function readSources(root) {
  return Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, relative]) => [
    key,
    await readFile(join(root, relative), 'utf8'),
  ])));
}

function versionsFromSources(sources) {
  const packageJson = parseJson(sources.packageJson, 'package.json');
  const tauriConfig = parseJson(sources.tauriConfig, 'tauri.conf.json');
  return {
    packageJson: packageJson.version,
    tauriConfig: tauriConfig.version,
    cargoToml: readTomlVersion(sources.cargoToml, '[package]', 'Cargo.toml'),
    cargoLock: readLockVersion(sources.cargoLock),
  };
}

export async function readVersions(root) {
  return versionsFromSources(await readSources(root));
}

function renderSources(sources, version) {
  const packageJson = parseJson(sources.packageJson, 'package.json');
  const tauriConfig = parseJson(sources.tauriConfig, 'tauri.conf.json');
  packageJson.version = version;
  tauriConfig.version = version;
  return {
    packageJson: `${JSON.stringify(packageJson, null, 2)}\n`,
    tauriConfig: `${JSON.stringify(tauriConfig, null, 2)}\n`,
    cargoToml: replaceTomlVersion(sources.cargoToml, '[package]', 'Cargo.toml', version),
    cargoLock: replaceLockVersion(sources.cargoLock, version),
  };
}

export async function setVersion(root, requestedVersion) {
  const version = validateVersion(requestedVersion);
  const sources = await readSources(root);
  const current = Object.values(versionsFromSources(sources));
  if (current.some((value) => value !== current[0])) {
    throw new Error('Existing release version sources must match before an update.');
  }
  const rendered = renderSources(sources, version);
  const transaction = randomUUID();
  const staged = Object.entries(files).map(([key, relative]) => ({
    target: join(root, relative),
    temporary: join(root, `${relative}.geo-version-${transaction}.tmp`),
    backup: join(root, `${relative}.geo-version-${transaction}.bak`),
    contents: rendered[key],
  }));
  const committed = [];
  try {
    await Promise.all(staged.map((entry) => writeFile(entry.temporary, entry.contents, { flag: 'wx' })));
    for (const entry of staged) {
      await rename(entry.target, entry.backup);
      try {
        await rename(entry.temporary, entry.target);
      } catch (error) {
        await rename(entry.backup, entry.target);
        throw error;
      }
      committed.push(entry);
    }
    await Promise.all(committed.map((entry) => rm(entry.backup)));
  } catch (error) {
    for (const entry of committed.reverse()) {
      await rm(entry.target, { force: true });
      await rename(entry.backup, entry.target);
    }
    await Promise.all(staged.flatMap((entry) => [entry.temporary, entry.backup]).map((path) => rm(path, { force: true })));
    throw error;
  }
}

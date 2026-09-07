import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cli } from './lib.mjs';
import { generateNotices, parseNoticesArgs, rustDependencyPackages } from './notices-lib.mjs';

const maxBuffer = 64 * 1024 * 1024;

function run(command, args) {
  return spawnSync(command, args, { cwd: process.cwd(), env: process.env, encoding: 'utf8', shell: false, windowsHide: true, maxBuffer });
}

function pnpm(args) {
  if (process.env.npm_execpath) return run(process.execPath, [process.env.npm_execpath, ...args]);
  return run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args);
}

function parseResult(result, label) {
  if (result.status !== 0) throw new Error(`Cannot collect ${label} metadata.`);
  try { return JSON.parse(result.stdout); } catch { throw new Error(`Invalid ${label} metadata.`); }
}

async function fallbackLicenses() {
  const roots = parseResult(pnpm(['list', '--prod', '--json', '--depth', 'Infinity']), 'pnpm production dependency');
  if (!Array.isArray(roots) || roots.length !== 1 || typeof roots[0]?.dependencies !== 'object') throw new Error('Invalid pnpm production dependency metadata.');
  const packages = new Map();
  const visit = async (dependencies) => {
    for (const dependency of Object.values(dependencies ?? {})) {
      if (!dependency || typeof dependency.path !== 'string' || typeof dependency.dependencies !== 'object' && dependency.dependencies != null) {
        throw new Error('Invalid pnpm production dependency metadata.');
      }
      const manifest = JSON.parse(await readFile(join(dependency.path, 'package.json'), 'utf8'));
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || typeof manifest.license !== 'string') {
        throw new Error('Installed Node dependency is missing name, version, or license metadata.');
      }
      packages.set(`${manifest.name}\0${manifest.version}`, { name: manifest.name, versions: [manifest.version], license: manifest.license, paths: [dependency.path] });
      await visit(dependency.dependencies);
    }
  };
  await visit(roots[0].dependencies);
  const grouped = {};
  for (const entry of packages.values()) (grouped[entry.license] ??= []).push(entry);
  return grouped;
}

const licenseName = /^(?:LICENSE|LICENCE|COPYING|NOTICE|UNLICENSE)(?:[._-].*)?$/i;

async function collectLicenseDocuments(pnpmLicenses, cargoMetadata) {
  const sources = [];
  for (const entries of Object.values(pnpmLicenses)) {
    for (const entry of entries) {
      for (const path of entry.paths ?? []) {
        const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
        sources.push({ package: `${manifest.name}@${manifest.version}`, directory: path });
      }
    }
  }
  for (const entry of rustDependencyPackages(cargoMetadata)) {
    const directory = dirname(entry.manifest_path);
    sources.push({ package: `${entry.name}@${entry.version}`, directory, licenseFile: entry.license_file });
  }
  const documents = new Map();
  for (const source of sources) {
    const candidates = new Set();
    if (typeof source.licenseFile === 'string' && source.licenseFile) candidates.add(resolve(source.directory, source.licenseFile));
    for (const entry of await readdir(source.directory, { withFileTypes: true })) {
      if (entry.isFile() && licenseName.test(entry.name)) candidates.add(join(source.directory, entry.name));
    }
    for (const path of candidates) {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size === 0 || stat.size > 1024 * 1024) throw new Error('Invalid dependency license document.');
      const text = (await readFile(path, 'utf8')).replaceAll('\r\n', '\n').replaceAll('\t', '    ')
        .split('\n').map((line) => line.trimEnd()).join('\n').trimEnd();
      if (!text || text.includes('\0')) throw new Error('Invalid dependency license document.');
      const digest = createHash('sha256').update(text).digest('hex');
      const document = documents.get(digest) ?? { packages: new Set(), filenames: new Set(), text };
      document.packages.add(source.package);
      document.filenames.add(basename(path));
      documents.set(digest, document);
    }
  }
  return [...documents.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([, document]) => ({ packages: [...document.packages], filenames: [...document.filenames], text: document.text }));
}

await cli(async () => {
  const { check } = parseNoticesArgs(process.argv.slice(2));
  const root = process.cwd();
  const licenseResult = pnpm(['licenses', 'list', '--prod', '--json']);
  const pnpmLicenses = licenseResult.status === 0 ? parseResult(licenseResult, 'pnpm license') : await fallbackLicenses();
  const cargo = parseResult(run('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1', '--locked', '--offline', '--filter-platform', 'x86_64-pc-windows-msvc']), 'Cargo');
  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const documents = await collectLicenseDocuments(pnpmLicenses, cargo);
  const output = generateNotices(pnpmLicenses, cargo, Object.keys(packageJson.dependencies ?? {}), documents);
  const target = join(root, 'THIRD_PARTY_NOTICES.md');
  if (check) {
    let current;
    try { current = await readFile(target, 'utf8'); } catch { throw new Error('THIRD_PARTY_NOTICES.md is missing; run release:notices.'); }
    if (current !== output) throw new Error('THIRD_PARTY_NOTICES.md is stale; run release:notices.');
    process.stdout.write('THIRD_PARTY_NOTICES.md is current.\n');
  } else {
    await writeFile(target, output);
    process.stdout.write('Generated THIRD_PARTY_NOTICES.md.\n');
  }
});

// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots = [];
const files = [
  'package.json',
  'src-tauri/tauri.conf.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
];

async function fixture(version = '0.1.0') {
  const root = await mkdtemp(join(tmpdir(), 'geo-version-test-'));
  roots.push(root);
  await mkdir(join(root, 'src-tauri'), { recursive: true });
  await writeFile(join(root, 'package.json'), `${JSON.stringify({ name: 'spatial-memory-coach', version }, null, 2)}\n`);
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), `${JSON.stringify({ productName: '空间记忆教练', version }, null, 2)}\n`);
  await writeFile(join(root, 'src-tauri/Cargo.toml'), `[package]\nname = "spatial-memory-coach"\nversion = "${version}"\nedition = "2021"\n\n[dependencies]\nserde = "1"\n`);
  await writeFile(join(root, 'src-tauri/Cargo.lock'), `version = 4\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "spatial-memory-coach"\nversion = "${version}"\ndependencies = [\n "serde",\n]\n`);
  return root;
}

async function bytes(root) {
  return Promise.all(files.map((file) => readFile(join(root, file))));
}

async function versionModule() {
  const module = await import('./version-lib.mjs').catch(() => ({}));
  expect(module.setVersion).toBeTypeOf('function');
  return module;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('release version synchronization', () => {
  it.each(['0.1.0-rc.1', '0.1.0-rc.2', '0.1.0'])('synchronizes all four version sources to %s', async (version) => {
    const root = await fixture('0.0.9');
    const { readVersions, setVersion } = await versionModule();

    await setVersion(root, version);

    await expect(readVersions(root)).resolves.toEqual({
      packageJson: version,
      tauriConfig: version,
      cargoToml: version,
      cargoLock: version,
    });
  });

  it.each([
    '0.1.0-rc.0',
    '0.1.0-rc.01',
    '01.1.0',
    '0.01.0',
    '0.1.00',
    '0.1.0-beta.1',
    '0.1.0+build.1',
    '../0.1.0',
    '0.1.0;echo injected',
  ])('rejects unsafe or unsupported version %s without changing files', async (version) => {
    const root = await fixture();
    const before = await bytes(root);
    const { setVersion } = await versionModule();

    await expect(setVersion(root, version)).rejects.toThrow('version');

    const after = await bytes(root);
    after.forEach((value, index) => expect(value.equals(before[index])).toBe(true));
  });

  it.each(files)('rejects existing drift in %s without changing any file', async (driftedFile) => {
    const root = await fixture();
    const path = join(root, driftedFile);
    const source = await readFile(path, 'utf8');
    await writeFile(path, source.replace('0.1.0', '0.2.0'));
    const before = await bytes(root);
    const { setVersion } = await versionModule();

    await expect(setVersion(root, '0.1.0-rc.1')).rejects.toThrow('match');

    const after = await bytes(root);
    after.forEach((value, index) => expect(value.equals(before[index])).toBe(true));
  });
});

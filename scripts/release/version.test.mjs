// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
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

async function expectOriginalFiles(root, before) {
  const after = await bytes(root);
  after.forEach((value, index) => expect(value.equals(before[index])).toBe(true));
}

async function expectNoTransactionFiles(root) {
  const names = [
    ...(await readdir(root)),
    ...(await readdir(join(root, 'src-tauri'))),
  ];
  expect(names.some((name) => name.includes('.geo-version-'))).toBe(false);
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

  it('cleans staged files and preserves every source when staging fails', async () => {
    const root = await fixture();
    const before = await bytes(root);
    const { setVersion } = await versionModule();

    await expect(setVersion(root, '0.1.0-rc.1', {
      writeFile: async (path, ...args) => {
        if (String(path).includes('tauri.conf.json.geo-version-')) throw new Error('injected staging failure');
        return writeFile(path, ...args);
      },
      rename,
      rm,
    })).rejects.toThrow('injected staging failure');

    await expectOriginalFiles(root, before);
    await expectNoTransactionFiles(root);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('rolls back every source when replacement rename %i fails', async (failureAt) => {
    const root = await fixture();
    const before = await bytes(root);
    const { setVersion } = await versionModule();
    let calls = 0;

    await expect(setVersion(root, '0.1.0-rc.1', {
      writeFile,
      rename: async (...args) => {
        calls++;
        if (calls === failureAt) throw new Error(`injected rename ${failureAt}`);
        return rename(...args);
      },
      rm,
    })).rejects.toThrow('injected rename');

    await expectOriginalFiles(root, before);
    await expectNoTransactionFiles(root);
  });

  it('never removes a current version source when rollback rename fails', async () => {
    const root = await fixture();
    const { setVersion } = await versionModule();
    let calls = 0;

    await expect(setVersion(root, '0.1.0-rc.1', {
      writeFile,
      rename: async (from, to) => {
        calls++;
        if (calls === 5 || (calls > 5 && String(from).endsWith('.bak'))) throw new Error('injected rollback failure');
        return rename(from, to);
      },
      rm,
    })).rejects.toThrow();

    for (const file of files) await expect(readFile(join(root, file))).resolves.toBeInstanceOf(Buffer);
  });

  it('treats partial backup cleanup failure as post-commit housekeeping', async () => {
    const root = await fixture('0.0.9');
    const { readVersions, setVersion } = await versionModule();
    let failed = false;

    await expect(setVersion(root, '0.1.0-rc.1', {
      writeFile,
      rename,
      rm: async (path, ...args) => {
        if (!failed && String(path).endsWith('.bak')) {
          failed = true;
          throw new Error('injected backup cleanup failure');
        }
        return rm(path, ...args);
      },
    })).resolves.toBeUndefined();

    await expect(readVersions(root)).resolves.toEqual({
      packageJson: '0.1.0-rc.1',
      tauriConfig: '0.1.0-rc.1',
      cargoToml: '0.1.0-rc.1',
      cargoLock: '0.1.0-rc.1',
    });
  });
});

// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
const script = (name) => resolve('scripts/release', name);
const packs = ['cn-provincial-divisions', 'cn-shanghai-districts', 'us-states'];
const resources = ['manifest.json', 'entities.json', 'map.topojson', 'sources.json']
  .map((file) => `resources/content/*/${file}`);
const endpoint = 'https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json';
// Deliberately synthetic format-only fixtures; never usable for signing a release.
const packet = (length) => Buffer.concat([Buffer.from('Ed'), Buffer.alloc(length - 2, 7)]).toString('base64');
const publicKey = Buffer.from(`untrusted comment: synthetic test public key\n${packet(42)}\n`).toString('base64');
const signature = Buffer.from(`untrusted comment: synthetic test signature\n${packet(74)}\ntrusted comment: test only\n${Buffer.alloc(64, 9).toString('base64')}\n`).toString('base64');
const env = { ...process.env, GITHUB_REPOSITORY: 'liafbkt/Geo_Learn', GITHUB_REF: 'refs/tags/v0.1.0', TAURI_SIGNING_PRIVATE_KEY: 'SYNTHETIC_SECRET_VALUE', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'SYNTHETIC_PASSWORD_VALUE' };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'geo-release-test-'));
  roots.push(root);
  await mkdir(join(root, 'src-tauri'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  await writeFile(join(root, 'src-tauri/Cargo.toml'), '[package]\nname = "test"\nversion = "0.1.0"\n');
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version: '0.1.0', bundle: { targets: ['nsis'], createUpdaterArtifacts: true, resources }, plugins: { updater: { pubkey: publicKey, endpoints: [endpoint] } } }));
  for (const pack of packs) {
    await mkdir(join(root, 'src-tauri/resources/content', pack), { recursive: true });
    for (const file of ['manifest.json', 'entities.json', 'sources.json', 'map.topojson']) await writeFile(join(root, 'src-tauri/resources/content', pack, file), '{}');
  }
  return root;
}
function run(name, root, overrides = {}, args = []) {
  return spawnSync(process.execPath, [script(name), ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8' });
}
async function editConfig(root, mutate) {
  const path = join(root, 'src-tauri/tauri.conf.json');
  const config = JSON.parse(await readFile(path, 'utf8'));
  mutate(config);
  await writeFile(path, JSON.stringify(config));
}
async function installer(root) {
  const dir = join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '空间记忆教练_0.1.0_x64-setup.exe'), Buffer.from('MZsynthetic-test-installer'));
  await writeFile(join(dir, '空间记忆教练_0.1.0_x64-setup.exe.sig'), signature);
  return dir;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('release preflight CLI', () => {
  it('accepts matching tag/version, format-valid public key, and complete resources', async () => {
    const result = run('preflight.mjs', await fixture(), {}, ['--secrets']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it.each(['refs/heads/main', 'refs/tags/v0.1.0;echo injected', 'refs/tags/v01.1.0', 'refs/tags/v0.2.0', 'refs/tags/v0.1.0-beta.1'])('blocks unsafe or mismatched ref %s', async (ref) => {
    expect(run('preflight.mjs', await fixture(), { GITHUB_REF: ref }).status).not.toBe(0);
  });
  it('blocks a different repository', async () => {
    expect(run('preflight.mjs', await fixture(), { GITHUB_REPOSITORY: 'other/repo' }).status).not.toBe(0);
  });
  it('blocks Cargo version drift', async () => {
    const root = await fixture();
    await writeFile(join(root, 'src-tauri/Cargo.toml'), '[package]\nversion = "0.2.0"\n');
    expect(run('preflight.mjs', root).status).not.toBe(0);
  });
  it.each(['', 'not-base64', Buffer.from('not a public key').toString('base64')])('blocks malformed public keys without echoing values', async (key) => {
    const root = await fixture();
    await editConfig(root, (config) => { config.plugins.updater.pubkey = key; });
    const result = run('preflight.mjs', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('public key');
  });
  it('blocks endpoint substitution', async () => {
    const root = await fixture();
    await editConfig(root, (config) => { config.plugins.updater.endpoints = ['https://attacker.invalid/latest.json']; });
    expect(run('preflight.mjs', root).status).not.toBe(0);
  });
  it('fails closed on an empty resource tree', async () => {
    const root = await fixture();
    await rm(join(root, 'src-tauri/resources/content'), { recursive: true });
    await mkdir(join(root, 'src-tauri/resources/content'));
    const result = run('preflight.mjs', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('cn-provincial-divisions');
  });
  it('blocks a missing required pack file', async () => {
    const root = await fixture();
    await rm(join(root, 'src-tauri/resources/content/us-states/map.topojson'));
    expect(run('preflight.mjs', root).status).not.toBe(0);
  });
  it.each(['TAURI_SIGNING_PRIVATE_KEY', 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'])('reports missing %s by name without secret contents', async (name) => {
    const result = run('preflight.mjs', await fixture(), { [name]: '' }, ['--secrets']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(name);
    expect(result.stderr + result.stdout).not.toContain('SYNTHETIC_SECRET_VALUE');
    expect(result.stderr + result.stdout).not.toContain('SYNTHETIC_PASSWORD_VALUE');
  });
});

describe('release artifact preparation CLI', () => {
  it('writes exactly installer, signature, and updater JSON with signature contents and ASCII asset URL', async () => {
    const root = await fixture();
    await installer(root);
    const result = run('prepare-artifacts.mjs', root);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect((await readdir(join(root, 'release-artifacts'))).sort()).toEqual(['GeoLearn_0.1.0_x64-setup.exe', 'GeoLearn_0.1.0_x64-setup.exe.sig', 'latest.json']);
    const manifest = JSON.parse(await readFile(join(root, 'release-artifacts/latest.json'), 'utf8'));
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.platforms).toEqual({ 'windows-x86_64': { signature, url: 'https://github.com/liafbkt/Geo_Learn/releases/download/v0.1.0/GeoLearn_0.1.0_x64-setup.exe' } });
    expect(await readFile(join(root, 'release-artifacts/GeoLearn_0.1.0_x64-setup.exe.sig'), 'utf8')).toBe(signature);
  });
  it('fails when no installer exists', async () => {
    expect(run('prepare-artifacts.mjs', await fixture()).status).not.toBe(0);
  });
  it('fails on ambiguous installers', async () => {
    const root = await fixture();
    const dir = await installer(root);
    await writeFile(join(dir, 'extra.exe'), 'MZ');
    expect(run('prepare-artifacts.mjs', root).status).not.toBe(0);
  });
  it.each(['', 'garbage', 'installer.exe.sig'])('rejects malformed signature %s', async (value) => {
    const root = await fixture();
    const dir = await installer(root);
    await writeFile(join(dir, '空间记忆教练_0.1.0_x64-setup.exe.sig'), value);
    expect(run('prepare-artifacts.mjs', root).status).not.toBe(0);
  });
  it('refuses to mix with an existing output directory', async () => {
    const root = await fixture();
    await installer(root);
    await mkdir(join(root, 'release-artifacts'));
    await writeFile(join(root, 'release-artifacts/unrelated.txt'), 'keep');
    expect(run('prepare-artifacts.mjs', root).status).not.toBe(0);
    expect(await readFile(join(root, 'release-artifacts/unrelated.txt'), 'utf8')).toBe('keep');
  });
});

describe('draft release publishing', () => {
  async function ready() {
    const root = await fixture();
    await installer(root);
    expect(run('prepare-artifacts.mjs', root).status).toBe(0);
    return root;
  }
  async function publisher() {
    const module = await import('./publish-lib.mjs').catch(() => ({}));
    expect(module.publishDraft).toBeTypeOf('function');
    return module.publishDraft;
  }
  it('creates a draft with exactly the three prepared assets and verifies the remote tag', async () => {
    const publish = await publisher();
    const root = await ready();
    const calls = [];
    await publish(root, env, (args) => {
      calls.push(args);
      if (args[0] === 'api') return { status: 0, stdout: '[[]]' };
      return { status: 0, stdout: '' };
    });
    expect(calls[0]).toEqual(['api', 'repos/liafbkt/Geo_Learn/releases', '--paginate', '--slurp']);
    expect(calls[1]).toEqual(['release', 'create', 'v0.1.0', ...['GeoLearn_0.1.0_x64-setup.exe', 'GeoLearn_0.1.0_x64-setup.exe.sig', 'latest.json'].map((name) => join(root, 'release-artifacts', name)), '--repo', 'liafbkt/Geo_Learn', '--draft', '--verify-tag', '--title', 'Geo Learn v0.1.0', '--notes', 'Draft only. Human content/map review and release checklist approval are required before publication.']);
  });
  it.each([false, true])('never overwrites an existing release (draft=%s)', async (draft) => {
    const publish = await publisher();
    const root = await ready();
    const calls = [];
    await expect(publish(root, env, (args) => { calls.push(args); return { status: 0, stdout: JSON.stringify([[{ tag_name: 'v0.1.0', draft }]]) }; })).rejects.toThrow('already exists');
    expect(calls).toHaveLength(1);
  });
  it('does not interpret an API permission failure as a missing release', async () => {
    const publish = await publisher();
    const root = await ready();
    let calls = 0;
    await expect(publish(root, env, () => { calls++; return { status: 1, stdout: '', stderr: 'sensitive remote failure' }; })).rejects.toThrow('inspect');
    expect(calls).toBe(1);
  });
  it('blocks an altered download host before calling GitHub', async () => {
    const publish = await publisher();
    const root = await ready();
    const path = join(root, 'release-artifacts/latest.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    value.platforms['windows-x86_64'].url = 'https://attacker.invalid/setup.exe';
    await writeFile(path, JSON.stringify(value));
    let called = false;
    await expect(publish(root, env, () => { called = true; return { status: 0 }; })).rejects.toThrow('manifest');
    expect(called).toBe(false);
  });
  it('blocks extra artifacts before calling GitHub', async () => {
    const publish = await publisher();
    const root = await ready();
    await writeFile(join(root, 'release-artifacts/extra.zip'), 'unexpected');
    let called = false;
    await expect(publish(root, env, () => { called = true; return { status: 0 }; })).rejects.toThrow('exactly');
    expect(called).toBe(false);
  });
  it('blocks an installer changed after signature verification and preparation', async () => {
    const publish = await publisher();
    const root = await ready();
    await writeFile(join(root, 'release-artifacts/GeoLearn_0.1.0_x64-setup.exe'), 'MZmodified-installer');
    let called = false;
    await expect(publish(root, env, () => { called = true; return { status: 0 }; })).rejects.toThrow('installer');
    expect(called).toBe(false);
  });
});

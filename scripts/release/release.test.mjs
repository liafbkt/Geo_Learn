// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
const script = (name) => resolve('scripts/release', name);
const packs = ['cn-provincial-divisions', 'cn-shanghai-districts', 'us-states'];
const resources = ['manifest.json', 'entities.json', 'map.topojson', 'sources.json']
  .map((file) => `resources/content/*/${file}`).concat('../THIRD_PARTY_NOTICES.md');
const endpoint = 'https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json';
// Deliberately synthetic format-only fixtures; never usable for signing a release.
const packet = (length) => Buffer.concat([Buffer.from('Ed'), Buffer.alloc(length - 2, 7)]).toString('base64');
const publicKey = Buffer.from(`untrusted comment: synthetic test public key\n${packet(42)}\n`).toString('base64');
const signature = Buffer.from(`untrusted comment: synthetic test signature\n${packet(74)}\ntrusted comment: test only\n${Buffer.alloc(64, 9).toString('base64')}\n`).toString('base64');
const env = { ...process.env, GITHUB_REPOSITORY: 'liafbkt/Geo_Learn', GITHUB_REF: 'refs/tags/v0.1.0', TAURI_SIGNING_PRIVATE_KEY: 'SYNTHETIC_SECRET_VALUE', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'SYNTHETIC_PASSWORD_VALUE' };
const envFor = (version) => ({ ...env, GITHUB_REF: `refs/tags/v${version}` });
async function fixture(version = '0.1.0') {
  const root = await mkdtemp(join(tmpdir(), 'geo-release-test-'));
  roots.push(root);
  await mkdir(join(root, 'src-tauri'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'spatial-memory-coach', version }));
  await writeFile(join(root, 'src-tauri/Cargo.toml'), `[package]\nname = "spatial-memory-coach"\nversion = "${version}"\n`);
  await writeFile(join(root, 'src-tauri/Cargo.lock'), `version = 4\n\n[[package]]\nname = "spatial-memory-coach"\nversion = "${version}"\n`);
  await writeFile(join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ version, bundle: { targets: ['nsis'], createUpdaterArtifacts: true, resources }, plugins: { updater: { pubkey: publicKey, endpoints: [endpoint] } } }));
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.md'), '# Third-Party Notices\n');
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
async function installer(root, version = '0.1.0') {
  const dir = join(root, 'src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `空间记忆教练_${version}_x64-setup.exe`), Buffer.from('MZsynthetic-test-installer'));
  await writeFile(join(dir, `空间记忆教练_${version}_x64-setup.exe.sig`), signature);
  return dir;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe('release preflight CLI', () => {
  it('accepts matching tag/version, format-valid public key, and complete resources', async () => {
    const result = run('preflight.mjs', await fixture(), {}, ['--secrets']);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it('accepts an immutable release candidate identity', async () => {
    const result = run('preflight.mjs', await fixture('0.1.0-rc.1'), envFor('0.1.0-rc.1'));
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it.each(['refs/heads/main', 'refs/tags/v0.1.0;echo injected', 'refs/tags/v01.1.0', 'refs/tags/v0.2.0', 'refs/tags/v0.1.0-beta.1', 'refs/tags/v0.1.0-rc.0', 'refs/tags/v0.1.0-rc.01'])('blocks unsafe or mismatched ref %s', async (ref) => {
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
  it('writes exactly four assets with updater metadata and sorted lowercase SHA-256 checksums', async () => {
    const root = await fixture();
    await installer(root);
    const result = run('prepare-artifacts.mjs', root);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const expected = ['GeoLearn_0.1.0_x64-setup.exe', 'GeoLearn_0.1.0_x64-setup.exe.sig', 'SHA256SUMS.txt', 'latest.json'];
    expect((await readdir(join(root, 'release-artifacts'))).sort()).toEqual(expected);
    const manifest = JSON.parse(await readFile(join(root, 'release-artifacts/latest.json'), 'utf8'));
    expect(manifest.version).toBe('0.1.0');
    expect(manifest.notes).toContain('Personal-use');
    expect(manifest.notes).toContain('current-user observations are recorded separately');
    expect(manifest.notes).not.toContain('verified on the current user environment');
    expect(manifest.notes).not.toContain('human content/map review');
    expect(manifest.platforms).toEqual({ 'windows-x86_64': { signature, url: 'https://github.com/liafbkt/Geo_Learn/releases/download/v0.1.0/GeoLearn_0.1.0_x64-setup.exe' } });
    expect(await readFile(join(root, 'release-artifacts/GeoLearn_0.1.0_x64-setup.exe.sig'), 'utf8')).toBe(signature);
    const checksummed = expected.filter((name) => name !== 'SHA256SUMS.txt').sort();
    const checksum = await readFile(join(root, 'release-artifacts/SHA256SUMS.txt'), 'utf8');
    const expectedChecksum = `${(await Promise.all(checksummed.map(async (name) => `${createHash('sha256').update(await readFile(join(root, 'release-artifacts', name))).digest('hex')}  ${name}`))).join('\n')}\n`;
    expect(checksum).toBe(expectedChecksum);
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
  it('creates a stable draft with exactly four prepared assets and verifies the remote tag', async () => {
    const publish = await publisher();
    const root = await ready();
    const calls = [];
    await publish(root, env, (args) => {
      calls.push(args);
      if (args[0] === 'api') return { status: 0, stdout: '[[]]' };
      return { status: 0, stdout: '' };
    });
    expect(calls[0]).toEqual(['api', 'repos/liafbkt/Geo_Learn/releases', '--paginate', '--slurp']);
    expect(calls[1]).toEqual(['release', 'create', 'v0.1.0', ...['GeoLearn_0.1.0_x64-setup.exe', 'GeoLearn_0.1.0_x64-setup.exe.sig', 'latest.json', 'SHA256SUMS.txt'].map((name) => join(root, 'release-artifacts', name)), '--repo', 'liafbkt/Geo_Learn', '--draft', '--verify-tag', '--title', 'Geo Learn v0.1.0', '--notes', expect.stringContaining('not an Authenticode publisher signature')]);
  });
  it('blocks an installer configuration that omits the generated notices', async () => {
    const root = await fixture();
    await editConfig(root, (config) => { config.bundle.resources = config.bundle.resources.filter((entry) => entry !== '../THIRD_PARTY_NOTICES.md'); });
    expect(run('preflight.mjs', root).status).not.toBe(0);
  });
  it('marks a candidate draft as a prerelease', async () => {
    const publish = await publisher();
    const version = '0.1.0-rc.1';
    const root = await fixture(version);
    await installer(root, version);
    expect(run('prepare-artifacts.mjs', root, envFor(version)).status).toBe(0);
    const calls = [];
    await publish(root, envFor(version), (args) => {
      calls.push(args);
      return { status: 0, stdout: args[0] === 'api' ? '[[]]' : '' };
    });
    expect(calls[1]).toContain('--prerelease');
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
  it('blocks an installer changed after checksum preparation', async () => {
    const publish = await publisher();
    const root = await ready();
    await writeFile(join(root, 'release-artifacts/GeoLearn_0.1.0_x64-setup.exe'), 'MZmodified-installer');
    let called = false;
    await expect(publish(root, env, () => { called = true; return { status: 0 }; })).rejects.toThrow('SHA256');
    expect(called).toBe(false);
  });
});

describe('immutable release promotion', () => {
  async function promoter() {
    const module = await import('./publish-lib.mjs').catch(() => ({}));
    expect(module.promoteRelease).toBeTypeOf('function');
    return module.promoteRelease;
  }

  async function remoteDraft(version = '0.1.0') {
    const root = await fixture(version);
    await installer(root, version);
    expect(run('prepare-artifacts.mjs', root, envFor(version)).status).toBe(0);
    const names = ['GeoLearn_' + version + '_x64-setup.exe', 'GeoLearn_' + version + '_x64-setup.exe.sig', 'latest.json', 'SHA256SUMS.txt'];
    const contents = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(root, 'release-artifacts', name))])));
    const metadata = {
      id: 17,
      tag_name: `v${version}`,
      draft: true,
      prerelease: version.includes('-rc.'),
      assets: names.map((name, index) => ({
        id: 100 + index,
        name,
        size: contents[name].length,
        url: `https://api.github.com/repos/liafbkt/Geo_Learn/releases/assets/${100 + index}`,
      })),
    };
    return { root, version, metadata, contents };
  }

  function remoteRunner(state, calls) {
    return (args) => {
      calls.push(args);
      if (args[0] !== 'api') return { status: 1, stdout: '', stderr: 'unexpected command' };
      if (args[1] === `repos/liafbkt/Geo_Learn/releases/tags/v${state.version}`) {
        return { status: 0, stdout: state.metadataSource ?? JSON.stringify(state.metadata) };
      }
      const asset = state.metadata.assets?.find((value) => value.url === args[1]);
      if (asset) return { status: 0, stdout: state.contents[asset.name] };
      if (args.includes('PATCH')) return { status: 0, stdout: '{}' };
      return { status: 1, stdout: '', stderr: 'unexpected API request' };
    };
  }

  function trustedVerifier(calls) {
    return async (_root, installerBytes, signatureText) => {
      calls.push({ installerBytes, signatureText });
    };
  }

  it.each([
    ['0.1.0-rc.1', ['-F', 'draft=false', '-F', 'prerelease=true']],
    ['0.1.0', ['-F', 'draft=false', '-F', 'prerelease=false', '-f', 'make_latest=true']],
  ])('promotes %s only after validating all remote assets', async (version, fields) => {
    const promote = await promoter();
    const state = await remoteDraft(version);
    const calls = [];
    const verifications = [];

    await promote(state.root, envFor(version), remoteRunner(state, calls), trustedVerifier(verifications));

    expect(verifications).toHaveLength(1);
    expect(verifications[0].installerBytes).toEqual(state.contents[`GeoLearn_${version}_x64-setup.exe`]);
    expect(verifications[0].signatureText).toBe(state.contents[`GeoLearn_${version}_x64-setup.exe.sig`].toString('utf8').trim());
    expect(calls.at(-1)).toEqual(['api', 'repos/liafbkt/Geo_Learn/releases/17', '-X', 'PATCH', ...fields]);
    expect(calls.filter((args) => args.includes('PATCH'))).toHaveLength(1);
  });

  it.each([
    ['published release', (state) => { state.metadata.draft = false; }],
    ['missing asset', (state) => { state.metadata.assets.pop(); }],
    ['different asset', (state) => { state.metadata.assets[0].name = 'other.exe'; }],
    ['tag mismatch', (state) => { state.metadata.tag_name = 'v9.9.9'; }],
    ['candidate marked stable', (state) => { state.metadata.prerelease = false; }],
    ['checksum mismatch', (state) => { state.contents[`GeoLearn_${state.version}_x64-setup.exe`] = Buffer.from('NZsynthetic-test-installer'); }],
    ['malformed response', (state) => { state.metadataSource = '{'; }],
  ])('refuses a candidate with %s without mutating GitHub', async (_label, mutate) => {
    const promote = await promoter();
    const state = await remoteDraft('0.1.0-rc.1');
    mutate(state);
    const calls = [];

    await expect(promote(state.root, envFor(state.version), remoteRunner(state, calls))).rejects.toThrow();

    expect(calls.some((args) => args.includes('PATCH'))).toBe(false);
  });

  it('refuses a stable draft marked as a prerelease without mutating GitHub', async () => {
    const promote = await promoter();
    const state = await remoteDraft('0.1.0');
    state.metadata.prerelease = true;
    const calls = [];

    await expect(promote(state.root, envFor(state.version), remoteRunner(state, calls))).rejects.toThrow('channel');

    expect(calls.some((args) => args.includes('PATCH'))).toBe(false);
  });

  it('refuses internally consistent remote assets when public-key verification fails', async () => {
    const promote = await promoter();
    const state = await remoteDraft('0.1.0-rc.1');
    const installerName = `GeoLearn_${state.version}_x64-setup.exe`;
    const signatureName = `${installerName}.sig`;
    state.contents[installerName] = Buffer.from('MZconsistently-replaced-installer');
    const manifest = JSON.parse(state.contents['latest.json'].toString('utf8'));
    manifest.platforms['windows-x86_64'].signature = state.contents[signatureName].toString('utf8').trim();
    state.contents['latest.json'] = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const checksummed = [installerName, signatureName, 'latest.json'].sort();
    state.contents['SHA256SUMS.txt'] = Buffer.from(`${checksummed.map((name) => `${createHash('sha256').update(state.contents[name]).digest('hex')}  ${name}`).join('\n')}\n`);
    for (const asset of state.metadata.assets) asset.size = state.contents[asset.name].length;
    const calls = [];

    await expect(promote(state.root, envFor(state.version), remoteRunner(state, calls), async () => {
      throw new Error('Updater signature does not match the committed public key.');
    })).rejects.toThrow('public key');

    expect(calls.some((args) => args.includes('PATCH'))).toBe(false);
  });

  it('rejects an oversized remote asset before attempting its download', async () => {
    const promote = await promoter();
    const state = await remoteDraft('0.1.0-rc.1');
    state.metadata.assets[0].size = 256 * 1024 * 1024 + 1;
    const calls = [];

    await expect(promote(state.root, envFor(state.version), remoteRunner(state, calls), trustedVerifier([]))).rejects.toThrow('size');

    expect(calls).toHaveLength(1);
    expect(calls.some((args) => args.includes('PATCH'))).toBe(false);
  });

  it('validates an installer larger than Node default child-process output buffering', async () => {
    const promote = await promoter();
    const state = await remoteDraft('0.1.0-rc.1');
    const installerName = `GeoLearn_${state.version}_x64-setup.exe`;
    const largeInstaller = Buffer.alloc(2 * 1024 * 1024, 7);
    largeInstaller.set(Buffer.from('MZ'));
    state.contents[installerName] = largeInstaller;
    const checksummed = [installerName, `${installerName}.sig`, 'latest.json'].sort();
    state.contents['SHA256SUMS.txt'] = Buffer.from(`${checksummed.map((name) => `${createHash('sha256').update(state.contents[name]).digest('hex')}  ${name}`).join('\n')}\n`);
    for (const asset of state.metadata.assets) asset.size = state.contents[asset.name].length;
    const calls = [];
    const verifications = [];

    await promote(state.root, envFor(state.version), remoteRunner(state, calls), trustedVerifier(verifications));

    expect(verifications[0].installerBytes).toHaveLength(2 * 1024 * 1024);
    expect(calls.filter((args) => args.includes('PATCH'))).toHaveLength(1);
  });

  it('rejects free-form promotion arguments before any GitHub call', async () => {
    const result = run('promote-release.mjs', await fixture(), {}, ['v0.1.0']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('no arguments');
  });
});

describe('downloaded updater signature verification', () => {
  it('passes an isolated installer pair to the pinned Rust verifier', async () => {
    const module = await import('./publish-lib.mjs').catch(() => ({}));
    expect(module.verifyDownloadedUpdater).toBeTypeOf('function');
    const root = await fixture();
    const calls = [];

    await module.verifyDownloadedUpdater(root, Buffer.from('MZdownloaded-installer'), signature, env, (args, options) => {
      calls.push(args);
      const directory = args.at(-1);
      expect(readFileSync(join(directory, 'GeoLearn-update.exe'))).toEqual(Buffer.from('MZdownloaded-installer'));
      expect(readFileSync(join(directory, 'GeoLearn-update.exe.sig'), 'utf8')).toBe(signature);
      expect(options.cwd).toBe(root);
      expect(options.env.GH_TOKEN).toBeUndefined();
      expect(options.env.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined();
      expect(options.env.GITHUB_REF).toBe(env.GITHUB_REF);
      return { status: 0, stdout: 'verified', stderr: '' };
    });

    expect(calls).toEqual([[
      'run', '--locked', '--manifest-path', 'src-tauri/Cargo.toml', '--example', 'verify_update_artifact', '--', expect.any(String),
    ]]);
  });

  it('fails closed when the committed-public-key verifier rejects the pair', async () => {
    const module = await import('./publish-lib.mjs').catch(() => ({}));
    expect(module.verifyDownloadedUpdater).toBeTypeOf('function');

    await expect(module.verifyDownloadedUpdater(await fixture(), Buffer.from('MZdownloaded-installer'), signature, env, () => ({ status: 1 })))
      .rejects.toThrow('committed public key');
  });
});

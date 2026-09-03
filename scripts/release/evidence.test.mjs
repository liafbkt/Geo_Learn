// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots = [];

const commands = [
  'pnpm lint',
  'pnpm typecheck',
  'pnpm test -- --run --coverage',
  'pnpm exec playwright test',
  'pnpm build',
  'cargo fmt --manifest-path src-tauri/Cargo.toml -- --check',
  'cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings',
  'cargo test --manifest-path src-tauri/Cargo.toml',
  'pnpm content:validate -- --all',
];
const gates = commands.map((command, index) => ({ id: `QG-${String(index + 1).padStart(2, '0')}`, command, status: 'passed' }));
const env = {
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_REF: 'refs/tags/v0.1.0-rc.1',
  GITHUB_RUN_ID: '123456789',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'liafbkt/Geo_Learn',
  RUNNER_OS: 'Windows',
  ImageOS: 'win22',
  ImageVersion: '20260824.1.0',
};
const tools = {
  node: 'v24.18.0',
  pnpm: '11.19.0',
  rustc: 'rustc 1.98.0',
  cargo: 'cargo 1.98.0',
};

async function serializer() {
  const module = await import('./evidence-lib.mjs').catch(() => ({}));
  expect(module.serializeGateEvidence).toBeTypeOf('function');
  return module.serializeGateEvidence;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('release gate evidence', () => {
  it('serializes a deterministic passed record with the nine exact commands', async () => {
    const serialize = await serializer();
    const first = serialize(env, gates, tools);
    const second = serialize({ ...env }, structuredClone(gates), { ...tools });
    expect(first).toBe(second);
    const record = JSON.parse(first);
    expect(record.status).toBe('passed');
    expect(record.ref).toBe('refs/tags/v0.1.0-rc.1');
    expect(record.run.url).toBe('https://github.com/liafbkt/Geo_Learn/actions/runs/123456789');
    expect(record.runner).toEqual({ os: 'Windows', image: 'win22', imageVersion: '20260824.1.0' });
    expect(record.gates.map((gate) => gate.command)).toEqual(commands);
  });

  it.each(['GITHUB_SHA', 'GITHUB_REF', 'GITHUB_RUN_ID', 'GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'RUNNER_OS', 'ImageOS', 'ImageVersion'])('rejects missing %s', async (name) => {
    const serialize = await serializer();
    expect(() => serialize({ ...env, [name]: '' }, gates, tools)).toThrow(name);
  });

  it.each(['refs/heads/main', 'refs/tags/v0.1.0-beta.1'])('rejects non-release ref %s', async (ref) => {
    const serialize = await serializer();
    expect(() => serialize({ ...env, GITHUB_REF: ref }, gates, tools)).toThrow();
  });

  it('rejects duplicate or missing gate IDs', async () => {
    const serialize = await serializer();
    expect(() => serialize(env, [...gates.slice(0, 8), gates[0]], tools)).toThrow('gate');
    expect(() => serialize(env, gates.slice(0, 8), tools)).toThrow('gate');
  });

  it('rejects any non-passed gate or changed command', async () => {
    const serialize = await serializer();
    expect(() => serialize(env, gates.map((gate, index) => index === 3 ? { ...gate, status: 'failed' } : gate), tools)).toThrow('passed');
    expect(() => serialize(env, gates.map((gate, index) => index === 3 ? { ...gate, command: 'pnpm test' } : gate), tools)).toThrow('command');
  });

  it.each(['C:\\Users\\Kevin\\tool.exe', '/Users/kevin/tool', '/home/runner/tool'])('rejects personal path %s', async (value) => {
    const serialize = await serializer();
    expect(() => serialize(env, gates, { ...tools, node: value })).toThrow('path');
  });

  it('creates a fresh evidence directory, refuses stale output, and excludes signing secrets', async () => {
    const module = await import('./evidence-lib.mjs').catch(() => ({}));
    expect(module.writeGateEvidence).toBeTypeOf('function');
    const root = await mkdtemp(join(tmpdir(), 'geo-evidence-test-'));
    roots.push(root);
    const secretEnv = { ...env, TAURI_SIGNING_PRIVATE_KEY: 'DO_NOT_SERIALIZE', TAURI_SIGNING_PRIVATE_KEY_PASSWORD: 'DO_NOT_SERIALIZE_PASSWORD' };

    await module.writeGateEvidence(root, secretEnv, gates, tools);

    const output = await readFile(join(root, 'release-evidence/quality-gates.json'), 'utf8');
    expect(output).not.toContain('DO_NOT_SERIALIZE');
    await expect(module.writeGateEvidence(root, secretEnv, gates, tools)).rejects.toThrow('stale');
  });
});

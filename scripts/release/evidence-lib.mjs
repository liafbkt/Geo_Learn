import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseReleaseTag, repository } from './lib.mjs';

export const qualityGateCommands = [
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

function requiredEnvironment(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${name}.`);
  return value.trim();
}

export function serializeGateEvidence(env, gates, tools) {
  const commit = requiredEnvironment(env, 'GITHUB_SHA');
  const ref = requiredEnvironment(env, 'GITHUB_REF');
  const runId = requiredEnvironment(env, 'GITHUB_RUN_ID');
  const server = requiredEnvironment(env, 'GITHUB_SERVER_URL');
  const repo = requiredEnvironment(env, 'GITHUB_REPOSITORY');
  const runnerOs = requiredEnvironment(env, 'RUNNER_OS');
  const image = requiredEnvironment(env, 'ImageOS');
  const imageVersion = requiredEnvironment(env, 'ImageVersion');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid GITHUB_SHA.');
  parseReleaseTag(ref);
  if (!/^\d+$/.test(runId) || server !== 'https://github.com' || repo !== repository || runnerOs !== 'Windows') {
    throw new Error('Invalid GitHub run or Windows runner identity.');
  }
  if (!Array.isArray(gates) || gates.length !== qualityGateCommands.length) throw new Error('Missing release quality gate evidence.');
  const normalizedGates = qualityGateCommands.map((command, index) => {
    const gate = gates[index];
    const id = `QG-${String(index + 1).padStart(2, '0')}`;
    if (gate?.id !== id) throw new Error('Duplicate, missing, or reordered release gate ID.');
    if (gate.command !== command) throw new Error(`Changed command for ${id}.`);
    if (gate.status !== 'passed') throw new Error(`${id} is not passed.`);
    return { id, command, status: 'passed' };
  });
  const toolKeys = ['node', 'pnpm', 'rustc', 'cargo'];
  const normalizedTools = Object.fromEntries(toolKeys.map((name) => {
    const value = tools?.[name];
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) throw new Error(`Missing tool version: ${name}.`);
    return [name, value.trim()];
  }));
  const record = {
    schemaVersion: 1,
    status: 'passed',
    commit,
    ref,
    run: { id: runId, url: `${server}/${repo}/actions/runs/${runId}` },
    runner: { os: runnerOs, image, imageVersion },
    tools: normalizedTools,
    gates: normalizedGates,
  };
  const output = `${JSON.stringify(record, null, 2)}\n`;
  if (/[A-Za-z]:\\\\Users\\\\|\/Users\/|\/home\//i.test(output)) throw new Error('Gate evidence contains a personal path.');
  return output;
}

export async function writeGateEvidence(root, env, gates, tools) {
  const directory = join(root, 'release-evidence');
  try { await mkdir(directory); } catch { throw new Error('Refusing stale release-evidence directory.'); }
  await writeFile(join(directory, 'quality-gates.json'), serializeGateEvidence(env, gates, tools), { flag: 'wx' });
}

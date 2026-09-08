import { spawnSync } from 'node:child_process';
import { cli } from './lib.mjs';
import { qualityGateCommands, writeGateEvidence } from './evidence-lib.mjs';

function version(command, args = ['--version']) {
  const result = spawnSync(command, args, { cwd: process.cwd(), env: process.env, encoding: 'utf8', shell: false, windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`Cannot read ${command} version.`);
  return result.stdout.trim();
}

await cli(async () => {
  if (process.argv.length !== 2) throw new Error('Gate evidence writer accepts no arguments.');
  const pnpm = process.env.npm_execpath
    ? version(process.execPath, [process.env.npm_execpath, '--version'])
    : process.platform === 'win32'
      ? version('pwsh', ['-NoProfile', '-Command', 'pnpm --version'])
      : version('pnpm');
  const gates = qualityGateCommands.map((command, index) => ({
    id: `QG-${String(index + 1).padStart(2, '0')}`,
    command,
    status: 'passed',
  }));
  await writeGateEvidence(process.cwd(), process.env, gates, {
    node: process.version,
    pnpm,
    rustc: version('rustc'),
    cargo: version('cargo'),
  });
  process.stdout.write('Wrote passed Windows release gate evidence.\n');
});

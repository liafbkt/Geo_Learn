import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

export function normalizeTestArgs(rawArgs) {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  return ['run', ...args.filter((arg) => arg !== '--run')];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'node_modules/vitest/vitest.mjs'), ...normalizeTestArgs(process.argv.slice(2))], {
    cwd: process.cwd(),
    env: process.env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw new Error('Unable to start the locked Vitest runner.');
  process.exitCode = result.status ?? 1;
}

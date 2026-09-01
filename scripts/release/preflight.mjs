import { cli, preflight } from './lib.mjs';

await cli(async () => {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--secrets', '--identity-only'].includes(arg))) throw new Error('Unsupported preflight argument.');
  await preflight(process.cwd(), process.env, { secrets: args.includes('--secrets'), identityOnly: args.includes('--identity-only') });
  process.stdout.write('Release preflight passed.\n');
});

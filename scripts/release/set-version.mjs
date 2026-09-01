import { cli } from './lib.mjs';
import { setVersion } from './version-lib.mjs';

await cli(async () => {
  const args = process.argv.slice(2);
  if (args.length !== 1) throw new Error('Version synchronization requires exactly one version argument.');
  await setVersion(process.cwd(), args[0]);
  process.stdout.write(`Synchronized release version ${args[0]}.\n`);
});

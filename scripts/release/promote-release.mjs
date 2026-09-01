import { cli } from './lib.mjs';
import { promoteRelease } from './publish-lib.mjs';

await cli(async () => {
  if (process.argv.length !== 2) throw new Error('Release promotion accepts no arguments.');
  await promoteRelease(process.cwd(), process.env);
  process.stdout.write('GitHub Release promotion completed after remote asset verification.\n');
});

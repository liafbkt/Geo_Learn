import { cli } from './lib.mjs';
import { publishDraft } from './publish-lib.mjs';

await cli(async () => {
  if (process.argv.length !== 2) throw new Error('Draft publishing accepts no arguments.');
  await publishDraft(process.cwd(), process.env);
  process.stdout.write('GitHub draft release uploaded. Human approval is required before publication.\n');
});

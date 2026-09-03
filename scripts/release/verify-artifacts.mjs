import { cli, preflight } from './lib.mjs';
import { verifyPreparedArtifacts } from './publish-lib.mjs';

await cli(async () => {
  if (process.argv.length !== 2) throw new Error('Artifact verification accepts no arguments.');
  const { version, tag } = await preflight(process.cwd(), process.env);
  await verifyPreparedArtifacts(process.cwd(), version, tag);
  process.stdout.write('Verified exactly four Windows release artifacts and SHA256SUMS.txt.\n');
});

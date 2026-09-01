/** Verify retained evidence, independently of the runtime pack's three checksums. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const requiredOriginals = [
  'cb_2025_us_state_20m.zip', '2025_Gaz_place_national.zip', 'gpo-states-capitals.pdf',
  'census-tiger2025-techdoc.pdf', 'govinfo-about.html',
];
type Input = { file: string; sha256: string };
type Step = { operation: string; parameters: Record<string, unknown> };

export async function verifyRetainedSources(directory: string) {
  const inputs = JSON.parse(await readFile(join(directory, 'external-inputs.json'), 'utf8')) as Input[];
  assert.ok(Array.isArray(inputs), 'Source ledger must be an array');
  for (const input of inputs) {
    assert.ok(input && typeof input.file === 'string' && !/[\\/:]/.test(input.file)
      && !['', '.', '..'].includes(input.file), 'Unsafe source filename');
    assert.match(input.sha256, /^[a-f0-9]{64}$/, 'Invalid source SHA-256');
  }
  assert.deepEqual(inputs.map(input => input.file).sort(), [...requiredOriginals].sort(), 'All five original sources must be retained exactly once');
  const source = JSON.parse(await readFile(join(directory, 'source.input.json'), 'utf8')) as {
    sha256: string; processing: Step[];
  };
  assert.ok(Array.isArray(source.processing), 'Missing processing ledger');
  assert.deepEqual(source.processing.filter(step => step.operation === 'pin-authoritative-input').map(step => step.parameters), inputs,
    'Raw-source ledger differs from the converter processing ledger');

  const hashes: Record<string, string> = {};
  async function check(file: string, expected: unknown, message: string) {
    assert.ok(typeof expected === 'string' && /^[a-f0-9]{64}$/.test(expected), `Missing processing hash: ${file}`);
    const actual = createHash('sha256').update(await readFile(join(directory, file))).digest('hex');
    assert.equal(actual, expected, `${message}: ${file}`);
    hashes[file] = actual;
  }
  for (const input of inputs) await check(input.file, input.sha256, 'Source hash mismatch');
  function parameters(operation: string) {
    const matches = source.processing.filter(step => step.operation === operation);
    assert.equal(matches.length, 1, `Expected one processing step: ${operation}`);
    return matches[0]!.parameters;
  }
  const geometry = parameters('extract-kml-and-select-50-states');
  const points = parameters('join-official-capital-and-gazetteer');
  assert.equal(source.sha256, geometry.outputSha256, 'Geometry source hash differs from its processing ledger');
  await check('regions.geojson', geometry.outputSha256, 'Processing hash mismatch');
  await check('entities.input.json', points.entityOutputSha256, 'Processing hash mismatch');
  await check('points-audit.json', points.auditSha256, 'Processing hash mismatch');
  return { rawFiles: inputs.length, processedFiles: 3, hashes };
}

// Summarize retained observations, without converting retries into first-click passes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const read = name => JSON.parse(fs.readFileSync(path.resolve(__dirname, name), 'utf8'));
const entities = read('../../entities.json');
const regions = read('region-clicks.json');
const keyboard = read('region-keyboard.json');
const capitals = read('capital-clicks.json');
const retarget = read('capital-retarget.json');
const zoom = read('capital-zoom-retarget.json');
const roster = entities.filter(e => e.kind === 'region').map(e => e.id).sort();
const capitalRoster = entities.filter(e => e.kind === 'place').map(e => e.id).sort();
assert.equal(regions.length, 50);
assert.equal(capitals.length, 50);
for (const r of [...regions, ...keyboard, ...retarget, ...zoom]) assert.equal(r.passed, r.id === r.selected);
for (const r of capitals) {
  const entity = entities.find(e => `${e.names.zh} / ${e.names.en}` === r.label);
  assert.ok(entity);
  assert.equal(r.passed, !r.error && r.selected === entity.id);
}
const regionCoverage = [...new Set([...regions, ...keyboard].filter(r => r.passed).map(r => r.selected))].sort();
const capitalCoverage = [...new Set([...capitals, ...retarget, ...zoom].filter(r => r.passed).map(r => r.selected))].sort();
assert.deepEqual(regionCoverage, roster);
assert.deepEqual(capitalCoverage, capitalRoster);
const verification = read('../verification.json');
for (const [file, expected] of Object.entries(verification.hashes)) {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '../..', file))).digest('hex'), expected);
}
const vitest = read('vitest.json');
assert.equal(vitest.numPassedTests, 9);
assert.equal(vitest.numFailedTests, 0);
assert.equal(vitest.numPendingTests, 13);
const summary = {
  date: '2026-08-31', pack: 'us-states', status: 'development-data-ready; default-pointer-UX-incomplete',
  entityCounts: { region: roster.length, place: capitalRoster.length }, primaryAnswerLanguage: 'en',
  questions: { map: 200, choice: 150, text: 150, total: 500 },
  tests: { usPassed: 9, otherPackSkipped: 13, existingBaselinePassed: 290, baselineCommand: 'node node_modules/vitest/vitest.mjs run --exclude scripts/content/launch-packs.test.ts', baselineEvidence: 'Observed process exit 0, 24 test files / 290 tests passed on 2026-08-31 at 18:32:46; not the unfiltered three-pack suite.' },
  regionInteraction: { firstPointerPass: regions.filter(r => r.passed).length, firstPointerFailures: regions.filter(r => !r.passed).map(r => r.id), keyboardFallbackPass: keyboard.filter(r => r.passed).length, coveredEntities: regionCoverage.length },
  capitalInteraction: { firstCenterPointerPass: capitals.filter(r => r.passed).length, visibleEdgeRetargetPass: retarget.filter(r => r.passed).length, zoomPanRetargetPass: zoom.filter(r => r.passed).length, coveredEntities: capitalCoverage.length },
  reproducibility: verification, browser: read('browser-session.json'),
  review: 'Independent read-only agent review: no Critical/Important source-data defect; UI issues remain. AI review is not named-human/legal release approval.',
};
fs.writeFileSync(path.resolve(__dirname, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));

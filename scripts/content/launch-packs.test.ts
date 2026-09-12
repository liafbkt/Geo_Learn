// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import { loadAvailablePacks } from '../../src/content/loadPacks';
import type { ContentPack } from '../../src/content/types';
import { generateQuestion } from '../../src/learning/questions';
import { isAcceptedAnswer, normalizeAnswer } from '../../src/learning/normalizeAnswer';
import { projectMap } from '../../src/map/project';
import { validateContentPack } from './validate';

const contentRoot = join(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/resources/content');
const repositoryRoot = resolve(contentRoot, '../../..');
const usProvenance = join(contentRoot, 'us-states/_provenance');
const chinaPackIds = ['cn-provincial-divisions', 'cn-shanghai-districts'] as const;
const executeFile = promisify(execFile);
const files = ['manifest.json', 'entities.json', 'map.topojson', 'sources.json'] as const;
const provinces = '11 12 13 14 15 21 22 23 31 32 33 34 35 36 37 41 42 43 44 45 46 50 51 52 53 54 61 62 63 64 65 71 81 82'.split(' ');
const districts = '101 104 105 106 107 109 110 112 113 114 115 116 117 118 120 151'.split(' ');
// Independently stated state/capital pairs: a swapped but valid reference must fail.
const stateCapitals: Readonly<Record<string, string>> = {
  al: 'Montgomery', ak: 'Juneau', az: 'Phoenix', ar: 'Little Rock', ca: 'Sacramento',
  co: 'Denver', ct: 'Hartford', de: 'Dover', fl: 'Tallahassee', ga: 'Atlanta',
  hi: 'Honolulu', id: 'Boise', il: 'Springfield', in: 'Indianapolis', ia: 'Des Moines',
  ks: 'Topeka', ky: 'Frankfort', la: 'Baton Rouge', me: 'Augusta', md: 'Annapolis',
  ma: 'Boston', mi: 'Lansing', mn: 'Saint Paul', ms: 'Jackson', mo: 'Jefferson City',
  mt: 'Helena', ne: 'Lincoln', nv: 'Carson City', nh: 'Concord', nj: 'Trenton',
  nm: 'Santa Fe', ny: 'Albany', nc: 'Raleigh', nd: 'Bismarck', oh: 'Columbus',
  ok: 'Oklahoma City', or: 'Salem', pa: 'Harrisburg', ri: 'Providence', sc: 'Columbia',
  sd: 'Pierre', tn: 'Nashville', tx: 'Austin', ut: 'Salt Lake City', vt: 'Montpelier',
  va: 'Richmond', wa: 'Olympia', wv: 'Charleston', wi: 'Madison', wy: 'Cheyenne',
};
const specifications = [
  { id: 'cn-provincial-divisions', region: 34, place: 0, language: 'zh', ids: provinces.map(code => `cn-${code}0000`) },
  { id: 'cn-shanghai-districts', region: 16, place: 0, language: 'zh', ids: districts.map(code => `cn-310${code}`) },
  { id: 'us-states', region: 50, place: 50, language: 'en', ids: Object.keys(stateCapitals).map(code => `us-${code}`) },
] as const;

async function readPack(id: string): Promise<ContentPack> {
  const result = await loadAvailablePacks({
    readPackIds: async () => [id],
    readJson: async (packId, file) => JSON.parse(await readFile(join(contentRoot, packId, file), 'utf8')) as unknown,
  });
  expect(result.rejected, `loader rejected ${id}`).toEqual([]);
  expect(result.available).toHaveLength(1);
  return result.available[0]!;
}

async function hashes(id: string): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(files.map(async file => [
    file, createHash('sha256').update(await readFile(join(contentRoot, id, file))).digest('hex'),
  ])));
}

it.each([{ width: 1200, height: 800 }, { width: 640, height: 360 }])(
  'fits the US mainland prominently with Alaska and Hawaii insets at $width x $height',
  async size => {
    const pack = await readPack('us-states');
    const topology = JSON.parse(await readFile(join(contentRoot, 'us-states/map.topojson'), 'utf8'));
    const result = projectMap(pack, topology, size);
    if (!result.ok) throw new Error(result.error.message);
    const { regions, places } = result.map;
    const mainland = regions.filter(({ entityId }) => !['us-ak', 'us-hi'].includes(entityId));
    const xs = mainland.map(({ centroid }) => centroid[0]);
    const ys = mainland.map(({ centroid }) => centroid[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(size.width * 0.65);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(size.height * 0.45);
    const california = regions.find(({ entityId }) => entityId === 'us-ca')!;
    const alaska = regions.find(({ entityId }) => entityId === 'us-ak')!;
    const hawaii = regions.find(({ entityId }) => entityId === 'us-hi')!;
    expect(alaska.centroid[1]).toBeGreaterThan(california.centroid[1]);
    expect(hawaii.centroid[1]).toBeGreaterThan(california.centroid[1]);
    expect(alaska.centroid[0]).toBeLessThan(hawaii.centroid[0]);
    expect(regions).toHaveLength(50);
    expect(places).toHaveLength(50);
    for (const { entityId, point } of places) {
      expect(point[0], entityId).toBeGreaterThanOrEqual(16);
      expect(point[0], entityId).toBeLessThanOrEqual(size.width - 16);
      expect(point[1], entityId).toBeGreaterThanOrEqual(16);
      expect(point[1], entityId).toBeLessThanOrEqual(size.height - 16);
    }
  },
);

describe.each(specifications)('$id launch content', spec => {
  it('contains all four immutable resources', async () => {
    for (const file of files) {
      await expect(access(join(contentRoot, spec.id, file))).resolves.toBeUndefined();
    }
  });

  it('loads the exact region roster, bilingual entities, and language', async () => {
    const pack = await readPack(spec.id);
    expect(pack.entities.filter(entity => entity.kind === 'region').map(entity => entity.id).sort()).toEqual([...spec.ids].sort());
    expect(pack.entities.filter(entity => entity.kind === 'place')).toHaveLength(spec.place);
    expect(pack.manifest.expectedEntityCounts).toEqual({ region: spec.region, place: spec.place });
    expect(pack.manifest.primaryAnswerLanguage).toBe(spec.language);
    expect(new Set(pack.entities.map(entity => entity.id)).size).toBe(pack.entities.length);
    for (const entity of pack.entities) {
      expect(entity.names.zh).toMatch(/[\u3400-\u9fff]/u);
      expect(entity.names.en).toMatch(/[a-z]/i);
      expect(entity.aliases.every(alias => alias.trim().length > 0)).toBe(true);
      expect(new Set(entity.aliases).size).toBe(entity.aliases.length);
      if (entity.parentId !== undefined) {
        expect(pack.entities.find(parent => parent.id === entity.parentId)?.kind).toBe('region');
      }
    }
  });

  it('passes real geometry, parent-point, source-ledger and checksum validation', async () => {
    expect(await validateContentPack(join(contentRoot, spec.id))).toEqual({ ok: true, packId: spec.id });
    const pack = await readPack(spec.id);
    expect(pack.topologyObjectIds.slice().sort()).toEqual([...spec.ids].sort());
    expect(pack.sources.length).toBeGreaterThan(0);
    for (const source of pack.sources) {
      expect(source.url).toMatch(/^https:\/\//);
      expect(source.organization).not.toMatch(/fixture/i);
      expect(source.license).not.toMatch(/test-only|unknown/i);
    }
    const actual = await hashes(spec.id);
    expect(pack.manifest.checksums).toEqual({
      entities: actual['entities.json'], topology: actual['map.topojson'], sources: actual['sources.json'],
    });
  });

  it('renders finite paths with small-area winding rather than whole-world complements', async () => {
    const pack = await readPack(spec.id);
    const topology = JSON.parse(await readFile(join(contentRoot, spec.id, 'map.topojson'), 'utf8')) as Parameters<typeof feature>[0];
    const regions = feature(topology, topology.objects.regions!);
    if (regions.type !== 'FeatureCollection') throw new Error('Expected a regions FeatureCollection');
    expect(regions.features).toHaveLength(spec.region);
    for (const region of regions.features) {
      expect(geoArea(region), String(region.id)).toBeGreaterThan(0);
      expect(geoArea(region), `${String(region.id)} must not cover the sphere complement`).toBeLessThan(1);
    }
    const projection = projectMap(pack, topology, { width: 1200, height: 800 });
    expect(projection.ok).toBe(true);
    if (!projection.ok) throw new Error(projection.error.message);
    expect(projection.map.regions).toHaveLength(spec.region);
    expect(projection.map.places).toHaveLength(spec.place);
    for (const region of projection.map.regions) {
      expect(region.path).not.toMatch(/NaN|Infinity/);
      expect(region.centroid.every(Number.isFinite)).toBe(true);
    }
  });

  it('generates every declared entity capability at choice and text stages', async () => {
    const pack = await readPack(spec.id);
    const candidateOrder = pack.entities.map(entity => entity.id);
    expect(pack.manifest.capabilities.length).toBeGreaterThan(0);
    const exercised = new Set<string>();
    for (const entity of pack.entities) {
      // Explicit per-entity declarations prevent a place from inheriting region-only skills.
      expect(entity.capabilities?.length).toBeGreaterThan(0);
      for (const skill of entity.capabilities ?? []) {
        expect(pack.manifest.capabilities).toContain(skill);
        for (const stage of ['new', 'mastered'] as const) {
          const question = generateQuestion({ pack, entityId: entity.id, skill, stage, candidateOrder });
          expect(question.kind).toBe(skill);
          expect(question.entityId).toBe(entity.id);
          if (question.presentation === 'choice') {
            expect(new Set(question.candidateEntityIds).size).toBe(4);
            expect(question.candidateEntityIds).toContain(question.kind === 'associate_capital' ? question.capitalId : entity.id);
          }
        }
        exercised.add(skill);
      }
    }
    expect([...exercised].sort()).toEqual([...pack.manifest.capabilities].sort());
  });

  it('validates twice without changing any of the four content hashes', async () => {
    const before = await hashes(spec.id);
    const first = await validateContentPack(join(contentRoot, spec.id));
    const afterFirst = await hashes(spec.id);
    const second = await validateContentPack(join(contentRoot, spec.id));
    expect(first).toEqual({ ok: true, packId: spec.id });
    expect(second).toEqual(first);
    expect(afterFirst).toEqual(before);
    expect(await hashes(spec.id)).toEqual(before);
  });
});

it('keeps China and Shanghai development-only without invented capital/place capabilities', async () => {
  for (const id of ['cn-provincial-divisions', 'cn-shanghai-districts']) {
    const pack = await readPack(id);
    expect(pack.manifest.distributionStatus).toBe('development-only');
    expect([...pack.manifest.capabilities].sort()).toEqual(['identify_region', 'locate_region']);
    expect(pack.entities.some(entity => entity.kind === 'region' && entity.capitalId !== undefined)).toBe(false);
  }
});

it.each(chinaPackIds)('%s accepts all reviewed names and unambiguous aliases, and rejects unsupported questions', async id => {
  // Catches omitted short names, aliases accidentally shared between regions, and invented capabilities.
  const pack = await readPack(id);
  const acceptedBy = new Map<string, string>();
  let generated = 0;
  for (const entity of pack.entities) {
    expect(entity.aliases.length, entity.id).toBeGreaterThan(0);
    for (const skill of ['locate_region', 'identify_region'] as const) {
      for (const stage of ['new', 'mastered'] as const) {
        const question = generateQuestion({ pack, entityId: entity.id, skill, stage, candidateOrder: pack.entities.map(e => e.id) });
        generated++;
        expect(question.presentation).toBe(skill === 'locate_region' ? 'map' : stage === 'new' ? 'choice' : 'text');
        if (question.presentation === 'text') {
          for (const value of [entity.names.zh, entity.names.en, ...entity.aliases]) {
            expect(isAcceptedAnswer(` ${value} `, question.answer), `${entity.id}: ${value}`).toBe(true);
            const previous = acceptedBy.get(normalizeAnswer(value));
            expect(previous === undefined || previous === entity.id, `Ambiguous answer ${value}`).toBe(true);
            acceptedBy.set(normalizeAnswer(value), entity.id);
          }
          expect(isAcceptedAnswer('', question.answer)).toBe(false);
          expect(isAcceptedAnswer('不存在的行政区', question.answer)).toBe(false);
        }
      }
    }
    for (const skill of ['associate_capital', 'locate_place', 'identify_place'] as const) {
      expect(() => generateQuestion({ pack, entityId: entity.id, skill, stage: 'new' })).toThrow();
    }
  }
  expect(generated).toBe(id === 'cn-provincial-divisions' ? 136 : 64);
  const expectedAliases = id === 'cn-provincial-divisions'
    ? { 'cn-440000': ['广东', 'Guangdong Province'], 'cn-640000': ['宁夏', 'Ningxia Hui Autonomous Region'], 'cn-540000': ['西藏', 'Tibet'], 'cn-820000': ['澳门', 'Macau'] }
    : { 'cn-310106': ['静安', "Jing'an"], 'cn-310115': ['浦东', 'Pudong', 'Pudong New District'] };
  for (const [entityId, aliases] of Object.entries(expectedAliases)) {
    const entity = pack.entities.find(e => e.id === entityId)!;
    expect(entity.aliases).toEqual(expect.arrayContaining(aliases));
  }
  const guangdong = pack.entities.find(e => e.id === 'cn-440000');
  if (guangdong) expect(guangdong.aliases).not.toContain('Guangzhou Province');
});

it.each(chinaPackIds)('%s reproduces from pinned originals twice with identical geometry and resource hashes', async id => {
  const { reproducePack } = await import('../../src-tauri/resources/content/cn-provincial-divisions/_provenance/build');
  const temp = await mkdtemp(join(tmpdir(), 'cn-pack-reproduction-test-'));
  try {
    const first = await reproducePack(join(contentRoot, id), join(temp, 'first'));
    const second = await reproducePack(join(contentRoot, id), join(temp, 'second'));
    expect(first).toEqual(second);
    expect(first.hashes).toEqual(await hashes(id));
    expect(first.geometry).toMatchObject(id === 'cn-provincial-divisions'
      ? { regions: 34, rings: 48, vertices: 5731, removedVertices: 0, movedCoordinates: 0 }
      : { regions: 16, rings: 22, vertices: 3103, removedVertices: 0, movedCoordinates: 0 });
  } finally {
    if (dirname(temp) !== resolve(tmpdir()) || !basename(temp).startsWith('cn-pack-reproduction-test-')) throw new Error('Unsafe test cleanup');
    await rm(temp, { recursive: true, force: true });
  }
}, 30000);

it('China source verification rejects tampered raw bytes and unsafe ledger paths before conversion', async () => {
  const { verifySources } = await import('../../src-tauri/resources/content/cn-provincial-divisions/_provenance/build');
  const temp = await mkdtemp(join(tmpdir(), 'cn-pack-source-test-'));
  try {
    const origin = join(contentRoot, chinaPackIds[0], '_provenance');
    const ledger = JSON.parse(await readFile(join(origin, 'source-receipts.json'), 'utf8')) as { file: string }[];
    await mkdir(join(temp, 'raw'));
    await copyFile(join(origin, 'source-receipts.json'), join(temp, 'source-receipts.json'));
    for (const row of ledger) await copyFile(join(origin, 'raw', row.file), join(temp, 'raw', row.file));
    await expect(verifySources(temp)).resolves.toBeDefined();
    await writeFile(join(temp, 'raw', ledger[0]!.file), 'corrupted');
    await expect(verifySources(temp)).rejects.toThrow(/Source hash mismatch/);
    ledger[0]!.file = '../outside.json';
    await writeFile(join(temp, 'source-receipts.json'), JSON.stringify(ledger));
    await expect(verifySources(temp)).rejects.toThrow(/Unsafe source filename/);
  } finally {
    if (dirname(temp) !== resolve(tmpdir()) || !basename(temp).startsWith('cn-pack-source-test-')) throw new Error('Unsafe test cleanup');
    await rm(temp, { recursive: true, force: true });
  }
});

it('has all 50 real US capital relationships, authoritative points, and postal aliases', async () => {
  const pack = await readPack('us-states');
  for (const [code, capitalName] of Object.entries(stateCapitals)) {
    const state = pack.entities.find(entity => entity.id === `us-${code}`);
    expect(state?.kind).toBe('region');
    if (state?.kind !== 'region') throw new Error(`Missing state ${code}`);
    expect(state.aliases).toContain(code.toUpperCase());
    const capital = pack.entities.find(entity => entity.id === state.capitalId);
    expect(capital?.kind).toBe('place');
    expect(capital?.names.en).toBe(capitalName);
    expect(capital?.parentId).toBe(state.id);
    if (capital?.kind !== 'place') throw new Error(`Missing capital for ${code}`);
    expect(capital.coordinate.every(Number.isFinite)).toBe(true);
    expect(capital.coordinate[0]).toBeLessThan(-60);
    expect(capital.coordinate[1]).toBeGreaterThan(18);
  }
});

it('us-states keeps runtime capital points bound to the retained source audit', async () => {
  // Catches replacing a sourced point with another point inside the same state.
  const pack = await readPack('us-states');
  const audit = JSON.parse(await readFile(join(contentRoot, 'us-states/_provenance/points-audit.json'), 'utf8')) as {
    state: string; GEOID: string; WGS84: [number, number];
  }[];
  expect(audit).toHaveLength(50);
  expect(audit.map(row => row.state.toLowerCase()).sort()).toEqual(Object.keys(stateCapitals).sort());
  expect(new Set(audit.map(row => row.GEOID)).size).toBe(50);
  for (const row of audit) {
    const capital = pack.entities.find(entity => entity.id === `us-${row.state.toLowerCase()}-capital`);
    if (capital?.kind !== 'place') throw new Error(`Missing audited capital ${row.state}`);
    expect(capital.coordinate, capital.id).toEqual(row.WGS84);
  }
});

it('us-states generates 500 correctly presented questions and accepts sourced names and aliases', async () => {
  // Catches wrong choice/text stages, state-vs-capital answer substitution,
  // dropped English/postal aliases, and accepting unrelated or blank answers.
  const pack = await readPack('us-states');
  const candidateOrder = pack.entities.map(entity => entity.id);
  const presentations = { map: 0, choice: 0, text: 0 };
  for (const entity of pack.entities) {
    for (const skill of entity.capabilities ?? []) {
      for (const stage of ['new', 'mastered'] as const) {
        const question = generateQuestion({ pack, entityId: entity.id, skill, stage, candidateOrder });
        expect(question.presentation).toBe(skill.startsWith('locate_') ? 'map' : stage === 'new' ? 'choice' : 'text');
        presentations[question.presentation] += 1;
        const answerEntityId = skill === 'associate_capital' && entity.kind === 'region' ? entity.capitalId : entity.id;
        const answerEntity = pack.entities.find(candidate => candidate.id === answerEntityId)!;
        if (question.presentation === 'text') {
          for (const answer of [answerEntity.names.zh, answerEntity.names.en, ...answerEntity.aliases]) {
            expect(isAcceptedAnswer(answer, question.answer), `${entity.id}/${skill}/${answer}`).toBe(true);
          }
          expect(isAcceptedAnswer(`  ${answerEntity.names.en.toUpperCase()}  `, question.answer)).toBe(true);
          expect(isAcceptedAnswer('', question.answer)).toBe(false);
          expect(isAcceptedAnswer('not a US state or capital', question.answer)).toBe(false);
        }
        if (question.presentation === 'choice') {
          expect(question.candidateEntityIds).toContain(answerEntity.id);
          expect(new Set(question.candidateEntityIds).size).toBe(4);
          for (const id of question.candidateEntityIds) {
            expect(pack.entities.find(candidate => candidate.id === id)?.kind).toBe(answerEntity.kind);
          }
        }
        if (question.kind === 'locate_place' && entity.kind === 'place') {
          expect(question.coordinate).toEqual(entity.coordinate);
        }
      }
    }
  }
  expect(presentations).toEqual({ map: 200, choice: 150, text: 150 });
});

it('us-states CLI verifies without adding installable scratch files and cleans its external scratch', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'us-pack-cli-test-'));
  try {
    const before = (await readdir(usProvenance)).sort();
    const run = await executeFile(process.execPath, [join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'), join(usProvenance, 'verify.ts')], {
      cwd: repositoryRoot, env: { ...process.env, TMP: temp, TEMP: temp, TMPDIR: temp },
    });
    expect(JSON.parse(run.stdout).generatedTwiceIdentical).toBe(true);
    expect((await readdir(usProvenance)).sort()).toEqual(before);
    // tsx may maintain a runtime cache; converter scratch must be gone.
    expect((await readdir(temp)).filter(name => name.startsWith('us-states-verification-'))).toEqual([]);
  } finally {
    if (dirname(temp) !== resolve(tmpdir()) || !basename(temp).startsWith('us-pack-cli-test-')) throw new Error('Unsafe test cleanup');
    await rm(temp, { recursive: true, force: true });
  }
}, 30000);

it('us-states source verification rejects changed originals, changed point audit, and unsafe source paths', async () => {
  const { verifyRetainedSources } = await import('../../src-tauri/resources/content/us-states/_provenance/source-checks');
  const verified = await verifyRetainedSources(usProvenance);
  expect(verified.rawFiles).toBe(5);
  expect(verified.processedFiles).toBe(3);
  const temp = await mkdtemp(join(tmpdir(), 'us-pack-source-test-'));
  try {
    const directory = join(temp, 'inputs');
    await mkdir(directory);
    const ledger = JSON.parse(await readFile(join(usProvenance, 'external-inputs.json'), 'utf8')) as { file: string }[];
    for (const file of ['external-inputs.json', 'source.input.json', 'regions.geojson', 'entities.input.json', 'points-audit.json', ...ledger.map(row => row.file)]) {
      await copyFile(join(usProvenance, file), join(directory, file));
    }
    await writeFile(join(directory, ledger[0]!.file), 'corrupted original');
    await expect(verifyRetainedSources(directory)).rejects.toThrow(/Source hash mismatch/);
    await copyFile(join(usProvenance, ledger[0]!.file), join(directory, ledger[0]!.file));
    await writeFile(join(directory, 'points-audit.json'), '[]');
    await expect(verifyRetainedSources(directory)).rejects.toThrow(/Processing hash mismatch/);
    await copyFile(join(usProvenance, 'points-audit.json'), join(directory, 'points-audit.json'));
    ledger[0]!.file = '../outside.zip';
    await writeFile(join(directory, 'external-inputs.json'), JSON.stringify(ledger));
    await expect(verifyRetainedSources(directory)).rejects.toThrow(/Unsafe source filename/);
  } finally {
    if (dirname(temp) !== resolve(tmpdir()) || !basename(temp).startsWith('us-pack-source-test-')) throw new Error('Unsafe test cleanup');
    await rm(temp, { recursive: true, force: true });
  }
});

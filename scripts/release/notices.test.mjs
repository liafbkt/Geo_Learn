// @vitest-environment node
import { describe, expect, it } from 'vitest';

const pnpmLicenses = {
  'MIT OR Apache-2.0': [
    { name: 'zeta', versions: ['2.0.0', '2.0.0'], license: 'MIT OR Apache-2.0', paths: ['C:\\Users\\Kevin\\private\\zeta'] },
    { name: '@scope/alpha', versions: ['1.0.0'], license: 'MIT OR Apache-2.0', paths: ['/home/runner/private/alpha'] },
  ],
  ISC: [
    { name: 'middle', versions: ['3.0.0'], license: 'ISC', paths: ['/Users/kevin/private/middle'] },
  ],
};

const cargoMetadata = {
  packages: [
    {
      id: 'root',
      name: 'spatial-memory-coach',
      version: '0.1.0',
      license: null,
      dependencies: [
        { name: 'serde', kind: null },
        { name: 'dev-only', kind: 'dev' },
      ],
      manifest_path: 'C:\\Users\\Kevin\\private\\Cargo.toml',
    },
    { id: 'serde-1', name: 'serde', version: '1.0.0', license: 'MIT OR Apache-2.0', dependencies: [] },
    { id: 'serde-1-copy', name: 'serde', version: '1.0.0', license: 'MIT OR Apache-2.0', dependencies: [] },
    { id: 'alpha-1', name: 'alpha-crate', version: '0.2.0', license: 'Apache-2.0 WITH LLVM-exception', dependencies: [] },
  ],
  resolve: { root: 'root' },
};

async function generator() {
  const module = await import('./notices-lib.mjs').catch(() => ({}));
  expect(module.generateNotices).toBeTypeOf('function');
  return module.generateNotices;
}

describe('third-party notices generation', () => {
  it('accepts pnpm\'s separator before --check and rejects other arguments', async () => {
    const module = await import('./notices-lib.mjs');
    expect(module.parseNoticesArgs(['--', '--check'])).toEqual({ check: true });
    expect(module.parseNoticesArgs([])).toEqual({ check: false });
    expect(() => module.parseNoticesArgs(['--', '--check', 'extra'])).toThrow('optional --check');
  });

  it('sorts deterministically, preserves license expressions, collapses duplicates, and redacts paths', async () => {
    const generateNotices = await generator();

    const output = generateNotices(pnpmLicenses, cargoMetadata, ['zeta', '@scope/alpha', 'middle']);

    expect(output.indexOf('@scope/alpha')).toBeLessThan(output.indexOf('middle'));
    expect(output.indexOf('middle')).toBeLessThan(output.indexOf('zeta'));
    expect(output).toContain('MIT OR Apache-2.0');
    expect(output).toContain('Apache-2.0 WITH LLVM-exception');
    expect(output.match(/serde \| 1\.0\.0/g)).toHaveLength(1);
    expect(output.match(/zeta \| 2\.0\.0/g)).toHaveLength(1);
    expect(output).not.toMatch(/C:\\Users|\/Users\/|\/home\//);
  });

  it('requires every direct Node production dependency', async () => {
    const generateNotices = await generator();
    expect(() => generateNotices(pnpmLicenses, cargoMetadata, ['zeta', 'missing-direct'])).toThrow('direct Node');
  });

  it('requires every direct Rust production dependency', async () => {
    const generateNotices = await generator();
    const missing = structuredClone(cargoMetadata);
    missing.packages = missing.packages.filter((pkg) => pkg.name !== 'serde');
    expect(() => generateNotices(pnpmLicenses, missing, ['zeta'])).toThrow('direct Rust');
  });

  it.each(['node', 'rust'])('rejects a %s dependency without a license expression', async (kind) => {
    const generateNotices = await generator();
    const node = structuredClone(pnpmLicenses);
    const cargo = structuredClone(cargoMetadata);
    if (kind === 'node') node.ISC[0].license = '';
    if (kind === 'rust') cargo.packages[1].license = null;
    expect(() => generateNotices(node, cargo, ['zeta'])).toThrow('license');
  });

  it('includes fixed SQLite, original audio, and all three content-pack notices without claiming legal approval', async () => {
    const generateNotices = await generator();
    const output = generateNotices(pnpmLicenses, cargoMetadata, ['zeta']);
    expect(output).toContain('## Bundled SQLite');
    expect(output).toContain('## Original audio');
    expect(output).toContain('cn-provincial-divisions');
    expect(output).toContain('cn-shanghai-districts');
    expect(output).toContain('us-states');
    expect(output).toContain('development-only');
    expect(output).not.toContain('statutory approval complete');
  });
});

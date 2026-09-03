// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('pnpm test argument normalization', () => {
  it('preserves coverage while removing pnpm separator and duplicate run mode', async () => {
    const module = await import('./run-tests.mjs').catch(() => ({}));
    expect(module.normalizeTestArgs).toBeTypeOf('function');
    expect(module.normalizeTestArgs(['--', '--run', '--coverage'])).toEqual(['run', '--coverage']);
    expect(module.normalizeTestArgs([])).toEqual(['run']);
    expect(module.normalizeTestArgs(['src/app/App.test.tsx'])).toEqual(['run', 'src/app/App.test.tsx']);
  });
});

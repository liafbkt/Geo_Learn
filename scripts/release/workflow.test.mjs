// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

async function workflow() {
  const source = await readFile('.github/workflows/release.yml', 'utf8').catch(() => '');
  const document = parse(source);
  expect(document).toBeTypeOf('object');
  expect(document).not.toBeNull();
  return document;
}

describe('release workflow security boundary', () => {
  it('allows only tag pushes and explicit dispatch, with no PR-secret trigger', async () => {
    const doc = await workflow();
    expect(Object.keys(doc.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(doc.on.push).toEqual({ tags: ['v*'] });
    expect(doc.on.workflow_dispatch).toBeNull();
    expect(doc.permissions).toEqual({ contents: 'read' });
  });
  it('requires Windows quality gates before the job with write access', async () => {
    const { jobs } = await workflow();
    expect(jobs.tests['runs-on']).toBe('windows-latest');
    expect(jobs.tests.permissions).toEqual({ contents: 'read' });
    expect(jobs.release.needs).toEqual(['tests']);
    expect(jobs.release['runs-on']).toBe('windows-latest');
    expect(jobs.release.permissions).toEqual({ contents: 'write' });
    const checks = jobs.tests.steps.filter((step) => step.run).map((step) => step.run);
    expect(checks).toEqual(expect.arrayContaining(['pnpm lint', 'pnpm typecheck', 'pnpm exec vitest run --coverage', 'pnpm build', 'pnpm exec playwright test', 'cargo +1.98.0 fmt --manifest-path src-tauri/Cargo.toml --all -- --check', 'cargo +1.98.0 clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings', 'cargo +1.98.0 test --locked --manifest-path src-tauri/Cargo.toml --all-targets']));
  });
  it('scopes signing secrets to preflight/build and uses only the automatic GitHub token for publishing', async () => {
    const doc = await workflow();
    expect(doc.env?.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined();
    for (const job of Object.values(doc.jobs)) {
      expect(job.env?.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined();
      for (const step of job.steps) {
        if (step.env?.TAURI_SIGNING_PRIVATE_KEY) {
          expect(['node scripts/release/preflight.mjs --secrets', 'pnpm tauri build --target x86_64-pc-windows-msvc --bundles nsis --ci -- --locked']).toContain(step.run);
          expect(step.env.TAURI_SIGNING_PRIVATE_KEY).toBe('${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}');
          expect(step.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}');
        }
        if (step.run?.includes('publish-draft.mjs')) expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
        // Event values enter subprocesses via environment, never shell source.
        expect(step.run ?? '').not.toContain('${{');
      }
    }
  });
  it('verifies the signed installer before creating the updater manifest and uploading', async () => {
    const doc = await workflow();
    const steps = doc.jobs.release.steps;
    const index = (part) => steps.findIndex((step) => step.run?.includes(part));
    expect(index('verify_update_artifact')).toBeGreaterThan(index('pnpm tauri build'));
    expect(index('prepare-artifacts.mjs')).toBeGreaterThan(index('verify_update_artifact'));
    expect(index('publish-draft.mjs')).toBeGreaterThan(index('prepare-artifacts.mjs'));
    const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4');
    expect(upload.with['if-no-files-found']).toBe('error');
    expect(upload.with.path).toBe('release-artifacts/*');
  });
  it('does not persist checkout credentials or run unreviewed bootstrap actions', async () => {
    const doc = await workflow();
    for (const job of Object.values(doc.jobs)) {
      for (const step of job.steps.filter((value) => value.uses)) {
        expect(['actions/checkout@v4', 'actions/setup-node@v4', 'actions/upload-artifact@v4']).toContain(step.uses);
        if (step.uses === 'actions/checkout@v4') expect(step.with['persist-credentials']).toBe(false);
        if (step.uses === 'actions/setup-node@v4') expect(step.with['node-version']).toBe('24.18.0');
      }
    }
  });
});

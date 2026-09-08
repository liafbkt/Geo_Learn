// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { qualityGateCommands } from './evidence-lib.mjs';

async function workflow(name = 'release') {
  const source = await readFile(`.github/workflows/${name}.yml`, 'utf8').catch(() => '');
  const document = parse(source);
  expect(document).toBeTypeOf('object');
  expect(document).not.toBeNull();
  return document;
}

const gateSteps = (job) => job.steps.filter((step) => /^QG-\d{2}$/.test(step.name ?? ''));
const upload = (job, name) => job.steps.find((step) => step.uses === 'actions/upload-artifact@v4' && step.with?.name === name);

describe('release workflow security boundary', () => {
  it('allows only tag pushes and explicit dispatch, with read-only default permissions', async () => {
    const doc = await workflow();
    expect(Object.keys(doc.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(doc.on.push).toEqual({ tags: ['v*'] });
    expect(doc.on.workflow_dispatch).toBeNull();
    expect(doc.permissions).toEqual({ contents: 'read' });
  });

  it('runs the nine release gates verbatim and in order on Windows', async () => {
    const { tests } = (await workflow()).jobs;
    expect(tests['runs-on']).toBe('windows-latest');
    expect(tests.permissions).toEqual({ contents: 'read' });
    expect(tests.if).toBe("github.event_name == 'push'");
    expect(tests.env.RUSTUP_TOOLCHAIN).toBe('1.98.0-x86_64-pc-windows-msvc');
    const steps = gateSteps(tests);
    expect(steps.map((step) => step.name)).toEqual(qualityGateCommands.map((_command, index) => `QG-${String(index + 1).padStart(2, '0')}`));
    expect(steps.map((step) => step.run)).toEqual(qualityGateCommands);
    expect(steps.every((step) => step['continue-on-error'] == null)).toBe(true);
    expect(tests.steps.findIndex((step) => step.run === 'node scripts/release/write-gate-evidence.mjs')).toBeGreaterThan(tests.steps.indexOf(steps.at(-1)));
  });

  it('uploads coverage, Playwright diagnostics, and passed gate evidence without tolerating missing files', async () => {
    const { tests } = (await workflow()).jobs;
    const coverage = upload(tests, 'windows-v1-coverage');
    const playwright = upload(tests, 'windows-v1-playwright');
    const evidence = upload(tests, 'windows-v1-evidence');
    expect(coverage.with.path).toBe('coverage/');
    expect(playwright.with.path).toContain('playwright-report/');
    expect(playwright.with.path).toContain('test-results/');
    expect(evidence.with.path).toBe('release-evidence/quality-gates.json');
    for (const step of [coverage, playwright, evidence]) expect(step.with['if-no-files-found']).toBe('error');
  });

  it('builds a draft only after tests and promotes an existing draft only on dispatch', async () => {
    const { jobs } = await workflow();
    expect(jobs.release.needs).toEqual(['tests']);
    expect(jobs.release.if).toBe("github.event_name == 'push'");
    expect(jobs.release.permissions).toEqual({ contents: 'write' });
    expect(jobs.promote.if).toBe("github.event_name == 'workflow_dispatch'");
    expect(jobs.promote.permissions).toEqual({ contents: 'write' });
    expect(jobs.promote.env.RUSTUP_TOOLCHAIN).toBe('1.98.0-x86_64-pc-windows-msvc');
    const promoteRuns = jobs.promote.steps.filter((step) => step.run).map((step) => step.run);
    expect(promoteRuns).toContain('node scripts/release/promote-release.mjs');
    expect(promoteRuns.findIndex((run) => run.startsWith('rustup toolchain install'))).toBeLessThan(promoteRuns.indexOf('node scripts/release/promote-release.mjs'));
    expect(jobs.promote.steps.some((step) => step.run?.includes('tauri build') || step.run?.includes('publish-draft'))).toBe(false);
  });

  it('scopes signing secrets and automatic GitHub tokens to the four authorized steps', async () => {
    const doc = await workflow();
    expect(doc.env?.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined();
    const secretRuns = [];
    const tokenRuns = [];
    for (const job of Object.values(doc.jobs)) {
      expect(job.env?.TAURI_SIGNING_PRIVATE_KEY).toBeUndefined();
      for (const step of job.steps) {
        if (step.env?.TAURI_SIGNING_PRIVATE_KEY) {
          secretRuns.push(step.run);
          expect(step.env.TAURI_SIGNING_PRIVATE_KEY).toBe('${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}');
          expect(step.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD).toBe('${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}');
        }
        if (step.env?.GH_TOKEN) {
          tokenRuns.push(step.run);
          expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
        }
        expect(step.run ?? '').not.toContain('${{');
      }
    }
    expect(secretRuns).toEqual(['node scripts/release/preflight.mjs --secrets', 'pnpm exec tauri build --target x86_64-pc-windows-msvc --bundles nsis --ci -- --locked']);
    expect(tokenRuns.sort()).toEqual(['node scripts/release/promote-release.mjs', 'node scripts/release/publish-draft.mjs'].sort());
  });

  it('verifies notices, signature, checksum, and four assets before draft creation', async () => {
    const steps = (await workflow()).jobs.release.steps;
    const index = (part) => steps.findIndex((step) => step.run?.includes(part));
    expect(index('release:notices')).toBeGreaterThan(index('pnpm install'));
    expect(index('verify_update_artifact')).toBeGreaterThan(index('pnpm tauri build'));
    expect(index('prepare-artifacts.mjs')).toBeGreaterThan(index('verify_update_artifact'));
    expect(index('verify-artifacts.mjs')).toBeGreaterThan(index('prepare-artifacts.mjs'));
    expect(index('publish-draft.mjs')).toBeGreaterThan(index('verify-artifacts.mjs'));
    const artifact = upload({ steps }, 'windows-x64-release');
    expect(artifact.with.path).toBe('release-artifacts/*');
    expect(artifact.with['if-no-files-found']).toBe('error');
  });

  it('uploads a short-lived Windows notice diagnostic only when freshness fails', async () => {
    const { release } = (await workflow()).jobs;
    const generate = release.steps.find((step) => step.name === 'Generate Windows third-party notices after freshness failure');
    const diagnostic = upload(release, 'windows-third-party-notices-diagnostic');
    expect(generate).toMatchObject({ if: 'failure()', run: 'pnpm release:notices' });
    expect(diagnostic.if).toBe('failure()');
    expect(diagnostic.with).toMatchObject({ path: 'THIRD_PARTY_NOTICES.md', 'if-no-files-found': 'error', 'retention-days': 7 });
  });

  it('uses only reviewed actions and never persists checkout credentials', async () => {
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

describe('ordinary quality workflow', () => {
  it('keeps Windows and macOS checks while the shared sequence includes all nine gates', async () => {
    const doc = await workflow('quality');
    expect(doc.permissions).toEqual({ contents: 'read' });
    expect(doc.jobs.quality.strategy.matrix.os).toEqual(['windows-latest', 'macos-latest']);
    expect(gateSteps(doc.jobs.quality).map((step) => step.run)).toEqual(qualityGateCommands);
    expect(doc.jobs.quality.steps.every((step) => step['continue-on-error'] == null)).toBe(true);
  });

  it('configures CI Playwright output for the uploaded report and traces', async () => {
    const source = await readFile('playwright.config.ts', 'utf8');
    expect(source).toContain("process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : 'list'");
    expect(source).toContain("outputDir: 'test-results'");
    expect(source).toContain("trace: 'retain-on-failure'");
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [];
const script = resolve('scripts/check-offline.ps1');
const updater = 'https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json';

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture({ html = '<main>local</main>', css = '', source = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'geolearn-offline-'));
  roots.push(root);
  mkdirSync(join(root, 'dist', 'assets'), { recursive: true });
  mkdirSync(join(root, 'src', 'app'), { recursive: true });
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  writeFileSync(join(root, 'dist', 'index.html'), html);
  writeFileSync(join(root, 'dist', 'assets', 'app.css'), css);
  writeFileSync(join(root, 'src', 'app', 'runtime.ts'), source);
  writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({
    plugins: { updater: { endpoints: [updater] } },
  }));
  return root;
}

function scan(root) {
  return spawnSync('pwsh', ['-NoProfile', '-File', script, '-Root', root], {
    encoding: 'utf8',
    shell: false,
  });
}

describe('offline runtime scan', () => {
  it.each([
    ['remote font', { css: '@font-face{src:url(https://fonts.example/font.woff2)}' }],
    ['remote map', { html: '<img src="https://maps.example/map.svg">' }],
    ['arbitrary API', { source: 'fetch("https://api.example/progress")' }],
  ])('rejects %s', (_name, input) => {
    const result = scan(fixture(input));
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toMatch(/offline scan rejected/i);
  });

  it('allows local runtime assets plus the exact updater endpoint', () => {
    const result = scan(fixture({
      source: 'const citation = "https://sources.example/reference"; fetch("/audio/local.wav")',
    }));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/offline scan passed/i);
  });
});

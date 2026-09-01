// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const config = JSON.parse(read('src-tauri/tauri.conf.json'));

describe('Windows release configuration contract', () => {
  it('ships NSIS with bootstrapper dependency installation and native v2 updater artifacts', () => {
    expect(config.bundle.targets).toEqual(['nsis']);
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.bundle.windows.webviewInstallMode).toEqual({ type: 'downloadBootstrapper', silent: true });
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  it('fixes the HTTPS endpoint to this repository and installs updates passively', () => {
    expect(config.plugins.updater.endpoints).toEqual([
      'https://github.com/liafbkt/Geo_Learn/releases/latest/download/latest.json',
    ]);
    expect(config.plugins.updater.windows).toEqual({ installMode: 'passive' });
    expect(config.plugins.updater.dangerousInsecureTransportProtocol).not.toBe(true);
    // Empty means explicitly unprovisioned; the release preflight must reject it.
    expect(typeof config.plugins.updater.pubkey).toBe('string');
  });

  it('grants only the three used updater commands to the local Windows main window', () => {
    const capabilities = readdirSync(resolve(root, 'src-tauri/capabilities'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(read(`src-tauri/capabilities/${name}`)));
    const updater = capabilities.find((entry) => entry.identifier === 'windows-updater');
    expect(updater).toMatchObject({
      windows: ['main'], platforms: ['windows'], local: true,
      permissions: ['app-update:allow-check', 'updater:allow-download', 'updater:allow-install'],
    });
    expect(updater.remote).toBeUndefined();
    expect(capabilities.flatMap((entry) => entry.permissions).sort()).toEqual([
      'core:default', 'app-update:allow-check', 'updater:allow-download', 'updater:allow-install',
    ].sort());
  });

  it('bundles only runtime content files, embedded frontend and statically bundled SQLite', () => {
    expect(config.bundle.resources).toEqual([
      'resources/content/*/manifest.json',
      'resources/content/*/entities.json',
      'resources/content/*/map.topojson',
      'resources/content/*/sources.json',
    ]);
    expect(config.build.frontendDist).toBe('../dist');
    expect(read('src-tauri/Cargo.toml')).toMatch(/rusqlite\s*=\s*\{[^\n]*features\s*=\s*\["bundled"\]/);
    expect(read('src-tauri/src/db.rs')).toContain('include_str!("../migrations/0001_initial.sql")');
  });
});

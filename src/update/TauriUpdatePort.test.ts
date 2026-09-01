import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import type { Channel } from '@tauri-apps/api/core';
import { createTauriUpdatePort } from './TauriUpdatePort';
import { UpdateService, type DownloadEvent } from './UpdateService';

const { config } = vi.hoisted(() => ({ config: { plugins: { updater: { pubkey: 'test-public-key' } } } }));
vi.mock('../../src-tauri/tauri.conf.json', () => ({ default: config }));

beforeEach(() => {
  vi.stubGlobal('isTauri', true);
  config.plugins.updater.pubkey = 'test-public-key';
});
afterEach(() => { clearMocks(); vi.unstubAllGlobals(); });

/** Native resource table, below the real updater library. No network/installer runs. */
function nativeFixture(options: { installFails?: boolean; bytesAlreadyConsumed?: boolean; signatureFails?: boolean } = {}) {
  const resources = new Set<number>();
  const requests: Array<{ command: string; payload: unknown }> = [];
  mockIPC(async (command, payload) => {
    requests.push({ command, payload });
    if (command === 'plugin:app-update|check') {
      resources.add(7);
      return { rid: 7, currentVersion: '1.0.0', version: '1.1.0', body: '修复地图', date: '2026-08-30T00:00:00Z', rawJson: {} };
    }
    if (command === 'plugin:updater|download') {
      const event = (payload as { onEvent: Channel<DownloadEvent> }).onEvent;
      event.onmessage({ event: 'Started', data: {} });
      event.onmessage({ event: 'Progress', data: { chunkLength: 23 } });
      event.onmessage({ event: 'Finished' });
      if (options.signatureFails) throw new Error('signature mismatch');
      resources.add(9);
      return 9;
    }
    if (command === 'plugin:updater|install') {
      if (options.bytesAlreadyConsumed || !options.installFails) resources.delete(9);
      if (options.installFails) throw new Error('installer failed');
      return;
    }
    if (command === 'plugin:resources|close') {
      const rid = (payload as { rid: number }).rid;
      if (!resources.delete(rid)) throw new Error('resource does not exist');
      return;
    }
    throw new Error(`Unexpected native command: ${command}`);
  });
  return { resources, requests };
}

describe('Tauri updater adapter with real JS plugin and mocked native IPC', () => {
  it('does not invoke native APIs in browser, and allows a later retry', async () => {
    const native = nativeFixture();
    vi.stubGlobal('isTauri', false);
    const service = new UpdateService(createTauriUpdatePort());
    expect(native.requests).toEqual([]);
    await service.check();
    expect(service.getState()).toMatchObject({ status: 'error', code: 'UNSUPPORTED' });
    expect(native.requests).toEqual([]);
    vi.stubGlobal('isTauri', true);
    await service.retry();
    expect(service.getState().status).toBe('available');
    await service.dispose();
  });

  it('fails closed without a public key before contacting native updater', async () => {
    const native = nativeFixture();
    config.plugins.updater.pubkey = '  ';
    const service = new UpdateService(createTauriUpdatePort());
    await service.check();
    expect(service.getState()).toMatchObject({ status: 'error', phase: 'check', code: 'NOT_CONFIGURED' });
    expect(native.requests).toEqual([]);
  });

  // Catches reverting to the unrestricted updater check command or forwarding options.
  it('checks through the no-argument native command and fixes download timeout', async () => {
    const native = nativeFixture();
    const handle = await createTauriUpdatePort().check();
    expect(handle?.metadata).toEqual({ currentVersion: '1.0.0', version: '1.1.0', notes: '修复地图', date: '2026-08-30T00:00:00Z' });
    expect(native.requests[0]).toEqual({ command: 'plugin:app-update|check', payload: {} });
    const events: DownloadEvent[] = [];
    await handle!.download(event => events.push(event));
    expect(events).toEqual([
      { event: 'Started', data: {} },
      { event: 'Progress', data: { chunkLength: 23 } },
      { event: 'Finished' },
    ]);
    expect(native.requests[1]).toEqual({ command: 'plugin:updater|download', payload: { rid: 7, timeout: 30_000, onEvent: expect.any(Object) } });
    await handle!.install();
    expect(native.requests[2]).toEqual({ command: 'plugin:updater|install', payload: { updateRid: 7, bytesRid: 9 } });
    await handle!.close();
    expect([...native.resources]).toEqual([]);
  });

  it('returns null when native updater has no new version', async () => {
    mockIPC(command => { if (command === 'plugin:app-update|check') return null; throw new Error(command); });
    expect(await createTauriUpdatePort().check()).toBeNull();
  });

  it('does not expose ready when signature verification rejects after Finished', async () => {
    const native = nativeFixture({ signatureFails: true });
    const service = new UpdateService(createTauriUpdatePort());
    const statuses: string[] = [];
    service.subscribe(state => statuses.push(state.status));
    await service.check();
    await service.download();
    expect(service.getState()).toMatchObject({ status: 'error', code: 'DOWNLOAD_FAILED' });
    expect(statuses).not.toContain('ready');
    expect([...native.resources]).toEqual([]);
  });

  it.each([false, true])('releases update after failed install even if native bytes consumed=%s', async bytesAlreadyConsumed => {
    const native = nativeFixture({ installFails: true, bytesAlreadyConsumed });
    const service = new UpdateService(createTauriUpdatePort());
    await service.check();
    await service.download();
    await service.install();
    expect(service.getState()).toMatchObject({ status: 'error', code: 'INSTALL_FAILED' });
    expect([...native.resources]).toEqual([]);
  });
});

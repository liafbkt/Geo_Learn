import { describe, expect, it } from 'vitest';
import { UpdateService, type UpdateHandle, type DownloadEvent } from './UpdateService';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const download = deferred<void>();
  const installation = deferred<void>();
  let onEvent: (event: DownloadEvent) => void = () => {};
  const calls = { check: 0, download: 0, install: 0, close: 0 };
  const handle: UpdateHandle = {
    metadata: { version: '1.1.0', currentVersion: '1.0.0', notes: '更新说明', date: null },
    download: (listener) => { calls.download++; onEvent = listener; return download.promise; },
    install: () => { calls.install++; return installation.promise; },
    close: async () => { calls.close++; },
  };
  const service = new UpdateService({ check: async () => { calls.check++; return handle; } });
  return { service, handle, calls, download, installation, emit: (e: DownloadEvent) => onEvent(e) };
}

describe('UpdateService', () => {
  // Catches automatic native work on construction and treating null as an available update.
  it('only checks explicitly and reports no update', async () => {
    let calls = 0;
    const service = new UpdateService({ check: async () => { calls++; return null; } });
    expect(calls).toBe(0);
    expect(service.getState()).toEqual({ status: 'idle' });
    await service.check();
    expect(calls).toBe(1);
    expect(service.getState()).toEqual({ status: 'upToDate' });
  });

  // Catches Finished unlocking install before signature validation resolves.
  it('sums byte chunks but waits for the verified download promise before installation', async () => {
    const f = fixture();
    await f.service.check();
    const downloading = f.service.download();
    f.emit({ event: 'Started', data: { contentLength: 100 } });
    f.emit({ event: 'Progress', data: { chunkLength: 20 } });
    f.emit({ event: 'Progress', data: { chunkLength: 30 } });
    expect(f.service.getState()).toMatchObject({ status: 'downloading', downloadedBytes: 50, totalBytes: 100, percent: 50 });
    f.emit({ event: 'Finished' });
    await f.service.install();
    expect(f.calls.install).toBe(0);
    expect(f.service.getState().status).toBe('downloading');
    f.download.resolve();
    await downloading;
    expect(f.service.getState().status).toBe('ready');
    const installing = f.service.install();
    expect(f.service.getState().status).toBe('installing');
    f.installation.resolve();
    await installing;
    expect(f.service.getState().status).toBe('installationRequested');
    expect(f.calls.close).toBe(1);
  });

  it.each([undefined, 0, -1, NaN, Infinity])('keeps unknown or invalid content length %s indeterminate', async (contentLength) => {
    const f = fixture();
    await f.service.check();
    const work = f.service.download();
    f.emit({ event: 'Started', data: contentLength === undefined ? {} : { contentLength } });
    f.emit({ event: 'Progress', data: { chunkLength: 12 } });
    expect(f.service.getState()).toMatchObject({ downloadedBytes: 12, totalBytes: null, percent: null });
    f.download.resolve();
    await work;
    await f.service.dispose();
  });

  // Catches locking after publication, synchronous subscriber recursion, and native duplicate calls.
  it('ignores invalid and concurrent operations even inside observers', async () => {
    const f = fixture();
    f.service.subscribe((state) => {
      if (state.status === 'checking') void f.service.check();
      if (state.status === 'available') void f.service.download();
      if (state.status === 'downloading') void f.service.download();
    });
    await f.service.install();
    await f.service.download();
    await f.service.check();
    expect(f.calls).toEqual({ check: 1, download: 0, install: 0, close: 0 });
    const work = f.service.download();
    await f.service.check();
    await f.service.download();
    expect(f.calls.download).toBe(1);
    f.download.resolve();
    await work;
    await f.service.dispose();
  });

  it('isolates throwing observers and supports unsubscribe', async () => {
    const f = fixture();
    f.service.subscribe(() => { throw new Error('UI failed'); });
    const statuses: string[] = [];
    const stop = f.service.subscribe(state => statuses.push(state.status));
    await f.service.check();
    stop();
    await f.service.dispose();
    expect(statuses).toEqual(['checking', 'available']);
    expect(f.calls.close).toBe(1);
  });

  it('closes a handle arriving after disposal without publishing its metadata', async () => {
    const f = fixture();
    const check = deferred<UpdateHandle | null>();
    const service = new UpdateService({ check: () => check.promise });
    const work = service.check();
    await service.dispose();
    check.resolve(f.handle);
    await work;
    expect(service.getState()).toEqual({ status: 'disposed' });
    expect(f.calls.close).toBe(1);
  });

  it('waits for an in-flight download before closing its late byte resource', async () => {
    const f = fixture();
    await f.service.check();
    const work = f.service.download();
    await f.service.dispose();
    expect(f.calls.close).toBe(0);
    f.emit({ event: 'Progress', data: { chunkLength: 15 } });
    f.download.resolve();
    await work;
    expect(f.calls.close).toBe(1);
    expect(f.service.getState()).toEqual({ status: 'disposed' });
  });

  it('does not start native download if an observer disposes during transition', async () => {
    const f = fixture();
    await f.service.check();
    f.service.subscribe(state => { if (state.status === 'downloading') void f.service.dispose(); });
    await f.service.download();
    expect(f.calls.download).toBe(0);
    expect(f.calls.close).toBe(1);
  });

  it('rechecks after check failure and does not expose native error details', async () => {
    let checks = 0;
    const service = new UpdateService({ check: async () => {
      if (++checks === 1) throw new Error('sensitive native details');
      return null;
    } });
    await service.check();
    expect(service.getState()).toMatchObject({ status: 'error', phase: 'check', code: 'CHECK_FAILED' });
    expect(JSON.stringify(service.getState())).not.toContain('sensitive');
    await service.retry();
    expect(service.getState().status).toBe('upToDate');
    expect(checks).toBe(2);
  });

  it('ignores a completed download channel when a later update is downloading', async () => {
    const first = fixture();
    const second = fixture();
    let checks = 0;
    const service = new UpdateService({ check: async () => ++checks === 1 ? first.handle : second.handle });
    await service.check();
    const initialDownload = service.download();
    first.download.resolve();
    await initialDownload;
    await service.check();
    const nextDownload = service.download();
    second.emit({ event: 'Progress', data: { chunkLength: 12 } });
    first.emit({ event: 'Progress', data: { chunkLength: 80 } });
    expect(service.getState()).toMatchObject({ status: 'downloading', downloadedBytes: 12 });
    second.download.resolve();
    await nextDownload;
    await service.dispose();
  });

  it.each(['download', 'install'] as const)('discards resources and rechecks after %s failure', async (phase) => {
    const first = fixture();
    const second = fixture();
    let checks = 0;
    const service = new UpdateService({ check: async () => ++checks === 1 ? first.handle : second.handle });
    await service.check();
    const work = service.download();
    if (phase === 'download') {
      first.emit({ event: 'Finished' });
      first.download.reject(new Error('invalid signature'));
      await work;
    } else {
      first.download.resolve();
      await work;
      const installing = service.install();
      first.installation.reject(new Error('installer failed'));
      await installing;
    }
    expect(service.getState()).toMatchObject({ status: 'error', phase });
    expect(first.calls.close).toBe(1);
    await service.retry();
    expect(checks).toBe(2);
    expect(service.getState().status).toBe('available');
    await service.install();
    expect(second.calls.install).toBe(0);
    const retryDownload = service.download();
    second.download.resolve();
    await retryDownload;
    expect(service.getState().status).toBe('ready');
    await service.dispose();
  });
});

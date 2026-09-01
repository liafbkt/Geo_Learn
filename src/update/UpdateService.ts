export type UpdateMetadata = Readonly<{
  currentVersion: string;
  version: string;
  notes: string | null;
  date: string | null;
}>;

export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export interface UpdateHandle {
  readonly metadata: UpdateMetadata;
  download(onEvent: (event: DownloadEvent) => void): Promise<void>;
  install(): Promise<void>;
  close(): Promise<void>;
}

export interface UpdatePort {
  check(): Promise<UpdateHandle | null>;
}

export const UPDATE_ERROR_MESSAGES = Object.freeze({
  UNSUPPORTED: '请在桌面应用中检查更新。',
  NOT_CONFIGURED: '更新尚未配置完成，请稍后重试。',
  CHECK_FAILED: '检查更新失败，请检查网络后重试。',
  DOWNLOAD_FAILED: '下载或校验更新失败，请重新检查更新后下载。',
  INSTALL_FAILED: '未能启动更新安装，请重新检查更新并下载。',
});

export type UpdateErrorCode = keyof typeof UPDATE_ERROR_MESSAGES;
export type UpdatePhase = 'check' | 'download' | 'install';

export class UpdatePortError extends Error {
  constructor(readonly code: 'UNSUPPORTED' | 'NOT_CONFIGURED') {
    super(UPDATE_ERROR_MESSAGES[code]);
  }
}

export type UpdateState =
  | Readonly<{ status: 'idle' | 'checking' | 'upToDate' | 'disposed' }>
  | Readonly<{ status: 'available' | 'ready' | 'installing' | 'installationRequested'; update: UpdateMetadata }>
  | Readonly<{
      status: 'downloading'; update: UpdateMetadata;
      downloadedBytes: number; totalBytes: number | null; percent: number | null;
    }>
  | Readonly<{ status: 'error'; phase: UpdatePhase; code: UpdateErrorCode; message: string }>;

type Listener = (state: UpdateState) => void;

/**
 * Task 9 UI integration: create one service with createTauriUpdatePort(), read
 * getState(), then subscribe() for changes (unsubscribe on unmount). Actions
 * are explicit: check → available → download → ready → install. Render notes
 * as plain text. null percent means indeterminate; ready alone permits install.
 * retry() always rechecks; it never installs cached or possibly consumed bytes.
 * Invalid, concurrent and observer-reentrant actions resolve as no-ops.
 * Installation may exit Windows before the promise resolves. Neither installing
 * nor installationRequested means successful installation or automatic relaunch.
 * dispose() publishes immediately; in-flight native work cannot be cancelled,
 * so its owner closes resources after it settles and ignores all late events.
 */
export class UpdateService {
  private state: UpdateState = Object.freeze({ status: 'idle' });
  private readonly listeners = new Set<Listener>();
  private handle: UpdateHandle | null = null;
  private busy = false;
  private disposed = false;

  constructor(private readonly port: UpdatePort) {}

  getState(): UpdateState { return this.state; }

  subscribe(listener: Listener): () => void {
    if (!this.disposed) this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async check(): Promise<void> {
    if (this.busy || this.disposed || this.state.status === 'installationRequested') return;
    this.busy = true;
    this.publish({ status: 'checking' });
    try {
      if (this.handle) await this.release();
      if (this.disposed) return;
      this.handle = await this.port.check();
      if (this.disposed) return;
      this.publish(this.handle
        ? { status: 'available', update: Object.freeze({ ...this.handle.metadata }) }
        : { status: 'upToDate' });
    } catch (error) {
      this.fail('check', error);
    } finally {
      if (this.disposed) await this.release();
      this.busy = false;
    }
  }

  async download(): Promise<void> {
    if (this.busy || this.disposed || this.state.status !== 'available' || !this.handle) return;
    this.busy = true;
    const update = this.state.update;
    let acceptingProgress = true;
    this.publish({ status: 'downloading', update, downloadedBytes: 0, totalBytes: null, percent: null });
    try {
      if (this.disposed) return;
      await this.handle.download(event => { if (acceptingProgress) this.progress(event); });
      acceptingProgress = false;
      if (!this.disposed) this.publish({ status: 'ready', update });
    } catch (error) {
      await this.release();
      this.fail('download', error);
    } finally {
      acceptingProgress = false;
      if (this.disposed) await this.release();
      this.busy = false;
    }
  }

  async install(): Promise<void> {
    if (this.busy || this.disposed || this.state.status !== 'ready' || !this.handle) return;
    this.busy = true;
    const update = this.state.update;
    this.publish({ status: 'installing', update });
    try {
      if (this.disposed) return;
      await this.handle.install();
      await this.release();
      if (!this.disposed) this.publish({ status: 'installationRequested', update });
    } catch (error) {
      await this.release();
      this.fail('install', error);
    } finally {
      if (this.disposed) await this.release();
      this.busy = false;
    }
  }

  async retry(): Promise<void> {
    if (this.state.status === 'error') await this.check();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.publish({ status: 'disposed' });
    this.listeners.clear();
    if (!this.busy) await this.release();
  }

  private progress(event: DownloadEvent): void {
    if (this.disposed || this.state.status !== 'downloading' || event.event === 'Finished') return;
    let { downloadedBytes, totalBytes } = this.state;
    if (event.event === 'Started') {
      const length = event.data.contentLength;
      totalBytes = typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : null;
    } else {
      const chunk = event.data.chunkLength;
      if (!Number.isFinite(chunk) || chunk < 0) return;
      downloadedBytes = Math.min(Number.MAX_SAFE_INTEGER, downloadedBytes + chunk);
    }
    this.publish({
      status: 'downloading', update: this.state.update, downloadedBytes, totalBytes,
      percent: totalBytes === null ? null : Math.min(100, downloadedBytes / totalBytes * 100),
    });
  }

  private fail(phase: UpdatePhase, error: unknown): void {
    if (this.disposed) return;
    const code = error instanceof UpdatePortError ? error.code
      : ({ check: 'CHECK_FAILED', download: 'DOWNLOAD_FAILED', install: 'INSTALL_FAILED' } as const)[phase];
    this.publish({ status: 'error', phase, code, message: UPDATE_ERROR_MESSAGES[code] });
  }

  private publish(state: UpdateState): void {
    this.state = Object.freeze(state);
    for (const listener of [...this.listeners]) {
      if (this.state !== state) break; // A listener may dispose synchronously.
      try { listener(state); } catch { /* UI observers never own native resources. */ }
    }
  }

  private async release(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    try { await handle?.close(); } catch { /* Best effort if the native process has exited. */ }
  }
}

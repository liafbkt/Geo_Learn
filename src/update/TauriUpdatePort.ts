import { invoke, isTauri, Resource } from '@tauri-apps/api/core';
import { Update } from '@tauri-apps/plugin-updater';
import config from '../../src-tauri/tauri.conf.json';
import { UpdatePortError, type UpdatePort } from './UpdateService';

const REQUEST_TIMEOUT_MS = 30_000;

/** The native check command owns config and timeout; IPC accepts no caller options. */
export function createTauriUpdatePort(): UpdatePort {
  return {
    async check() {
      if (!isTauri()) throw new UpdatePortError('UNSUPPORTED');
      if (!config.plugins.updater.pubkey.trim()) throw new UpdatePortError('NOT_CONFIGURED');
      const metadata = await invoke<ConstructorParameters<typeof Update>[0] | null>('plugin:app-update|check').catch((error: unknown) => {
        switch (error) {
          case 'UPDATE_NOT_CONFIGURED': throw new UpdatePortError('NOT_CONFIGURED');
          case 'UPDATE_FEED_UNAVAILABLE': throw new UpdatePortError('FEED_UNAVAILABLE');
          case 'UPDATE_NETWORK_FAILED': throw new UpdatePortError('NETWORK_FAILED');
          case 'UPDATE_METADATA_INVALID': throw new UpdatePortError('METADATA_INVALID');
          default: throw error;
        }
      });
      if (!metadata) return null;
      const update = new Update(metadata);
      return {
        metadata: Object.freeze({
          currentVersion: update.currentVersion,
          version: update.version,
          notes: update.body ?? null,
          date: update.date ?? null,
        }),
        download: onEvent => update.download(onEvent, { timeout: REQUEST_TIMEOUT_MS }),
        install: () => update.install(),
        async close() {
          try {
            // Official Update.close releases the downloaded bytes, then metadata.
            await update.close();
          } catch {
            // If bytes were consumed before an IPC failure, Update.close rejects
            // before releasing metadata. Still attempt to release that resource.
            await Resource.prototype.close.call(update);
          }
        },
      };
    },
  };
}

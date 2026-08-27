import { invoke } from '@tauri-apps/api/core';
import type { ContentFileName, ContentSource } from '../content/ContentSource';

export class TauriContentSource implements ContentSource {
  public readPackIds(): Promise<readonly string[]> {
    return invoke<readonly string[]>('list_content_pack_ids');
  }

  public readJson(packId: string, fileName: ContentFileName): Promise<unknown> {
    return invoke<string>('read_content_resource', { packId, fileName }).then((resource) => {
      try {
        return JSON.parse(resource) as unknown;
      } catch {
        throw new Error(`Invalid JSON content resource: ${packId}/${fileName}.`);
      }
    });
  }
}

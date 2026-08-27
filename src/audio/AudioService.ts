import type { AudioSettings, SoundPackId } from '../app/settings';
import type { SoundEvent } from './types';

export interface AudioService {
  preload(packId: SoundPackId): Promise<void>;
  preview(packId: SoundPackId, volume: number): Promise<void>;
  play(event: SoundEvent, settings: AudioSettings): Promise<void>;
  isAvailable(packId: SoundPackId): boolean;
}

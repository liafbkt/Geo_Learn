export type SoundPackId = 'crisp' | 'soft' | 'minimal';

export type AudioSettings = Readonly<{
  enabled: boolean;
  packId: SoundPackId;
  volume: number;
}>;

export type AppSettings = Readonly<{ audio: AudioSettings }>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  audio: { enabled: true, packId: 'crisp', volume: 0.7 },
};

const soundPackIds: readonly SoundPackId[] = ['crisp', 'soft', 'minimal'];

export function validateAppSettings(value: AppSettings): void {
  if (typeof value.audio.enabled !== 'boolean') {
    throw new Error('Audio enabled must be a boolean');
  }
  if (!soundPackIds.includes(value.audio.packId)) {
    throw new Error('Audio pack is unsupported');
  }
  if (!Number.isFinite(value.audio.volume) || value.audio.volume < 0 || value.audio.volume > 1) {
    throw new Error('Audio volume must be a finite number from 0 to 1');
  }
}

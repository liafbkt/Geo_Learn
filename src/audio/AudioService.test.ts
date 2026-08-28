import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AudioSettings } from '../app/settings';
import {
  AudioAssetUnavailableError,
  WebAudioService,
  type AudioBackend,
} from './WebAudioService';

function backend(): AudioBackend & {
  load: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
  };
}

const enabled: AudioSettings = { enabled: true, packId: 'crisp', volume: 0.7 };

describe('WebAudioService', () => {
  it('keeps common feedback tones under 250ms and completion under 900ms', async () => {
    for (const pack of ['crisp', 'soft', 'minimal']) {
      for (const event of ['correct', 'incorrect', 'hint', 'reveal', 'complete']) {
        const bytes = await readFile(join(process.cwd(), 'src', 'audio', 'assets', pack, `${event}.wav`));
        const sampleRate = bytes.readUInt32LE(24);
        const byteRate = bytes.readUInt32LE(28);
        const durationMs = bytes.readUInt32LE(40) / byteRate * 1_000;
        expect(durationMs, `${pack}/${event} at ${sampleRate}Hz`).toBeLessThanOrEqual(
          event === 'complete' ? 900 : 250,
        );
      }
    }
  });
  it('preloads all five event sounds for a pack', async () => {
    const output = backend();
    const service = new WebAudioService(output);

    await service.preload('soft');

    expect(output.load).toHaveBeenCalledTimes(5);
    expect(output.load.mock.calls.every(([path]) => String(path).includes('/soft/'))).toBe(true);
  });

  it('maps events and clamps volume', async () => {
    const output = backend();
    const service = new WebAudioService(output);

    await service.play('incorrect', { ...enabled, volume: 4 });

    expect(output.play).toHaveBeenCalledWith(expect.stringContaining('/crisp/incorrect.wav'), 1);
  });

  it('does not play when audio is disabled', async () => {
    const output = backend();
    const service = new WebAudioService(output);

    await service.play('hint', { ...enabled, enabled: false });

    expect(output.play).not.toHaveBeenCalled();
  });

  it('previews the selected pack and fails silently after decode errors', async () => {
    const output = backend();
    output.play.mockRejectedValueOnce(new AudioAssetUnavailableError('decode failed'));
    const service = new WebAudioService(output);

    await expect(service.preview('minimal', 0.5)).resolves.toBeUndefined();
    await expect(
      service.play('complete', { ...enabled, packId: 'minimal' }),
    ).resolves.toBeUndefined();
    expect(service.isAvailable('minimal')).toBe(false);
    expect(output.play).toHaveBeenCalledTimes(1);
  });

  it('keeps a pack available after a transient playback failure', async () => {
    const output = backend();
    output.play.mockRejectedValueOnce(new Error('audio context resume was interrupted'));
    const service = new WebAudioService(output);

    await expect(service.preview('soft', 0.5)).resolves.toBeUndefined();
    expect(service.isAvailable('soft')).toBe(true);

    await service.play('correct', { ...enabled, packId: 'soft' });
    expect(output.play).toHaveBeenCalledTimes(2);
  });
});

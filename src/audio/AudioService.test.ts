import { describe, expect, it, vi } from 'vitest';
import type { AudioSettings } from '../app/settings';
import { WebAudioService, type AudioBackend } from './WebAudioService';

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
    output.play.mockRejectedValueOnce(new Error('decode failed'));
    const service = new WebAudioService(output);

    await expect(service.preview('minimal', 0.5)).resolves.toBeUndefined();
    await expect(
      service.play('complete', { ...enabled, packId: 'minimal' }),
    ).resolves.toBeUndefined();
    expect(service.isAvailable('minimal')).toBe(false);
    expect(output.play).toHaveBeenCalledTimes(1);
  });
});

import type { AudioSettings, SoundPackId } from '../app/settings';
import type { AudioService } from './AudioService';
import type { SoundEvent } from './types';

export interface AudioBackend {
  load(source: string): Promise<void>;
  play(source: string, volume: number): Promise<void>;
}

const sources: Readonly<Record<SoundPackId, Readonly<Record<SoundEvent, string>>>> = {
  crisp: {
    correct: new URL('./assets/crisp/correct.wav', import.meta.url).href,
    incorrect: new URL('./assets/crisp/incorrect.wav', import.meta.url).href,
    hint: new URL('./assets/crisp/hint.wav', import.meta.url).href,
    reveal: new URL('./assets/crisp/reveal.wav', import.meta.url).href,
    complete: new URL('./assets/crisp/complete.wav', import.meta.url).href,
  },
  soft: {
    correct: new URL('./assets/soft/correct.wav', import.meta.url).href,
    incorrect: new URL('./assets/soft/incorrect.wav', import.meta.url).href,
    hint: new URL('./assets/soft/hint.wav', import.meta.url).href,
    reveal: new URL('./assets/soft/reveal.wav', import.meta.url).href,
    complete: new URL('./assets/soft/complete.wav', import.meta.url).href,
  },
  minimal: {
    correct: new URL('./assets/minimal/correct.wav', import.meta.url).href,
    incorrect: new URL('./assets/minimal/incorrect.wav', import.meta.url).href,
    hint: new URL('./assets/minimal/hint.wav', import.meta.url).href,
    reveal: new URL('./assets/minimal/reveal.wav', import.meta.url).href,
    complete: new URL('./assets/minimal/complete.wav', import.meta.url).href,
  },
};

const events: readonly SoundEvent[] = ['correct', 'incorrect', 'hint', 'reveal', 'complete'];

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export class WebAudioService implements AudioService {
  readonly #unavailable = new Set<SoundPackId>();

  constructor(private readonly backend: AudioBackend = new BrowserAudioBackend()) {}

  isAvailable(packId: SoundPackId): boolean {
    return !this.#unavailable.has(packId);
  }

  async preload(packId: SoundPackId): Promise<void> {
    if (!this.isAvailable(packId)) return;
    try {
      await Promise.all(events.map((event) => this.backend.load(sources[packId][event])));
    } catch {
      this.#unavailable.add(packId);
    }
  }

  async preview(packId: SoundPackId, volume: number): Promise<void> {
    await this.#safePlay(packId, 'correct', volume);
  }

  async play(event: SoundEvent, settings: AudioSettings): Promise<void> {
    if (!settings.enabled) return;
    await this.#safePlay(settings.packId, event, settings.volume);
  }

  async #safePlay(packId: SoundPackId, event: SoundEvent, volume: number): Promise<void> {
    if (!this.isAvailable(packId)) return;
    try {
      await this.backend.play(sources[packId][event], clampVolume(volume));
    } catch {
      this.#unavailable.add(packId);
    }
  }
}

export class BrowserAudioBackend implements AudioBackend {
  readonly #buffers = new Map<string, Promise<AudioBuffer>>();
  #context: AudioContext | null = null;

  async load(source: string): Promise<void> {
    await this.#buffer(source);
  }

  async play(source: string, volume: number): Promise<void> {
    const context = this.#audioContext();
    if (context.state === 'suspended') await context.resume();
    const node = context.createBufferSource();
    const gain = context.createGain();
    node.buffer = await this.#buffer(source);
    gain.gain.value = volume;
    node.connect(gain);
    gain.connect(context.destination);
    node.start();
  }

  #audioContext(): AudioContext {
    this.#context ??= new AudioContext();
    return this.#context;
  }

  #buffer(source: string): Promise<AudioBuffer> {
    const existing = this.#buffers.get(source);
    if (existing) return existing;
    const pending = fetch(source)
      .then((response) => {
        if (!response.ok) throw new Error('Audio asset unavailable');
        return response.arrayBuffer();
      })
      .then((bytes) => this.#audioContext().decodeAudioData(bytes));
    this.#buffers.set(source, pending);
    return pending;
  }
}

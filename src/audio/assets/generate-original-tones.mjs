import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const sampleRate = 8_000;
const definitions = {
  crisp: {
    correct: [[660, 0.09], [880, 0.11]], incorrect: [[260, 0.09], [190, 0.12]],
    hint: [[520, 0.08], [610, 0.08]], reveal: [[390, 0.08], [520, 0.1]],
    complete: [[440, 0.14], [660, 0.14], [880, 0.28]],
  },
  soft: {
    correct: [[440, 0.08], [554, 0.1]], incorrect: [[220, 0.08], [174, 0.1]],
    hint: [[349, 0.1], [415, 0.11]], reveal: [[294, 0.08], [440, 0.1]],
    complete: [[330, 0.16], [494, 0.16], [659, 0.3]],
  },
  minimal: {
    correct: [[720, 0.1]], incorrect: [[180, 0.13]], hint: [[520, 0.09]],
    reveal: [[360, 0.08], [480, 0.1]], complete: [[480, 0.12], [720, 0.22]],
  },
};

function wav(notes) {
  const gap = Math.round(sampleRate * 0.018);
  const samples = [];
  for (const [frequency, seconds] of notes) {
    const length = Math.round(sampleRate * seconds);
    for (let index = 0; index < length; index += 1) {
      const attack = Math.min(1, index / (sampleRate * 0.012));
      const release = Math.min(1, (length - index) / (sampleRate * 0.035));
      const envelope = Math.min(attack, release);
      const fundamental = Math.sin(2 * Math.PI * frequency * index / sampleRate);
      const overtone = Math.sin(2 * Math.PI * frequency * 2 * index / sampleRate) * 0.12;
      samples.push(Math.round((fundamental + overtone) * envelope * 0.28 * 32767));
    }
    samples.push(...Array.from({ length: gap }, () => 0));
  }
  const buffer = Buffer.alloc(44 + samples.length * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples.length * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => buffer.writeInt16LE(sample, 44 + index * 2));
  return buffer;
}

for (const [pack, events] of Object.entries(definitions)) {
  const directory = join(root, pack);
  mkdirSync(directory, { recursive: true });
  for (const [event, notes] of Object.entries(events)) {
    writeFileSync(join(directory, `${event}.wav`), wav(notes));
  }
}

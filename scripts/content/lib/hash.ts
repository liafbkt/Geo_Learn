import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareOrdinal(left, right))
        .map(([key, child]) => [key, normalizeJson(child)]),
    );
  }
  return value;
}

export function stableJsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(normalizeJson(value), null, 2)}\n`, 'utf8');
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path));
}

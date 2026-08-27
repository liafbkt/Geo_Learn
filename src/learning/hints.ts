import type { Coordinate } from '../content/types';

export type CompassSector =
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west';

export type Hint =
  | Readonly<{ kind: 'map-direction'; sector: CompassSector }>
  | Readonly<{ kind: 'text-reveal'; reveal: string }>
  | Readonly<{ kind: 'choice-elimination'; eliminatedEntityId: string }>;

export type HintRequest =
  | Readonly<{ kind: 'map'; selectedCoordinate: Coordinate; targetCoordinate: Coordinate }>
  | Readonly<{ kind: 'text'; acceptedDisplayValue: string }>
  | Readonly<{
      kind: 'choice';
      correctEntityId: string;
      candidateOrder: readonly string[];
    }>;

const sectors = [
  'east',
  'north-east',
  'north',
  'north-west',
  'west',
  'south-west',
  'south',
  'south-east',
] as const satisfies readonly CompassSector[];

function directionSector(selected: Coordinate, target: Coordinate): CompassSector {
  const longitudeDelta = target[0] - selected[0];
  const latitudeDelta = target[1] - selected[1];
  if (longitudeDelta === 0 && latitudeDelta === 0) {
    throw new Error('Map hints require different coordinates');
  }

  const angle = ((Math.atan2(latitudeDelta, longitudeDelta) * 180) / Math.PI + 360) % 360;
  const clockwiseBoundaryIndex = Math.ceil((angle - 22.5) / 45);
  return sectors[(clockwiseBoundaryIndex + sectors.length) % sectors.length] as CompassSector;
}

function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Text hints require a non-empty display value');
  }

  type GraphemeSegmenter = Readonly<{
    segment(input: string): Iterable<Readonly<{ segment: string }>>;
  }>;
  type GraphemeSegmenterConstructor = new (
    locales?: string | readonly string[],
    options?: Readonly<{ granularity: 'grapheme' }>,
  ) => GraphemeSegmenter;
  const Segmenter = (
    Intl as typeof Intl & Readonly<{ Segmenter: GraphemeSegmenterConstructor }>
  ).Segmenter;
  const first = new Segmenter(undefined, { granularity: 'grapheme' })
    .segment(trimmed)
    [Symbol.iterator]()
    .next();
  if (first.done === true) {
    throw new Error('Text hints require a non-empty display value');
  }

  return /^\p{Script=Latin}/u.test(first.value.segment)
    ? first.value.segment.toLocaleUpperCase('en-US')
    : first.value.segment;
}

export function buildHint(request: HintRequest): Hint {
  switch (request.kind) {
    case 'map':
      return {
        kind: 'map-direction',
        sector: directionSector(request.selectedCoordinate, request.targetCoordinate),
      };
    case 'text':
      return { kind: 'text-reveal', reveal: firstGrapheme(request.acceptedDisplayValue) };
    case 'choice': {
      const eliminatedEntityId = request.candidateOrder.find(
        (candidateId) => candidateId !== request.correctEntityId,
      );
      if (eliminatedEntityId === undefined) {
        throw new Error('Choice hints require at least one distractor');
      }
      return { kind: 'choice-elimination', eliminatedEntityId };
    }
  }
}

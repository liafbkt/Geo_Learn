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
  | Readonly<{
      kind: 'text-shape';
      script: 'han' | 'latin' | 'other';
      graphemeCount: number;
    }>
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

type GraphemeSegmenter = Readonly<{
  segment(input: string): Iterable<Readonly<{ segment: string }>>;
}>;
type GraphemeSegmenterConstructor = new (
  locales?: string | readonly string[],
  options?: Readonly<{ granularity: 'grapheme' }>,
) => GraphemeSegmenter;

function graphemes(value: string): readonly string[] {
  const Segmenter = (
    Intl as typeof Intl & Readonly<{ Segmenter: GraphemeSegmenterConstructor }>
  ).Segmenter;
  return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map(
    ({ segment }) => segment,
  );
}

function textHint(value: string): Hint {
  const segments = graphemes(value.trim());
  const first = segments[0];
  if (first === undefined) {
    throw new Error('Text hints require a non-empty display value');
  }

  const script = /^\p{Script=Han}/u.test(first)
    ? 'han'
    : /^\p{Script=Latin}/u.test(first)
      ? 'latin'
      : 'other';
  if (segments.length === 1) {
    return { kind: 'text-shape', script, graphemeCount: 1 };
  }

  if (script !== 'latin') {
    return { kind: 'text-reveal', reveal: first };
  }
  const uppercase = first.toLocaleUpperCase('en-US');
  return {
    kind: 'text-reveal',
    reveal: graphemes(uppercase).length === 1 ? uppercase : first,
  };
}

export function buildHint(request: HintRequest): Hint {
  switch (request.kind) {
    case 'map':
      return {
        kind: 'map-direction',
        sector: directionSector(request.selectedCoordinate, request.targetCoordinate),
      };
    case 'text':
      return textHint(request.acceptedDisplayValue);
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

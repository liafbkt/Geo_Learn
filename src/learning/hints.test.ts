import { describe, expect, it } from 'vitest';

import { buildHint } from './hints';

describe('buildHint', () => {
  it.each([
    [[0, 1], 'north'],
    [[1, 1], 'north-east'],
    [[1, 0], 'east'],
    [[1, -1], 'south-east'],
    [[0, -1], 'south'],
    [[-1, -1], 'south-west'],
    [[-1, 0], 'west'],
    [[-1, 1], 'north-west'],
  ] as const)('returns the %s compass sector without revealing the target', (target, sector) => {
    expect(
      buildHint({ kind: 'map', selectedCoordinate: [0, 0], targetCoordinate: target }),
    ).toEqual({ kind: 'map-direction', sector });
  });

  it('assigns an exact north/east boundary clockwise to north-east', () => {
    const angle = (Math.PI * 3) / 8;
    const target = [Math.cos(angle), Math.sin(angle)] as const;

    expect(
      buildHint({ kind: 'map', selectedCoordinate: [0, 0], targetCoordinate: target }),
    ).toEqual({ kind: 'map-direction', sector: 'north-east' });
  });

  it('refuses a direction when selected and target coordinates are equal', () => {
    expect(() =>
      buildHint({ kind: 'map', selectedCoordinate: [1, 2], targetCoordinate: [1, 2] }),
    ).toThrow(/different coordinates/i);
  });

  it.each([
    ['上海', '上'],
    ['👨‍👩‍👧‍👦家庭', '👨‍👩‍👧‍👦'],
    ['e\u0301clair', 'E\u0301'],
    ['ßland', 'ß'],
  ])('reveals exactly one Unicode grapheme from %j', (answer, reveal) => {
    expect(buildHint({ kind: 'text', acceptedDisplayValue: answer })).toEqual({
      kind: 'text-reveal',
      reveal,
    });
  });

  it.each([
    ['沪', 'han'],
    ['x', 'latin'],
    ['ß', 'latin'],
  ] as const)('uses a non-revealing shape hint for one-grapheme %j', (answer, script) => {
    expect(buildHint({ kind: 'text', acceptedDisplayValue: answer })).toEqual({
      kind: 'text-shape',
      script,
      graphemeCount: 1,
    });
  });

  it('reveals an uppercase English initial without returning the answer', () => {
    expect(buildHint({ kind: 'text', acceptedDisplayValue: '  los angeles' })).toEqual({
      kind: 'text-reveal',
      reveal: 'L',
    });
  });

  it('refuses a text hint for an empty display value', () => {
    expect(() => buildHint({ kind: 'text', acceptedDisplayValue: '  ' })).toThrow(
      /display value/i,
    );
  });

  it('eliminates the first ordered distractor and never the correct choice', () => {
    expect(
      buildHint({
        kind: 'choice',
        correctEntityId: 'right',
        candidateOrder: ['right', 'wrong-b', 'wrong-a', 'wrong-c'],
      }),
    ).toEqual({ kind: 'choice-elimination', eliminatedEntityId: 'wrong-b' });
  });

  it('refuses choice hints without a distractor', () => {
    expect(() =>
      buildHint({ kind: 'choice', correctEntityId: 'right', candidateOrder: ['right', 'right'] }),
    ).toThrow(/distractor/i);
  });
});

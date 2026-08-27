import { describe, expect, it } from 'vitest';

import { isAcceptedAnswer, normalizeAnswer, type AnswerSpec } from './normalizeAnswer';

describe('normalizeAnswer', () => {
  it.each([
    ['  Shanghai  ', 'shanghai'],
    ['ＳＨＡＮＧＨＡＩ', 'shanghai'],
    ['New York', 'new york'],
    ['new-york', 'new york'],
    ['new__york', 'new york'],
    ['上海市', '上海市'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });
});

describe('isAcceptedAnswer', () => {
  const shanghai: AnswerSpec = {
    acceptedDisplayValues: ['上海市', '上海', 'Shanghai'],
  };

  it.each(['上海市', '上海', 'Shanghai', 'shanghai', ' Ｓｈａｎｇｈａｉ '])(
    'accepts the declared bilingual form %j',
    (answer) => {
      expect(isAcceptedAnswer(answer, shanghai)).toBe(true);
    },
  );

  it('does not invent undeclared pinyin', () => {
    expect(isAcceptedAnswer('shang hai', shanghai)).toBe(false);
  });

  it('does not fuzzy-match a misspelling', () => {
    const losAngeles: AnswerSpec = { acceptedDisplayValues: ['Los Angeles'] };

    expect(isAcceptedAnswer('Los Angles', losAngeles)).toBe(false);
    expect(isAcceptedAnswer('Los Angeles', losAngeles)).toBe(true);
  });

  it('normalizes declared separators without mutating display values', () => {
    const newYork: AnswerSpec = { acceptedDisplayValues: ['New York', '纽约'] };

    expect(isAcceptedAnswer('new-york', newYork)).toBe(true);
    expect(newYork.acceptedDisplayValues).toEqual(['New York', '纽约']);
  });

  it('refuses an answer spec with no non-empty declared values', () => {
    expect(() => isAcceptedAnswer('anything', { acceptedDisplayValues: ['  '] })).toThrow(
      /accepted display value/i,
    );
  });
});

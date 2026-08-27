export type AnswerSpec = Readonly<{
  acceptedDisplayValues: readonly string[];
}>;

export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s\p{Dash_Punctuation}_]+/gu, ' ');
}

export function isAcceptedAnswer(answer: string, spec: AnswerSpec): boolean {
  const accepted = spec.acceptedDisplayValues.map(normalizeAnswer).filter(Boolean);
  if (accepted.length === 0) {
    throw new Error('AnswerSpec requires at least one accepted display value');
  }

  return accepted.includes(normalizeAnswer(answer));
}

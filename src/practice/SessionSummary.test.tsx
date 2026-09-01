import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import type { AttemptEvent, MasteryRecord } from '../learning/types';
import { SessionSummary } from './SessionSummary';

function attempt(overrides: Partial<AttemptEvent>): AttemptEvent {
  return {
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    learnerId: 'learner-1',
    packId: 'pack-1',
    entityId: 'region-a',
    skill: 'locate_region',
    questionKind: 'locate_region',
    scheduledReview: false,
    delayedRetry: false,
    answerAttemptCount: 1,
    correct: true,
    usedHint: false,
    responseMs: 1200,
    completedAt: '2026-08-30T01:00:00.000Z',
    mode: 'smart',
    independentCorrect: true,
    ...overrides,
  } as AttemptEvent;
}

function mastery(
  stage: MasteryRecord['stage'],
  entityId: string,
  skill: MasteryRecord['skill'] = 'locate_region',
): MasteryRecord {
  return {
    learnerId: 'learner-1',
    packId: 'pack-1',
    entityId,
    skill,
    stage,
    scheduledIntervalMs: 86_400_000,
    dueAt: '2026-08-31T00:00:00.000Z',
    smoothedResponseMs: 1200,
    updatedAt: '2026-08-30T01:00:00.000Z',
  };
}

describe('SessionSummary', () => {
  it('shows learning metrics and creates a weakness-scoped custom request', () => {
    const onPracticeWeaknesses = vi.fn();
    const { container } = render(
      <SessionSummary
        packId="pack-1"
        attempts={[
          attempt({ attemptId: 'a1', entityId: 'region-a' }),
          attempt({
            attemptId: 'a2',
            entityId: 'region-b',
            correct: false,
            independentCorrect: false,
            usedHint: true,
            answerAttemptCount: 2,
          }),
        ]}
        masteryBefore={[mastery('learning', 'region-a'), mastery('familiar', 'region-b')]}
        masteryAfter={[mastery('weak', 'region-a'), mastery('weak', 'region-b')]}
        introducedEntityIds={['region-c']}
        fragileKeysBefore={['region-d|locate_region']}
        fragileKeysAfter={['region-b|locate_region']}
        onPracticeWeaknesses={onPracticeWeaknesses}
        onHome={vi.fn()}
      />,
    );

    expect(screen.getByText('答对率').nextElementSibling).toHaveTextContent('50%');
    expect(screen.getByText('独立正确').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('使用提示').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('新认识地点').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('掌握提升').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('掌握回落').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('新增易忘').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('解除易忘').nextElementSibling).toHaveTextContent('1');
    expect(container).not.toHaveTextContent(/XP|排行|惩罚分/);

    fireEvent.click(screen.getByRole('button', { name: '再练薄弱项' }));
    expect(onPracticeWeaknesses).toHaveBeenCalledWith({
      mode: 'custom',
      packId: 'pack-1',
      questionCount: 12,
      entityIds: ['region-b'],
      skills: ['locate_region'],
      statuses: ['weak', 'fragile'],
    });
  });

  it('keeps weakness practice on an exact entity-skill pair', () => {
    const onPracticeWeaknesses = vi.fn();
    render(
      <SessionSummary
        packId="pack-1"
        attempts={[
          attempt({
            attemptId: 'a1',
            entityId: 'region-a',
            correct: false,
            independentCorrect: false,
          }),
          attempt({
            attemptId: 'a2',
            entityId: 'region-b',
            skill: 'identify_region',
            questionKind: 'identify_region',
            correct: false,
            independentCorrect: false,
          }),
        ]}
        masteryBefore={[
          mastery('familiar', 'region-a'),
          mastery('familiar', 'region-b', 'identify_region'),
        ]}
        masteryAfter={[
          mastery('weak', 'region-a'),
          mastery('weak', 'region-b', 'identify_region'),
        ]}
        introducedEntityIds={[]}
        fragileKeysBefore={[]}
        fragileKeysAfter={[]}
        onPracticeWeaknesses={onPracticeWeaknesses}
        onHome={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '再练薄弱项' }));
    expect(onPracticeWeaknesses).toHaveBeenCalledWith({
      mode: 'custom',
      packId: 'pack-1',
      questionCount: 12,
      entityIds: ['region-a'],
      skills: ['locate_region'],
      statuses: ['weak'],
    });
  });
});

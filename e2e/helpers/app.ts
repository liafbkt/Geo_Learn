import { expect, type Page } from '@playwright/test';
import type { E2EControlState } from '../../src/e2e/types';
import type { PracticeSession } from '../../src/practice/session';

export async function resetE2E(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
  await page.evaluate(() => window.__GEOLEARN_E2E__.reset());
  await page.reload();
  await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
}

export async function setQuestionKinds(
  page: Page,
  kinds: Parameters<Window['__GEOLEARN_E2E__']['setQuestionKinds']>[0],
): Promise<void> {
  await page.evaluate((selected) => window.__GEOLEARN_E2E__.setQuestionKinds(selected), kinds);
}

export async function readE2EState(page: Page): Promise<E2EControlState> {
  return page.evaluate(() => window.__GEOLEARN_E2E__.readState());
}

export function packCard(page: Page, title: string) {
  return page.locator('article').filter({
    has: page.getByRole('heading', { name: title }),
  });
}

export async function openSmartPractice(page: Page, title: string): Promise<void> {
  await packCard(page, title).getByRole('button', { name: '智能练习' }).click();
  await expect(page.getByRole('heading', { name: '从哪里开始？' })).toBeVisible();
}

export async function continueIntroduction(page: Page): Promise<void> {
  const button = page.getByRole('button', { name: /继续认识|开始答题/ });
  while (await button.isVisible()) await button.click();
}

function newestSession(state: E2EControlState): PracticeSession {
  const session = [...state.sessions].sort(
    (left, right) => right.startedAt.localeCompare(left.startedAt) ||
      right.sessionId.localeCompare(left.sessionId),
  )[0];
  if (session === undefined) throw new Error('Expected a persisted E2E practice session');
  return session;
}

async function chooseWrongAnswer(page: Page): Promise<void> {
  const text = page.getByLabel('输入答案');
  if (await text.isVisible()) {
    await text.fill('错误答案');
    return;
  }

  const choices = page.getByRole('group', { name: '答案选项' }).getByRole('button');
  if (await choices.first().isVisible()) {
    const state = await readE2EState(page);
    const session = newestSession(state);
    const question = session.questions[session.questionCursor];
    if (question === undefined || question.presentation !== 'choice') {
      throw new Error('Expected a persisted choice question');
    }
    const correctId = question.kind === 'associate_capital'
      ? question.capitalId
      : question.entityId;
    for (const [index, candidateId] of question.candidateEntityIds.entries()) {
      if (candidateId !== correctId && await choices.nth(index).isEnabled()) {
        await choices.nth(index).click();
        return;
      }
    }
    throw new Error('No enabled incorrect choice remains');
  }

  const options = page.getByRole('listbox').getByRole('option');
  if (await options.nth(1).isVisible()) {
    const map = page.getByRole('listbox');
    await map.focus();
    await map.press('ArrowRight');
    await map.press('Enter');
    return;
  }
  throw new Error('No answer control is visible');
}

export async function answerWrong(page: Page): Promise<void> {
  await chooseWrongAnswer(page);
  await page.getByRole('button', { name: '检查答案' }).click();
}

export async function revealCurrentQuestion(page: Page): Promise<void> {
  await answerWrong(page);
  await expect(page.getByText('再试一次', { exact: true })).toBeVisible();
  const hint = page.getByRole('button', { name: /提示/ });
  if (await hint.isEnabled()) await hint.click();
  await chooseWrongAnswer(page);
  await page.getByRole('button', { name: '检查答案' }).click();
  await expect(page.getByText('答案已揭示', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /继续|查看总结/ })).toBeEnabled();
}

export async function finishRemainingQuestions(page: Page): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    const summary = page.getByRole('heading', { name: '本次总结' });
    if (await summary.isVisible()) return;
    const next = page.getByRole('button', { name: /继续|查看总结/ });
    if (await next.isVisible() && await next.isEnabled()) await next.click();
    if (await summary.isVisible()) return;
    await continueIntroduction(page);
    await revealCurrentQuestion(page);
  }
  throw new Error('Practice did not reach summary within the 15-question product cap');
}

export async function delayedRetryDistance(page: Page): Promise<number> {
  const session = newestSession(await readE2EState(page));
  const first = session.questions[0];
  if (first === undefined) throw new Error('Expected at least one question');
  const retryIndex = session.questions.findIndex(
    (question, index) =>
      index > 0 && question.kind === first.kind && question.entityId === first.entityId,
  );
  if (retryIndex < 0) throw new Error('Expected an inserted delayed retry');
  return retryIndex;
}

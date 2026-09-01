import { expect, test } from '@playwright/test';
import {
  answerWrong,
  continueIntroduction,
  delayedRetryDistance,
  finishRemainingQuestions,
  openSmartPractice,
  readE2EState,
  resetE2E,
  setQuestionKinds,
} from './helpers/app';

test('smart practice introduces, corrects, delays a retry, and summarizes', async ({ page }) => {
  await resetE2E(page);
  await setQuestionKinds(page, [
    'locate_region',
    'identify_region',
    'associate_capital',
    'locate_place',
    'identify_place',
  ]);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await expect(page.getByText('认识 1/1')).toBeVisible();
  await continueIntroduction(page);

  await answerWrong(page);
  await expect(page.getByText('再试一次', { exact: true })).toBeVisible();
  await expect(page.getByText(/目标大约在所选位置的/)).toBeVisible();
  await page.evaluate(() => window.__GEOLEARN_E2E__.failNextAttemptSave());
  await answerWrong(page);
  await expect(page.getByText('答案已揭示', { exact: true })).toBeVisible();
  await expect(page.getByText('保存失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /继续|查看总结/ })).toBeDisabled();

  await page.getByRole('button', { name: '重试保存' }).click();
  await expect(page.getByText('保存失败', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: /继续|查看总结/ })).toBeEnabled();
  expect((await readE2EState(page)).attempts).toHaveLength(1);

  await finishRemainingQuestions(page);
  await expect(page.getByRole('heading', { name: '本次总结' })).toBeVisible();
  expect(await delayedRetryDistance(page)).toBeGreaterThanOrEqual(3);
});

test('reload restores the same unfinished practice session', async ({ page }) => {
  await resetE2E(page);
  await setQuestionKinds(page, ['locate_region', 'identify_region']);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await continueIntroduction(page);
  const before = (await readE2EState(page)).sessions[0];
  expect(before).toBeDefined();

  await page.reload();
  const card = page.locator('article').filter({
    has: page.getByRole('heading', { name: '美国50州与州府' }),
  });
  await expect(card.getByRole('button', { name: '继续上次练习' })).toBeVisible();
  await card.getByRole('button', { name: '继续上次练习' }).click();

  const after = (await readE2EState(page)).sessions[0];
  expect(after?.sessionId).toBe(before?.sessionId);
  expect(after?.questionCursor).toBe(before?.questionCursor);
  await expect(page.getByRole('region', { name: '题目与操作' }).getByRole('heading')).toBeVisible();
});

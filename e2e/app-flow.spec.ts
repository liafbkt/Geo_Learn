import { expect, test, type Page } from '@playwright/test';

async function answerIncorrectly(page: Page) {
  const textInput = page.getByLabel('输入答案');
  const choices = page.getByRole('group', { name: '答案选项' }).getByRole('button');
  const map = page.getByRole('listbox');

  if (await textInput.isVisible()) {
    await textInput.fill('不知道');
  } else if (await choices.first().isVisible()) {
    await choices.first().click();
  } else {
    await map.getByRole('option').first().click();
  }
  await page.getByRole('button', { name: '检查答案' }).click();

  if (await page.getByText('再试一次', { exact: true }).isVisible()) {
    if (await textInput.isVisible()) {
      await textInput.fill('仍然不知道');
    } else if (await choices.first().isVisible()) {
      const enabledChoice = page.getByRole('group', { name: '答案选项' }).locator('button:not(:disabled)').first();
      await enabledChoice.click();
    } else {
      await map.getByRole('option').first().click();
    }
    await page.getByRole('button', { name: '检查答案' }).click();
  }
}

test('browser memory adapters support data export and a persisted practice attempt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
  await expect(page.locator('article')).toHaveCount(3);

  await page.getByRole('button', { name: '数据管理' }).click();
  await page.getByRole('button', { name: '导出备份' }).click();
  await expect(page.getByRole('status')).toContainText('空间记忆教练备份.geolearn-backup');
  await page.getByRole('button', { name: '返回首页' }).click();

  const usCard = page.locator('article').filter({ has: page.getByRole('heading', { name: '美国50州与州府' }) });
  await usCard.getByRole('button', { name: '智能练习' }).click();
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();

  const continueIntroduction = page.getByRole('button', { name: '继续认识' });
  for (let index = 0; index < 15 && await continueIntroduction.isVisible(); index += 1) {
    await continueIntroduction.click();
  }
  await expect(page.getByRole('region', { name: '题目与操作' }).getByRole('heading')).toBeVisible();

  await answerIncorrectly(page);
  await expect(page.getByRole('button', { name: /继续|查看总结/ })).toBeEnabled();
  await expect(page.getByText(/答对了|答案已揭示/)).toBeVisible();
});

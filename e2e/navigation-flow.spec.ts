import { expect, test } from '@playwright/test';
import {
  continueIntroduction,
  openSmartPractice,
  packCard,
  readE2EState,
  resetE2E,
  setQuestionKinds,
} from './helpers/app';

test('home exposes main navigation and learning scope at desktop and narrow viewports', async ({ page }) => {
  for (const viewport of [{ width: 1672, height: 941 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await resetE2E(page);
    await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  }
});

test('placement and custom entries persist the selected request', async ({ page }) => {
  await resetE2E(page);
  await setQuestionKinds(page, ['locate_region']);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '开始摸底' }).click();
  await continueIntroduction(page);
  expect((await readE2EState(page)).sessions[0]?.request).toEqual({
    mode: 'placement',
    packId: 'us-states',
  });

  await page.evaluate(() => window.__GEOLEARN_E2E__.reset());
  await page.reload();
  await packCard(page, '美国50州与州府').getByRole('button', { name: '自定义练习' }).click();
  await page.getByRole('checkbox', { name: /阿拉斯加州 \/ Alaska/ }).check();
  await page.getByRole('checkbox', { name: '地图定位行政区' }).check();
  await page.getByRole('checkbox', { name: '新内容' }).check();
  await page.getByLabel('题量').fill('1');
  await page.getByRole('button', { name: '开始自定义练习' }).click();
  await continueIntroduction(page);

  expect((await readE2EState(page)).sessions[0]?.request).toEqual({
    mode: 'custom',
    packId: 'us-states',
    questionCount: 1,
    entityIds: ['us-ak'],
    skills: ['locate_region'],
    statuses: ['new'],
  });
});

test('explore selection starts focused practice for that entity', async ({ page }) => {
  await resetE2E(page);
  await packCard(page, '美国50州与州府').getByRole('button', { name: '探索地图' }).click();
  await expect(page.getByText('探索模式不计分')).toBeVisible();
  const map = page.getByRole('listbox', { name: '美国50州与州府' });
  await map.focus();
  await map.press('Enter');
  await expect(page.getByRole('complementary', { name: '地点学习详情' })).toBeVisible();
  await page.getByRole('button', { name: '练习这个地点' }).click();
  await continueIntroduction(page);

  const request = (await readE2EState(page)).sessions[0]?.request;
  expect(request).toMatchObject({ mode: 'custom', packId: 'us-states', entityIds: ['us-ak'] });
});

test('Escape unwinds options to pause to practice and restores focus', async ({ page }) => {
  await resetE2E(page);
  await setQuestionKinds(page, ['locate_region']);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await continueIntroduction(page);
  const pause = page.getByRole('button', { name: '暂停' });
  await pause.focus();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '练习已暂停' })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续' })).toBeFocused();
  await page.getByRole('button', { name: '选项' }).click();
  await expect(page.getByRole('dialog', { name: '选项' })).toBeVisible();
  await expect(page.getByRole('button', { name: '返回暂停' })).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '练习已暂停' })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(pause).toBeFocused();
});

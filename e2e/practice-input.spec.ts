import { expect, test } from '@playwright/test';
import { openSmartPractice, readE2EState, resetE2E, setQuestionKinds } from './helpers/app';

test('Space continues map answers without a preparation screen', async ({ page }) => {
  await resetE2E(page);
  await setQuestionKinds(page, ['locate_region', 'locate_region']);
  await openSmartPractice(page, '中国省级行政区');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await expect(page.getByRole('button', { name: '继续认识', exact: true })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: '继续认识', exact: true })).toBeHidden();
  const map = page.getByRole('listbox');
  await map.focus();
  await map.press('Enter');
  await page.keyboard.press('Space');
  await expect(page.getByText(/^(再试一次|答对了)$/)).toBeVisible();
  // A second wrong answer reveals the answer if the initial selection was wrong.
  if (await page.getByText('再试一次', { exact: true }).isVisible()) {
    await map.press('Enter');
    await page.keyboard.press('Space');
  }
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.getByText('准备好了', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '检查答案', exact: true })).toBeVisible();
  expect((await readE2EState(page)).attempts).toHaveLength(1);
});

test('left drag leaves the map fixed and right drag pans without selecting', async ({ page }) => {
  await resetE2E(page);
  await page.locator('article').filter({ has: page.getByRole('heading', { name: '中国省级行政区', exact: true }) }).getByRole('button', { name: '探索地图' }).click();
  const map = page.getByRole('listbox');
  const transform = page.getByTestId('map-transform');
  const box = (await map.boundingBox())!;
  const original = await transform.getAttribute('transform');
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(transform).toHaveAttribute('transform', original!);
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + 80, box.y + 60, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await expect(transform).not.toHaveAttribute('transform', original!);
  await expect(page.getByRole('heading', { name: '选择地图上的地点' })).toBeVisible();
  await page.getByRole('option', { name: '湖北省 / Hubei', exact: true }).click();
  await expect(page.getByRole('button', { name: '练习这个地点' })).toBeVisible();
});

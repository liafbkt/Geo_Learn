import { expect, test } from '@playwright/test';

// This checks the built browser shell only. Native updater/install and learning
// flows require separate desktop acceptance once their prerequisites exist.
for (const viewport of [{ width: 800, height: 600 }, { width: 1280, height: 800 }]) {
  test(`built shell loads and reloads without external requests at ${viewport.width}x${viewport.height}`, async ({ page, baseURL }) => {
    const pageErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.route('**/*', async (route) => {
      if (new URL(route.request().url()).origin !== new URL(baseURL!).origin) {
        externalRequests.push(route.request().url());
        await route.abort();
        return;
      }
      await route.continue();
    });
    await page.setViewportSize(viewport);
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
    expect(externalRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

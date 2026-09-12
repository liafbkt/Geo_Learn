import { expect, test } from '@playwright/test';
import { PERFORMANCE_THRESHOLDS } from '../src/app/performance';
import {
  answerWrong,
  continueIntroduction,
  openSmartPractice,
  readE2EState,
  resetE2E,
  revealCurrentQuestion,
  setQuestionKinds,
} from './helpers/app';

function percentile95(samples: readonly number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? Number.POSITIVE_INFINITY;
}

async function latestDuration(page: import('@playwright/test').Page, start: string, end: string) {
  return page.evaluate(({ start, end }) => {
    const first = performance.getEntriesByName(start).at(-1)?.startTime;
    const last = performance.getEntriesByName(end).at(-1)?.startTime;
    return first === undefined || last === undefined ? null : last - first;
  }, { start, end });
}

test('denied public network still permits learning, save, and backup export', async ({ page, baseURL }) => {
  const externalRequests: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL!).origin) {
      externalRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await resetE2E(page);
  await page.evaluate(() => window.__GEOLEARN_E2E__.setUpdate({ kind: 'error' }));
  await expect(page.getByText(/检查更新失败/)).toBeHidden();
  await page.getByRole('button', { name: '检查更新' }).click();
  await expect(page.getByText(/检查更新失败/)).toBeVisible();

  await setQuestionKinds(page, ['locate_region']);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await continueIntroduction(page);
  await revealCurrentQuestion(page);
  expect((await readE2EState(page)).attempts).toHaveLength(1);
  await page.getByRole('button', { name: '查看总结' }).click();
  await page.getByRole('button', { name: '返回主菜单' }).click();
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '数据管理' }).click();
  await page.getByRole('button', { name: '导出备份' }).click();
  await expect(page.getByRole('status')).toContainText('空间记忆教练备份.geolearn-backup');
  expect(externalRequests).toEqual([]);
});

test('fixed browser fixture meets cold-start, feedback, transition, and map-frame thresholds', async ({ page }, testInfo) => {
  await resetE2E(page);
  const coldStartMs = await page.evaluate(() =>
    performance.getEntriesByName('geo:home-ready').at(-1)?.startTime ?? null);
  expect(coldStartMs).not.toBeNull();
  expect(coldStartMs!).toBeLessThanOrEqual(PERFORMANCE_THRESHOLDS.coldStartMs);

  await setQuestionKinds(page, ['locate_region', 'identify_region']);
  await openSmartPractice(page, '美国50州与州府');
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await continueIntroduction(page);
  const frameSamples = await page.evaluate(async () => {
    const map = document.querySelector('[role="listbox"]');
    if (map === null) throw new Error('Interactive map is missing');
    const timestamps: number[] = [];
    await new Promise<void>((resolve) => {
      const collect = (timestamp: number) => {
        timestamps.push(timestamp);
        map.dispatchEvent(new WheelEvent('wheel', {
          deltaY: timestamps.length % 2 === 0 ? 1 : -1,
          bubbles: true,
          cancelable: true,
        }));
        if (timestamps.length >= 131) resolve();
        else requestAnimationFrame(collect);
      };
      requestAnimationFrame(collect);
    });
    return timestamps.slice(11).map((value, index) => value - timestamps[index + 10]!);
  });
  await testInfo.attach('map-frame-samples.json', {
    body: Buffer.from(JSON.stringify(frameSamples)),
    contentType: 'application/json',
  });
  expect(frameSamples).toHaveLength(120);
  expect(percentile95(frameSamples)).toBeLessThanOrEqual(PERFORMANCE_THRESHOLDS.mapFrameMs);

  await answerWrong(page);
  await expect(page.getByText('再试一次', { exact: true })).toBeVisible();
  const feedbackMs = await latestDuration(page, 'geo:answer-submitted', 'geo:feedback-visible');
  expect(feedbackMs).not.toBeNull();
  expect(feedbackMs!).toBeLessThanOrEqual(PERFORMANCE_THRESHOLDS.feedbackMs);
  await page.getByRole('listbox').press('Enter');
  await page.keyboard.press('Space');
  await expect(page.getByText('答案已揭示', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '继续' }).click();
  await expect(page.getByRole('button', { name: '检查答案' })).toBeVisible();
  await expect(page.getByRole('button', { name: /开始答题/ })).toBeHidden();
  const transitionMs = await latestDuration(page, 'geo:continue-requested', 'geo:question-ready');
  expect(transitionMs).not.toBeNull();
  expect(transitionMs!).toBeLessThanOrEqual(PERFORMANCE_THRESHOLDS.questionTransitionMs);
  await testInfo.attach('ui-timings.json', {
    body: Buffer.from(JSON.stringify({ coldStartMs, feedbackMs, transitionMs })),
    contentType: 'application/json',
  });
});

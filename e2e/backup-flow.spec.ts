import { expect, test, type Page } from '@playwright/test';
import type { BackupRecords } from '../src/persistence/backup';
import type { PracticeSession } from '../src/practice/session';
import { readE2EState, resetE2E } from './helpers/app';

function session(sessionId: string): PracticeSession {
  return {
    sessionId,
    learnerId: 'local-default',
    request: { mode: 'smart', packId: 'us-states' },
    baseQuestionCount: 1,
    introductions: [],
    introductionCursor: 0,
    questions: [{ kind: 'locate_region', presentation: 'map', entityId: 'us-ak' }],
    questionCursor: 0,
    carryoverRetryDebts: [],
    startedAt: '2026-09-01T00:00:00.000Z',
    accumulatedPauseMs: 0,
  };
}

function records(sessionId: string, packId: 'soft' | 'minimal'): BackupRecords {
  return {
    mastery: [],
    attempts: [],
    sessions: [{ session: session(sessionId), savedAt: '2026-09-01T00:10:00.000Z' }],
    settings: { audio: { enabled: true, packId, volume: 0.25 } },
  };
}

async function setBackup(
  page: Page,
  scenario: Readonly<{
    kind: 'valid';
    records: BackupRecords;
    failRefreshOnce?: boolean;
  }> | Readonly<{ kind: 'corrupt' }>,
): Promise<void> {
  await page.evaluate((value) => window.__GEOLEARN_E2E__.setBackupScenario(value), scenario);
}

async function inspect(page: Page): Promise<void> {
  await page.getByRole('button', { name: '选择备份并检查' }).click();
  await expect(page.getByText('学习者')).toBeVisible();
}

test('exports, merges settings selectively, replaces, and rejects corrupt backups', async ({ page }) => {
  await resetE2E(page);
  await page.getByRole('button', { name: '数据管理' }).click();
  await page.getByRole('button', { name: '导出备份' }).click();
  await expect(page.getByRole('status')).toContainText('空间记忆教练备份.geolearn-backup');

  await setBackup(page, { kind: 'valid', records: records('merged-defaults', 'soft') });
  await inspect(page);
  await page.getByRole('button', { name: '导入备份' }).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入');
  expect((await readE2EState(page)).settings.audio.packId).toBe('crisp');

  await setBackup(page, { kind: 'valid', records: records('merged-settings', 'soft') });
  await inspect(page);
  await page.getByRole('checkbox', { name: '同时导入设置' }).check();
  await page.getByRole('button', { name: '导入备份' }).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入');
  expect((await readE2EState(page)).settings.audio.packId).toBe('soft');

  await setBackup(page, { kind: 'valid', records: records('replacement', 'minimal') });
  await inspect(page);
  await page.getByRole('radio', { name: '完全替换' }).check();
  await page.getByRole('checkbox', { name: '我确认完全替换当前数据' }).check();
  await page.getByRole('button', { name: '导入备份' }).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入');
  const replaced = await readE2EState(page);
  expect(replaced.sessions.map(({ sessionId }) => sessionId)).toEqual(['replacement']);
  expect(replaced.settings.audio.packId).toBe('minimal');

  const beforeCorrupt = await readE2EState(page);
  await setBackup(page, { kind: 'corrupt' });
  await page.getByRole('button', { name: '选择备份并检查' }).click();
  await expect(page.getByRole('alert')).toContainText('备份检查失败，当前数据未更改');
  expect(await readE2EState(page)).toEqual(beforeCorrupt);
});

test('post-import refresh failure locks navigation until retry succeeds', async ({ page }) => {
  await resetE2E(page);
  await page.getByRole('button', { name: '数据管理' }).click();
  await setBackup(page, {
    kind: 'valid',
    records: records('refresh-retry', 'soft'),
    failRefreshOnce: true,
  });
  await inspect(page);
  await page.getByRole('button', { name: '导入备份' }).click();

  await expect(page.getByRole('alert')).toContainText('备份已导入，但学习数据刷新失败');
  await expect(page.getByRole('button', { name: '返回首页' })).toBeDisabled();
  expect((await readE2EState(page)).sessions.map(({ sessionId }) => sessionId)).toEqual([
    'refresh-retry',
  ]);
  await page.getByRole('button', { name: '重试刷新学习数据' }).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入，学习数据已刷新');
  await expect(page.getByRole('button', { name: '返回首页' })).toBeEnabled();
});

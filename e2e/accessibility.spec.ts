import { expect, test, type Locator, type Page } from '@playwright/test';
import type { BackupRecords } from '../src/persistence/backup';
import type { Question } from '../src/learning/questions';
import type { Skill } from '../src/learning/types';
import {
  continueIntroduction,
  openSmartPractice,
  readE2EState,
  resetE2E,
  setQuestionKinds,
} from './helpers/app';

const fiveKinds: readonly Skill[] = [
  'locate_region',
  'identify_region',
  'associate_capital',
  'locate_place',
  'identify_place',
];

async function assertVisibleFocus(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  const focus = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focus.style).not.toBe('none');
  expect(Number.parseFloat(focus.width)).toBeGreaterThan(0);
}

async function focusByKeyboard(page: Page, locator: Locator): Promise<void> {
  for (let index = 0; index < 60; index += 1) {
    if (await locator.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard Tab order did not reach the requested control');
}

async function currentQuestion(page: Page): Promise<Question> {
  const state = await readE2EState(page);
  const session = state.sessions[0];
  const question = session?.questions[session.questionCursor];
  if (question === undefined) throw new Error('Expected a current E2E question');
  return question;
}

async function startControlled(page: Page, title: string, kinds: readonly Skill[]): Promise<void> {
  await setQuestionKinds(page, kinds);
  await openSmartPractice(page, title);
  await page.getByRole('button', { name: '跳过摸底，开始练习' }).click();
  await continueIntroduction(page);
}

async function answerCurrentByKeyboard(page: Page): Promise<void> {
  const question = await currentQuestion(page);
  if (question.presentation === 'map') {
    const map = page.getByRole('listbox');
    await focusByKeyboard(page, map);
    await assertVisibleFocus(map);
    const initial = await map.getAttribute('aria-activedescendant');
    await map.press('ArrowRight');
    expect(await map.getAttribute('aria-activedescendant')).not.toBe(initial);
    await map.press('Enter');
    await expect(page.getByRole('button', { name: '检查答案' })).toBeEnabled();
    await page.keyboard.press('Space');
    await expect(page.getByText('再试一次', { exact: true })).toBeVisible();
    await map.press('Enter');
    await page.keyboard.press('Space');
    await expect(page.getByText('答案已揭示', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /继续|查看总结/ })).toBeEnabled();
    return;
  } else if (question.presentation === 'choice') {
    const choices = page.getByRole('group', { name: '答案选项' }).getByRole('button');
    await focusByKeyboard(page, choices.first());
    await assertVisibleFocus(choices.first());
    await page.getByRole('region', { name: '题目与操作' }).getByRole('heading').focus();
    const correct = question.kind === 'associate_capital'
      ? question.capitalId
      : question.entityId;
    const index = question.candidateEntityIds.indexOf(correct);
    expect(index).toBeGreaterThanOrEqual(0);
    await page.keyboard.press(String(index + 1));
  } else {
    throw new Error('Text questions are covered by the composition test');
  }
  await expect(page.getByRole('button', { name: '检查答案' })).toBeEnabled();
  await page.keyboard.press('Space');
  await expect(page.getByText('答对了', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /继续|查看总结/ })).toBeEnabled();
}

function solidBeijingRecords(): BackupRecords {
  return {
    mastery: [{
      learnerId: 'local-default',
      packId: 'cn-provincial-divisions',
      entityId: 'cn-110000',
      skill: 'identify_region',
      stage: 'solid',
      scheduledIntervalMs: 86_400_000,
      dueAt: '2026-09-02T00:00:00.000Z',
      smoothedResponseMs: 100,
      updatedAt: '2026-09-01T00:00:00.000Z',
    }],
    attempts: [],
    sessions: [],
    settings: { audio: { enabled: true, packId: 'crisp', volume: 0.7 } },
  };
}

async function importSolidBeijing(page: Page): Promise<void> {
  await page.evaluate((records) => window.__GEOLEARN_E2E__.setBackupScenario({
    kind: 'valid',
    records,
  }), solidBeijingRecords());
  await page.getByRole('button', { name: '数据管理' }).click();
  await page.getByRole('button', { name: '选择备份并检查' }).click();
  await page.getByRole('radio', { name: '完全替换' }).check();
  await page.getByRole('checkbox', { name: '我确认完全替换当前数据' }).check();
  await page.getByRole('button', { name: '导入备份' }).click();
  await expect(page.getByRole('status')).toHaveText('备份已导入');
  await page.getByRole('button', { name: '返回首页' }).click();
}

for (const kind of fiveKinds) {
  test(`${kind} supports its documented mouse-free answer route and visible focus`, async ({ page }) => {
    await resetE2E(page);
    await startControlled(page, '美国50州与州府', [kind]);
    if (kind === 'identify_region') {
      await page.getByRole('region', { name: '题目与操作' }).getByRole('heading').focus();
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      await page.keyboard.press('h');
      await expect(page.getByRole('button', { name: /提示/ })).toBeDisabled();
    } else if (kind !== 'associate_capital' &&
      kind !== 'identify_place') {
      await page.keyboard.press('1');
      await expect(page.getByRole('button', { name: '检查答案' })).toBeDisabled();
    }
    await answerCurrentByKeyboard(page);
    expect((await readE2EState(page)).attempts[0]?.questionKind).toBe(kind);
  });
}

test('Space submits text, respects IME and continues without another start', async ({ page }) => {
  await resetE2E(page);
  await importSolidBeijing(page);
  await startControlled(page, '中国省级行政区', ['identify_region', 'identify_region']);
  const input = page.getByLabel('输入答案');
  await input.fill('New');
  await input.press('Shift+Space');
  await expect(input).toHaveValue('New ');
  await input.fill('北京市');
  await input.dispatchEvent('keydown', { key: ' ', code: 'Space', isComposing: true });
  await input.dispatchEvent('keydown', { key: ' ', code: 'Space', repeat: true });
  expect((await readE2EState(page)).attempts).toHaveLength(0);
  await input.press('Space');
  await expect(page.getByText('答对了', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '继续', exact: true })).toBeEnabled();
  await input.press('Space');
  await expect(page.getByText('答对了', { exact: true })).toBeHidden();
  await expect(page.getByText('准备好了', { exact: true })).toBeHidden();
  await expect(page.getByRole('button', { name: '检查答案' })).toBeVisible();
  expect((await readE2EState(page)).attempts).toHaveLength(1);
});

test('IME composition Enter does not submit until composition ends', async ({ page }) => {
  await resetE2E(page);
  await importSolidBeijing(page);
  await startControlled(page, '中国省级行政区', ['identify_region']);
  const input = page.getByLabel('输入答案');
  await input.focus();
  await assertVisibleFocus(input);

  await input.dispatchEvent('compositionstart', { data: '北' });
  await input.fill('北');
  await input.evaluate((element) => element.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    bubbles: true,
    cancelable: true,
    isComposing: true,
  })));
  expect((await readE2EState(page)).attempts).toEqual([]);
  await expect(page.getByText('答对了', { exact: true })).toBeHidden();

  await input.dispatchEvent('compositionend', { data: '北京市' });
  await input.fill('北京市');
  await input.press('Enter');
  await expect(page.getByText('答对了', { exact: true })).toBeVisible();
  expect((await readE2EState(page)).attempts).toHaveLength(1);
});

test('200% zoom completes a map and text question without horizontal document overflow', async ({ page }) => {
  await resetE2E(page);
  await importSolidBeijing(page);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await startControlled(page, '中国省级行政区', ['locate_region', 'identify_region']);
  await answerCurrentByKeyboard(page);
  await page.keyboard.press('Space');
  await continueIntroduction(page);
  const input = page.getByLabel('输入答案');
  await input.fill('北京市');
  await input.press('Enter');
  await expect(page.getByText('答对了', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth ===
    document.documentElement.clientWidth)).toBe(true);
});

test('reduced motion removes map and feedback motion without removing feedback or focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await resetE2E(page);
  await startControlled(page, '美国50州与州府', ['locate_region']);
  await answerCurrentByKeyboard(page);
  await expect(page.getByText('答案已揭示', { exact: true })).toBeVisible();
  const durations = await page.evaluate(() => ({
    map: getComputedStyle(document.querySelector('[data-testid="map-transform"]')!).transitionDuration,
    feedback: getComputedStyle(document.querySelector('.practice-feedback')!).animationDuration,
  }));
  expect(durations.map).toBe('0s');
  expect(durations.feedback).toBe('0s');
  const summary = page.getByRole('button', { name: '查看总结' });
  await summary.focus();
  await assertVisibleFocus(summary);
});

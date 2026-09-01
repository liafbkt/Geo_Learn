import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { DataManagementScreen, type BackupCommands } from './DataManagementScreen';

function commands(overrides: Partial<BackupCommands> = {}): BackupCommands {
  return {
    exportBackup: async () => '学习记录.geolearn-backup',
    inspectBackup: async () => ({
      stagingId: 'stage-1',
      exportedAt: '2026-08-29T08:30:00.000Z',
      learnerId: 'learner-1',
      packVersions: { china: '1.0.0' },
      masteryCount: 20,
      attemptCount: 86,
      sessionCount: 2,
      includesSettings: true,
    }),
    importBackup: async () => undefined,
    ...overrides,
  };
}

describe('DataManagementScreen', () => {
  it('exports by filename, inspects before import, defaults to merge and confirms replace', async () => {
    const imported: unknown[] = [];
    const onImported = vi.fn(async () => undefined);
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({ importBackup: async (input) => { imported.push(input); } })}
        onImported={onImported}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出备份' }));
    expect(await screen.findByText('已导出：学习记录.geolearn-backup')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));
    expect(await screen.findByText('2026/08/29 16:30')).toBeInTheDocument();
    expect(screen.getByText('学习者').nextElementSibling).toHaveTextContent('learner-1');
    expect(screen.getByText('掌握记录').nextElementSibling).toHaveTextContent('20');
    expect(screen.getByText('答题记录').nextElementSibling).toHaveTextContent('86');
    expect(screen.getByText('未完成会话').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByRole('radio', { name: '合并（推荐）' })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: '完全替换' }));
    expect(screen.getByRole('button', { name: '导入备份' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /我确认完全替换/ }));
    fireEvent.click(screen.getByRole('button', { name: '导入备份' }));

    await waitFor(() => expect(imported).toEqual([{
      stagingId: 'stage-1',
      mode: 'replace',
      includeSettings: true,
    }]));
    expect(await screen.findByText('备份已导入')).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledOnce();
  });

  it('does not call the mutating command when file selection is cancelled', async () => {
    let importCount = 0;
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({
          inspectBackup: async () => null,
          importBackup: async () => { importCount += 1; },
        })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '选择备份并检查' })).toBeEnabled());

    expect(importCount).toBe(0);
    expect(screen.queryByRole('button', { name: '导入备份' })).not.toBeInTheDocument();
  });

  it('keeps settings out of the default merge unless the user opts in', async () => {
    const imported: unknown[] = [];
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({ importBackup: async (input) => { imported.push(input); } })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));
    expect(await screen.findByRole('radio', { name: '合并（推荐）' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '同时导入设置' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '导入备份' }));

    await waitFor(() => expect(imported).toEqual([{
      stagingId: 'stage-1',
      mode: 'merge',
      includeSettings: false,
    }]));
  });

  it('clears a previous staged backup when a later inspection is cancelled', async () => {
    let inspections = 0;
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({
          inspectBackup: async () => {
            inspections += 1;
            return inspections === 1 ? await commands().inspectBackup() : null;
          },
        })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));
    expect(await screen.findByRole('button', { name: '导入备份' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '导入备份' })).not.toBeInTheDocument());
  });

  it('discards a consumed staging ID when import fails', async () => {
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({ importBackup: async () => { throw new Error('consumed'); } })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));
    fireEvent.click(await screen.findByRole('button', { name: '导入备份' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请重新选择并检查备份');
    expect(screen.queryByRole('button', { name: '导入备份' })).not.toBeInTheDocument();
  });

  it('distinguishes a committed import from a failed runtime refresh and gates leaving until retry', async () => {
    let refreshes = 0;
    const importBackup = vi.fn(async () => undefined);
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({ importBackup })}
        onImported={async () => {
          refreshes += 1;
          if (refreshes === 1) throw new Error('reload failed');
        }}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择备份并检查' }));
    fireEvent.click(await screen.findByRole('button', { name: '导入备份' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('备份已导入，但学习数据刷新失败');
    expect(screen.getByRole('button', { name: '返回首页' })).toBeDisabled();
    expect(importBackup).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '重试刷新学习数据' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '返回首页' })).toBeEnabled());
    expect(importBackup).toHaveBeenCalledOnce();
    expect(refreshes).toBe(2);
  });

  it('never renders a local path from a command error', async () => {
    render(
      <DataManagementScreen
        learnerId="learner-1"
        commands={commands({
          exportBackup: async () => {
            throw { code: 'export_failed', message: 'C:\\Users\\Kevin\\private.geolearn-backup' };
          },
        })}
        onBack={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导出备份' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('备份未导出，请重试。');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/C:\\Users|private\.geolearn-backup/);
  });
});

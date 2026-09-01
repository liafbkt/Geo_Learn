import { invoke } from '@tauri-apps/api/core';
import { useState } from 'react';

import './product.css';

export type BackupSummary = Readonly<{
  stagingId: string;
  exportedAt: string;
  learnerId: string;
  packVersions: Readonly<Record<string, string>>;
  masteryCount: number;
  attemptCount: number;
  sessionCount: number;
  includesSettings: boolean;
}>;

export type BackupImportInput = Readonly<{
  stagingId: string;
  mode: 'merge' | 'replace';
  includeSettings: boolean;
}>;

export interface BackupCommands {
  exportBackup(learnerId: string): Promise<string | null>;
  inspectBackup(): Promise<BackupSummary | null>;
  importBackup(input: BackupImportInput): Promise<void>;
}

export const tauriBackupCommands: BackupCommands = {
  exportBackup: (learnerId) =>
    invoke<string | null>('choose_and_export_backup', { learnerId }),
  inspectBackup: () => invoke<BackupSummary | null>('choose_and_inspect_backup'),
  importBackup: (input) => invoke<void>('import_staged_backup', input),
};

export type DataManagementScreenProps = Readonly<{
  learnerId: string;
  commands?: BackupCommands;
  onImported?: () => void | Promise<void>;
  onBack: () => void;
}>;

function formattedDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '日期不可用';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(parsed);
}

export function DataManagementScreen({
  learnerId,
  commands = tauriBackupCommands,
  onImported,
  onBack,
}: DataManagementScreenProps) {
  const [busy, setBusy] = useState<'export' | 'inspect' | 'import' | null>(null);
  const [staged, setStaged] = useState<BackupSummary | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [includeSettings, setIncludeSettings] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const exportBackup = async () => {
    setBusy('export');
    setError(null);
    setNotice(null);
    try {
      const filename = await commands.exportBackup(learnerId);
      if (filename !== null) setNotice(`已导出：${filename}`);
    } catch {
      setError('备份未导出，请重试。');
    } finally {
      setBusy(null);
    }
  };

  const inspectBackup = async () => {
    setBusy('inspect');
    setError(null);
    setNotice(null);
    setStaged(null);
    setMode('merge');
    setIncludeSettings(false);
    setReplaceConfirmed(false);
    try {
      const summary = await commands.inspectBackup();
      if (summary !== null) {
        setStaged(summary);
      }
    } catch {
      setError('备份检查失败，当前数据未更改。');
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async () => {
    if (staged === null || (mode === 'replace' && !replaceConfirmed)) return;
    setBusy('import');
    setError(null);
    setNotice(null);
    try {
      await commands.importBackup({
        stagingId: staged.stagingId,
        mode,
        includeSettings: mode === 'replace' || includeSettings,
      });
      setStaged(null);
    } catch {
      setStaged(null);
      setMode('merge');
      setIncludeSettings(false);
      setReplaceConfirmed(false);
      setError('备份未导入，当前数据未更改。请重新选择并检查备份。');
      setBusy(null);
      return;
    }
    try {
      await onImported?.();
      setRefreshFailed(false);
      setNotice('备份已导入');
    } catch {
      setRefreshFailed(true);
      setError('备份已导入，但学习数据刷新失败。请重试刷新后再继续。');
    } finally {
      setBusy(null);
    }
  };

  const retryRefresh = async () => {
    setBusy('import');
    setError(null);
    try {
      await onImported?.();
      setRefreshFailed(false);
      setNotice('备份已导入，学习数据已刷新');
    } catch {
      setError('学习数据仍未刷新，请重试。');
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="product-surface data-management">
      <header className="product-page-header">
        <div>
          <p className="product-kicker">本地学习档案</p>
          <h1>数据管理</h1>
          <p>备份包含学习进度、答题记录、未完成会话和设置。</p>
        </div>
        <button type="button" className="product-button product-button--quiet" disabled={busy !== null || refreshFailed} onClick={onBack}>
          返回首页
        </button>
      </header>

      <section className="data-management__panel" aria-labelledby="export-title">
        <div>
          <p className="product-kicker">导出</p>
          <h2 id="export-title">保存本地备份</h2>
          <p>由系统文件窗口选择保存位置；页面只显示文件名。</p>
        </div>
        <button
          type="button"
          className="product-button product-button--secondary"
          disabled={busy !== null}
          onClick={() => void exportBackup()}
        >
          导出备份
        </button>
      </section>

      <section className="data-management__panel" aria-labelledby="import-title">
        <div>
          <p className="product-kicker">导入</p>
          <h2 id="import-title">先检查，再写入</h2>
          <p>选择文件后只读取并验证；确认导入前不会更改当前数据。</p>
        </div>
        <button
          type="button"
          className="product-button product-button--secondary"
          disabled={busy !== null}
          onClick={() => void inspectBackup()}
        >
          选择备份并检查
        </button>

        {staged === null ? null : (
          <div className="backup-inspection">
            <dl>
              <div><dt>导出时间</dt><dd>{formattedDate(staged.exportedAt)}</dd></div>
              <div><dt>学习者</dt><dd>{staged.learnerId}</dd></div>
              <div><dt>掌握记录</dt><dd>{staged.masteryCount}</dd></div>
              <div><dt>答题记录</dt><dd>{staged.attemptCount}</dd></div>
              <div><dt>未完成会话</dt><dd>{staged.sessionCount}</dd></div>
            </dl>

            <fieldset>
              <legend>导入方式</legend>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'merge'}
                  onChange={() => { setMode('merge'); setReplaceConfirmed(false); }}
                />
                <span>合并（推荐）</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'replace'}
                  onChange={() => { setMode('replace'); setReplaceConfirmed(false); }}
                />
                <span>完全替换</span>
              </label>
            </fieldset>

            <label>
              <input
                type="checkbox"
                checked={mode === 'replace' || includeSettings}
                disabled={!staged.includesSettings || mode === 'replace'}
                onChange={(event) => setIncludeSettings(event.target.checked)}
              />
              <span>同时导入设置</span>
            </label>

            {mode === 'replace' ? (
              <div className="backup-replace-warning">
                <strong>完全替换会覆盖当前学习数据和设置。</strong>
                <label>
                  <input
                    type="checkbox"
                    checked={replaceConfirmed}
                    onChange={(event) => setReplaceConfirmed(event.target.checked)}
                  />
                  <span>我确认完全替换当前数据</span>
                </label>
              </div>
            ) : null}

            <button
              type="button"
              className="product-button product-button--primary"
              disabled={busy !== null || (mode === 'replace' && !replaceConfirmed)}
              onClick={() => void importBackup()}
            >
              导入备份
            </button>
          </div>
        )}
      </section>

      {notice === null ? null : <p role="status" className="product-notice">{notice}</p>}
      {error === null ? null : <p role="alert" className="product-error">{error}</p>}
      {refreshFailed ? <button type="button" className="product-button product-button--primary" disabled={busy !== null} onClick={() => void retryRefresh()}>重试刷新学习数据</button> : null}
    </main>
  );
}

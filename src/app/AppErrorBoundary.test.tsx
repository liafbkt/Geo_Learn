import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

function Broken(): never {
  throw new Error('C:\\Users\\Kevin\\private\\progress.sqlite3');
}

describe('AppErrorBoundary', () => {
  it('offers safe recovery without exposing paths or a stack', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <AppErrorBoundary onRestart={vi.fn()} onExportDiagnostics={vi.fn()}>
        <Broken />
      </AppErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: '应用暂时无法继续' })).toBeVisible();
    expect(screen.getByText(/错误代码：UI-UNEXPECTED/)).toBeVisible();
    expect(screen.getByRole('button', { name: '重新启动' })).toBeVisible();
    expect(screen.getByRole('button', { name: '导出诊断信息' })).toBeVisible();
    expect(document.body).not.toHaveTextContent('Kevin');
    expect(document.body).not.toHaveTextContent('progress.sqlite3');
    expect(document.body).not.toHaveTextContent('at Broken');
  });
});

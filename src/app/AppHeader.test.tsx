import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { AppHeader } from './AppHeader';

describe('AppHeader', () => {
  it('routes data management and exposes the primary navigation', async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    const onDataManagement = vi.fn();

    render(<AppHeader active="learn" onHome={onHome} onDataManagement={onDataManagement} />);

    await user.click(screen.getByRole('button', { name: '数据管理' }));

    expect(onDataManagement).toHaveBeenCalledOnce();
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  });

  it('marks learning as active, keeps future destinations unavailable, and returns home', async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();

    render(<AppHeader active="learn" onHome={onHome} onDataManagement={vi.fn()} />);

    expect(screen.getByRole('link', { name: '学习' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '统计' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '知识库' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '返回首页' }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it('keeps home and data management unavailable while a practice session is active', async () => {
    const user = userEvent.setup();
    const onHome = vi.fn();
    const onDataManagement = vi.fn();

    render(<AppHeader active="practice" onHome={onHome} onDataManagement={onDataManagement} />);

    expect(screen.getByRole('button', { name: '返回首页' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '数据管理' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: '学习' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '返回首页' }));
    await user.click(screen.getByRole('button', { name: '数据管理' }));
    expect(onHome).not.toHaveBeenCalled();
    expect(onDataManagement).not.toHaveBeenCalled();
  });
});

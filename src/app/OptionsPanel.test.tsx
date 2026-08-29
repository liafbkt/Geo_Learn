import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { vi } from 'vitest';
import type { ProgressRepository } from '../persistence/ProgressRepository';
import { OptionsPanel } from './OptionsPanel';

function repository(saveSettings: ProgressRepository['saveSettings']): Pick<ProgressRepository, 'saveSettings'> {
  return { saveSettings };
}

describe('OptionsPanel', () => {
  it('persists an audio change immediately', async () => {
    const saveSettings = vi.fn(async () => undefined);
    const onChange = vi.fn();
    render(
      <StrictMode>
        <OptionsPanel
          value={{ enabled: true, packId: 'crisp', volume: 0.7 }}
          repository={repository(saveSettings)}
          onChange={onChange}
          onPreview={vi.fn()}
          onBack={vi.fn()}
          onSavingChange={vi.fn()}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('radio', { name: '柔和' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      audio: { enabled: true, packId: 'soft', volume: 0.7 },
    }));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, packId: 'soft', volume: 0.7 });
  });

  it('shows a save error and rolls back the optimistic change', async () => {
    const saveSettings = vi.fn(async () => { throw new Error('disk full'); });
    const onChange = vi.fn();
    render(
      <StrictMode>
        <OptionsPanel
          value={{ enabled: true, packId: 'crisp', volume: 0.7 }}
          repository={repository(saveSettings)}
          onChange={onChange}
          onPreview={vi.fn()}
          onBack={vi.fn()}
          onSavingChange={vi.fn()}
        />
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '音效' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('设置未保存');
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, packId: 'crisp', volume: 0.7 });
  });

  it('locks navigation until a deferred save finishes', async () => {
    let finishSave: (() => void) | undefined;
    const saveSettings = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onBack = vi.fn();
    const onSavingChange = vi.fn();
    render(
      <OptionsPanel
        value={{ enabled: true, packId: 'crisp', volume: 0.7 }}
        repository={repository(saveSettings)}
        onChange={vi.fn()}
        onPreview={vi.fn()}
        onBack={onBack}
        onSavingChange={onSavingChange}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '音效' }));
    const back = screen.getByRole('button', { name: '返回暂停' });
    expect(back).toBeDisabled();
    fireEvent.click(back);
    expect(onBack).not.toHaveBeenCalled();
    expect(onSavingChange).toHaveBeenCalledWith(true);

    finishSave?.();
    await waitFor(() => expect(back).toBeEnabled());
    expect(onSavingChange).toHaveBeenLastCalledWith(false);
  });

  it('does not let a rejected save roll back state after the panel unmounts', async () => {
    let rejectSave: ((reason: Error) => void) | undefined;
    const saveSettings = vi.fn(() => new Promise<void>((_resolve, reject) => { rejectSave = reject; }));
    const onChange = vi.fn();
    const view = render(
      <OptionsPanel
        value={{ enabled: true, packId: 'crisp', volume: 0.7 }}
        repository={repository(saveSettings)}
        onChange={onChange}
        onPreview={vi.fn()}
        onBack={vi.fn()}
        onSavingChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '音效' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    view.unmount();
    rejectSave?.(new Error('late disk failure'));
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

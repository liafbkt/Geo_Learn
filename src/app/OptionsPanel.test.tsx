import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      <OptionsPanel
        value={{ enabled: true, packId: 'crisp', volume: 0.7 }}
        repository={repository(saveSettings)}
        onChange={onChange}
        onPreview={vi.fn()}
        onBack={vi.fn()}
      />,
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
      <OptionsPanel
        value={{ enabled: true, packId: 'crisp', volume: 0.7 }}
        repository={repository(saveSettings)}
        onChange={onChange}
        onPreview={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: '音效' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('设置未保存');
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, packId: 'crisp', volume: 0.7 });
  });
});

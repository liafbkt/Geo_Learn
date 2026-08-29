import { useEffect, useRef, useState } from 'react';
import type { ProgressRepository } from '../persistence/ProgressRepository';
import type { AudioSettings, SoundPackId } from './settings';
import { ModalDialog } from './ModalDialog';

type Props = Readonly<{
  value: AudioSettings;
  repository: Pick<ProgressRepository, 'saveSettings'>;
  unavailablePacks?: readonly SoundPackId[];
  onChange: (settings: AudioSettings) => void;
  onPreview: (packId: SoundPackId, volume: number) => void;
  onBack: () => void;
  onSavingChange: (saving: boolean) => void;
}>;

const PACKS: readonly Readonly<{ id: SoundPackId; label: string }>[] = [
  { id: 'crisp', label: '清脆' },
  { id: 'soft', label: '柔和' },
  { id: 'minimal', label: '极简' },
];

export function OptionsPanel({ value, repository, unavailablePacks = [], onChange, onPreview, onBack, onSavingChange }: Props) {
  const [saveError, setSaveError] = useState(false);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const persist = async (next: AudioSettings): Promise<void> => {
    if (savingRef.current) return;
    const previous = value;
    savingRef.current = true;
    onChange(next);
    setSaveError(false);
    setSaving(true);
    onSavingChange(true);
    try {
      await repository.saveSettings({ audio: next });
    } catch {
      if (mounted.current) {
        onChange(previous);
        setSaveError(true);
      }
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
      onSavingChange(false);
    }
  };
  const updatePack = (packId: SoundPackId) => {
    const next = { ...value, packId };
    void persist(next);
    if (next.enabled && !unavailablePacks.includes(packId)) onPreview(packId, next.volume);
  };
  return (
    <ModalDialog labelledBy="options-title" className="options-card">
      <button
        type="button"
        className="text-action"
        disabled={saving}
        onClick={() => { if (!savingRef.current) onBack(); }}
      >
        返回暂停
      </button>
      <h2 id="options-title">选项</h2>
      <label className="toggle-row">
        <span>音效</span>
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={saving}
          onChange={(event) => { void persist({ ...value, enabled: event.currentTarget.checked }); }}
        />
      </label>
      <fieldset disabled={!value.enabled || saving}>
        <legend>音效方案</legend>
        {PACKS.map((pack) => (
          <label key={pack.id} className="radio-row">
            <input
              type="radio"
              name="sound-pack"
              checked={value.packId === pack.id}
              disabled={unavailablePacks.includes(pack.id)}
              onChange={() => updatePack(pack.id)}
            />
            <span>{pack.label}{unavailablePacks.includes(pack.id) ? '（不可用）' : ''}</span>
          </label>
        ))}
      </fieldset>
      <label className="range-row">
        <span>音量 {Math.round(value.volume * 100)}</span>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round(value.volume * 100)}
          disabled={!value.enabled || saving}
          onChange={(event) => { void persist({ ...value, volume: Number(event.currentTarget.value) / 100 }); }}
        />
      </label>
      <p aria-live="polite" className="settings-save-status">
        {saveError ? <span role="alert">设置未保存，请重试。</span> : saving ? '正在保存…' : '设置已保存'}
      </p>
    </ModalDialog>
  );
}

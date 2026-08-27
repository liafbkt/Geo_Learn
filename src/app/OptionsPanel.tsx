import type { AudioSettings, SoundPackId } from './settings';

type Props = Readonly<{
  value: AudioSettings;
  unavailablePacks?: readonly SoundPackId[];
  onChange: (settings: AudioSettings) => void;
  onPreview: (packId: SoundPackId, volume: number) => void;
  onBack: () => void;
}>;

const PACKS: readonly Readonly<{ id: SoundPackId; label: string }>[] = [
  { id: 'crisp', label: '清脆' },
  { id: 'soft', label: '柔和' },
  { id: 'minimal', label: '极简' },
];

export function OptionsPanel({ value, unavailablePacks = [], onChange, onPreview, onBack }: Props) {
  const updatePack = (packId: SoundPackId) => {
    const next = { ...value, packId };
    onChange(next);
    if (next.enabled && !unavailablePacks.includes(packId)) onPreview(packId, next.volume);
  };
  return (
    <div className="app-overlay" role="presentation">
      <section className="options-card" role="dialog" aria-modal="true" aria-labelledby="options-title">
        <button type="button" className="text-action" onClick={onBack}>返回暂停</button>
        <h2 id="options-title">选项</h2>
        <label className="toggle-row">
          <span>音效</span>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.currentTarget.checked })}
          />
        </label>
        <fieldset disabled={!value.enabled}>
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
            disabled={!value.enabled}
            onChange={(event) => onChange({ ...value, volume: Number(event.currentTarget.value) / 100 })}
          />
        </label>
      </section>
    </div>
  );
}

import { useState, type FormEvent } from 'react';

import type { ContentPack, PackCapability } from '../content/types';
import type { MasteryStage } from '../learning/types';
import { validateSessionRequest, type SessionRequest } from './session';
import '../app/product.css';

const skillLabels: Readonly<Record<PackCapability, string>> = {
  locate_region: '地图定位行政区',
  identify_region: '识别行政区',
  associate_capital: '关联首府',
  locate_place: '地图定位地点',
  identify_place: '识别地点',
};

const statusOptions: readonly Readonly<{
  value: MasteryStage | 'fragile';
  label: string;
}>[] = [
  { value: 'new', label: '新内容' },
  { value: 'learning', label: '学习中' },
  { value: 'weak', label: '薄弱' },
  { value: 'familiar', label: '熟悉' },
  { value: 'solid', label: '稳固' },
  { value: 'mastered', label: '已掌握' },
  { value: 'fragile', label: '易忘' },
];

export type CustomPracticeFormProps = Readonly<{
  pack: ContentPack;
  fragileKeys?: readonly string[];
  initialQuestionCount?: number;
  onSubmit: (request: Extract<SessionRequest, { mode: 'custom' }>) => void;
  onCancel?: () => void;
}>;

function toggled<T>(current: readonly T[], value: T, checked: boolean): T[] {
  return checked ? [...current, value] : current.filter((item) => item !== value);
}

function entitySupportsSkill(
  pack: ContentPack,
  entityId: string,
  skill: PackCapability,
): boolean {
  const entity = pack.entities.find((candidate) => candidate.id === entityId);
  if (entity === undefined || (entity.capabilities !== undefined && !entity.capabilities.includes(skill))) {
    return false;
  }
  if (entity.kind === 'region') {
    if (skill === 'locate_region' || skill === 'identify_region') {
      return pack.topologyObjectIds.includes(entity.id);
    }
    return skill === 'associate_capital' && entity.capitalId !== undefined;
  }
  return skill === 'locate_place' || skill === 'identify_place';
}

export function CustomPracticeForm({
  pack,
  fragileKeys = [],
  initialQuestionCount = 12,
  onSubmit,
  onCancel,
}: CustomPracticeFormProps) {
  const [entityIds, setEntityIds] = useState<readonly string[]>([]);
  const [skills, setSkills] = useState<readonly PackCapability[]>([]);
  const [statuses, setStatuses] = useState<readonly (MasteryStage | 'fragile')[]>([]);
  const [questionCountDraft, setQuestionCountDraft] = useState(String(initialQuestionCount));
  const fragileEntities = new Set(fragileKeys.map((key) => key.split('|')[0]));
  const skillHasTarget = (skill: PackCapability, selectedEntityIds = entityIds) =>
    selectedEntityIds.some((entityId) => entitySupportsSkill(pack, entityId, skill));
  const questionCount = Number(questionCountDraft);
  const valid =
    entityIds.length > 0 &&
    skills.length > 0 &&
    skills.every((skill) => skillHasTarget(skill)) &&
    Number.isInteger(questionCount) &&
    questionCountDraft.trim() !== '' &&
    questionCount >= 1 &&
    questionCount <= 50;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!valid) return;
    const request = validateSessionRequest({
      mode: 'custom',
      packId: pack.manifest.packId,
      questionCount,
      entityIds: entityIds as [string, ...string[]],
      skills: skills as [PackCapability, ...PackCapability[]],
      statuses,
    });
    if (request.mode === 'custom') onSubmit(request);
  };

  const changeEntity = (entityId: string, checked: boolean) => {
    const next = toggled(entityIds, entityId, checked);
    setEntityIds(next);
    setSkills((current) => current.filter((skill) => skillHasTarget(skill, next)));
  };

  return (
    <form className="product-surface custom-practice" onSubmit={submit}>
      <header className="product-page-header">
        <div>
          <p className="product-kicker">自定义练习</p>
          <h1>{pack.manifest.title.zh}</h1>
        </div>
      </header>

      <div className="custom-practice__grid">
        <fieldset>
          <legend>地点</legend>
          <div className="product-choice-list">
            {pack.entities.map((entity) => (
              <div className="product-choice-row" key={entity.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={entityIds.includes(entity.id)}
                    onChange={(event) => changeEntity(entity.id, event.target.checked)}
                  />
                  <span>{entity.names.zh} / {entity.names.en}</span>
                </label>
                {fragileEntities.has(entity.id) ? <span className="product-badge">易忘</span> : null}
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>能力</legend>
          <div className="product-choice-list">
            {pack.manifest.capabilities.map((skill) => (
              <label key={skill}>
                <input
                  type="checkbox"
                  checked={skills.includes(skill)}
                  disabled={entityIds.length > 0 && !skillHasTarget(skill)}
                  onChange={(event) =>
                    setSkills((current) => toggled(current, skill, event.target.checked))
                  }
                />
                <span>{skillLabels[skill]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>学习状态</legend>
          <p className="product-help">不选表示包含全部状态。</p>
          <div className="product-choice-list">
            {statusOptions.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={statuses.includes(option.value)}
                  onChange={(event) =>
                    setStatuses((current) => toggled(current, option.value, event.target.checked))
                  }
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <label className="custom-practice__count">
        <span>题量</span>
        <input
          aria-label="题量"
          type="number"
          min={1}
          max={50}
          value={questionCountDraft}
          onChange={(event) => setQuestionCountDraft(event.target.value)}
        />
        <small>1–50 题；自定义练习更新真实掌握度。</small>
      </label>

      <footer className="product-action-row">
        {onCancel === undefined ? null : (
          <button type="button" className="product-button product-button--quiet" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className="product-button product-button--primary" disabled={!valid}>
          开始自定义练习
        </button>
      </footer>
    </form>
  );
}

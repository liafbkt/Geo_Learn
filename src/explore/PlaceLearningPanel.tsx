import type { ContentPack, Entity, PackCapability } from '../content/types';
import type { MasteryRecord, MasteryStage } from '../learning/types';
import { masteryKey } from '../learning/scheduler';
import type { SessionRequest } from '../practice/session';

const skillLabels: Readonly<Record<PackCapability, string>> = {
  locate_region: '地图定位行政区',
  identify_region: '识别行政区',
  associate_capital: '关联首府',
  locate_place: '地图定位地点',
  identify_place: '识别地点',
};

const stageLabels: Readonly<Record<MasteryStage, string>> = {
  new: '新内容',
  learning: '学习中',
  weak: '薄弱',
  familiar: '熟悉',
  solid: '稳固',
  mastered: '已掌握',
};

export function skillsForEntity(pack: ContentPack, entity: Entity): readonly PackCapability[] {
  const declared = entity.capabilities ?? pack.manifest.capabilities;
  return pack.manifest.capabilities.filter((skill) => {
    if (!declared.includes(skill)) return false;
    if (entity.kind === 'region') {
      if (skill === 'locate_region' || skill === 'identify_region') return true;
      return skill === 'associate_capital' && entity.capitalId !== undefined;
    }
    return skill === 'locate_place' || skill === 'identify_place';
  });
}

export type PlaceLearningPanelProps = Readonly<{
  pack: ContentPack;
  entity: Entity;
  masteryRecords: readonly MasteryRecord[];
  fragileKeys: readonly string[];
  onStartPractice: (request: Extract<SessionRequest, { mode: 'custom' }>) => void;
}>;

export function PlaceLearningPanel({
  pack,
  entity,
  masteryRecords,
  fragileKeys,
  onStartPractice,
}: PlaceLearningPanelProps) {
  const entities = new Map(pack.entities.map((item) => [item.id, item] as const));
  const parent = entity.parentId === undefined ? undefined : entities.get(entity.parentId);
  const capital = entity.kind === 'region' && entity.capitalId !== undefined
    ? entities.get(entity.capitalId)
    : undefined;
  const skills = skillsForEntity(pack, entity);
  const records = new Map(
    masteryRecords
      .filter((record) => record.entityId === entity.id)
      .map((record) => [record.skill, record] as const),
  );
  const fragile = new Set(fragileKeys);
  const entityFragile = skills.some((skill) => fragile.has(masteryKey(entity.id, skill)));
  const request: Extract<SessionRequest, { mode: 'custom' }> | null = skills.length === 0
    ? null
    : {
        mode: 'custom',
        packId: pack.manifest.packId,
        questionCount: 12,
        entityIds: [entity.id],
        skills: skills as [PackCapability, ...PackCapability[]],
        statuses: [],
      };

  return (
    <aside className="place-learning-panel" aria-label="地点学习详情">
      <header>
        <p className="product-kicker">{entity.kind === 'region' ? '行政区' : '地点'}</p>
        <h2>{entity.names.zh}</h2>
        <p lang="en">{entity.names.en}</p>
        {entityFragile ? <span className="product-badge product-badge--fragile">易忘</span> : null}
      </header>

      <dl className="place-learning-panel__relations">
        <div>
          <dt>类型</dt>
          <dd>{entity.kind === 'region' ? '行政区' : '地点'}</dd>
        </div>
        <div>
          <dt>父级</dt>
          <dd>{parent === undefined ? '无' : `${parent.names.zh} / ${parent.names.en}`}</dd>
        </div>
        {entity.kind === 'region' ? (
          <div>
            <dt>首府关联</dt>
            <dd>{capital === undefined ? '未设置' : `${capital.names.zh} / ${capital.names.en}`}</dd>
          </div>
        ) : null}
      </dl>

      <section aria-labelledby="skill-status-title">
        <h3 id="skill-status-title">能力状态</h3>
        <ul className="place-learning-panel__skills">
          {skills.map((skill) => {
            const stage = records.get(skill)?.stage ?? 'new';
            const isFragile = fragile.has(masteryKey(entity.id, skill));
            return (
              <li key={skill}>
                <span>{skillLabels[skill]}</span>
                <span>{stageLabels[stage]}</span>
                {isFragile ? <span className="product-badge">易忘</span> : null}
              </li>
            );
          })}
        </ul>
      </section>

      <button
        type="button"
        className="product-button product-button--primary"
        disabled={request === null}
        onClick={() => { if (request !== null) onStartPractice(request); }}
      >
        练习这个地点
      </button>
    </aside>
  );
}

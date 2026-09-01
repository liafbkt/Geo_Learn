import { packCapabilityValues, type PackCapability } from '../content/types';
import type { AttemptEvent, MasteryRecord, MasteryStage, Skill } from '../learning/types';
import type { SessionRequest } from './session';
import '../app/product.css';

const stageOrder: readonly MasteryStage[] = [
  'new',
  'learning',
  'weak',
  'familiar',
  'solid',
  'mastered',
];

function key(entityId: string, skill: Skill): string {
  return `${entityId}|${skill}`;
}

function isSkill(value: string | undefined): value is Skill {
  return value !== undefined && packCapabilityValues.includes(value as PackCapability);
}

export type SessionMetrics = Readonly<{
  correctRate: number;
  independentCorrect: number;
  hints: number;
  newEntities: number;
  masteryRaised: number;
  masteryLowered: number;
  fragileAdded: number;
  fragileCleared: number;
}>;

export function summarizeSession(input: Readonly<{
  attempts: readonly AttemptEvent[];
  masteryBefore: readonly MasteryRecord[];
  masteryAfter: readonly MasteryRecord[];
  introducedEntityIds: readonly string[];
  fragileKeysBefore: readonly string[];
  fragileKeysAfter: readonly string[];
}>): SessionMetrics {
  const before = new Map(input.masteryBefore.map((record) => [key(record.entityId, record.skill), record]));
  let masteryRaised = 0;
  let masteryLowered = 0;
  for (const record of input.masteryAfter) {
    const previous = before.get(key(record.entityId, record.skill));
    const previousRank = previous === undefined ? 0 : stageOrder.indexOf(previous.stage);
    const nextRank = stageOrder.indexOf(record.stage);
    if (nextRank > previousRank) masteryRaised += 1;
    if (previous !== undefined && nextRank < previousRank) masteryLowered += 1;
  }
  const fragileBefore = new Set(input.fragileKeysBefore);
  const fragileAfter = new Set(input.fragileKeysAfter);
  const correct = input.attempts.filter((event) => event.correct).length;

  return {
    correctRate: input.attempts.length === 0 ? 0 : Math.round((correct / input.attempts.length) * 100),
    independentCorrect: input.attempts.filter((event) => event.independentCorrect).length,
    hints: input.attempts.filter((event) => event.usedHint).length,
    newEntities: new Set(input.introducedEntityIds).size,
    masteryRaised,
    masteryLowered,
    fragileAdded: [...fragileAfter].filter((item) => !fragileBefore.has(item)).length,
    fragileCleared: [...fragileBefore].filter((item) => !fragileAfter.has(item)).length,
  };
}

export type SessionSummaryProps = Readonly<{
  packId: string;
  attempts: readonly AttemptEvent[];
  masteryBefore: readonly MasteryRecord[];
  masteryAfter: readonly MasteryRecord[];
  introducedEntityIds: readonly string[];
  fragileKeysBefore: readonly string[];
  fragileKeysAfter: readonly string[];
  onPracticeWeaknesses: (request: Extract<SessionRequest, { mode: 'custom' }>) => void;
  onHome: () => void;
}>;

function weaknessRequest(props: SessionSummaryProps): Extract<SessionRequest, { mode: 'custom' }> | null {
  const pairs = new Map<string, Readonly<{ entityId: string; skill: Skill }>>();
  const beforeFragile = new Set(props.fragileKeysBefore);
  for (const fragileKey of props.fragileKeysAfter) {
    if (beforeFragile.has(fragileKey)) continue;
    const [entityId = '', skill] = fragileKey.split('|');
    if (entityId !== '' && isSkill(skill)) {
      pairs.set(fragileKey, { entityId, skill });
    }
  }
  for (const event of props.attempts) {
    if (!event.correct) pairs.set(key(event.entityId, event.skill), event);
  }
  if (pairs.size === 0) return null;

  const selected = [...pairs.values()][0]!;
  const after = new Map(props.masteryAfter.map((record) => [key(record.entityId, record.skill), record]));
  const statuses = new Set<MasteryStage | 'fragile'>();
  const stage = after.get(key(selected.entityId, selected.skill))?.stage;
  if (stage !== undefined) statuses.add(stage);
  if (props.fragileKeysAfter.includes(key(selected.entityId, selected.skill))) statuses.add('fragile');

  return {
    mode: 'custom',
    packId: props.packId,
    questionCount: 12,
    entityIds: [selected.entityId],
    skills: [selected.skill],
    statuses: [...statuses],
  };
}

export function SessionSummary(props: SessionSummaryProps) {
  const metrics = summarizeSession(props);
  const request = weaknessRequest(props);

  return (
    <main className="product-surface session-summary">
      <header className="session-summary__header">
        <p className="product-kicker">本次航程完成</p>
        <h1>练习总结</h1>
        <p>看看这次回忆留下了哪些变化。</p>
      </header>

      <dl className="session-summary__metrics">
        <div><dt>答对率</dt><dd>{metrics.correctRate}%</dd></div>
        <div><dt>独立正确</dt><dd>{metrics.independentCorrect}</dd></div>
        <div><dt>使用提示</dt><dd>{metrics.hints}</dd></div>
        <div><dt>新认识地点</dt><dd>{metrics.newEntities}</dd></div>
        <div><dt>掌握提升</dt><dd>{metrics.masteryRaised}</dd></div>
        <div><dt>掌握回落</dt><dd>{metrics.masteryLowered}</dd></div>
        <div><dt>新增易忘</dt><dd>{metrics.fragileAdded}</dd></div>
        <div><dt>解除易忘</dt><dd>{metrics.fragileCleared}</dd></div>
      </dl>

      <footer className="product-action-row">
        <button type="button" className="product-button product-button--quiet" onClick={props.onHome}>
          返回主菜单
        </button>
        <button
          type="button"
          className="product-button product-button--primary"
          disabled={request === null}
          onClick={() => { if (request !== null) props.onPracticeWeaknesses(request); }}
        >
          再练薄弱项
        </button>
      </footer>
    </main>
  );
}

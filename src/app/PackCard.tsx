import type { LocalizedName } from '../content/types';
import type { PracticeSession } from '../practice/session';

export type PackCardViewModel = Readonly<{
  packId: string;
  title: LocalizedName;
  overallMastery: number;
  dueCount: number;
  fragileCount: number;
  resumableSession: PracticeSession | null;
}>;

export type PackCardProps = Readonly<{
  pack: PackCardViewModel;
  onResume: (session: PracticeSession) => void;
  onStartSmart: (packId: string) => void;
  onStartCustom: (packId: string) => void;
  onExplore: (packId: string) => void;
}>;

function percent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function silhouetteVariant(packId: string): 'china' | 'shanghai' | 'us' | undefined {
  if (packId === 'cn-provincial-divisions') return 'china';
  if (packId === 'cn-shanghai-districts') return 'shanghai';
  if (packId === 'us-states') return 'us';
  return undefined;
}

export function PackCard({
  pack,
  onResume,
  onStartSmart,
  onStartCustom,
  onExplore,
}: PackCardProps) {
  const headingId = `pack-${pack.packId}-title`;
  const mastery = percent(pack.overallMastery);
  const variant = silhouetteVariant(pack.packId);

  return (
    <article
      className="pack-card"
      data-pack-id={pack.packId}
      data-pack-variant={variant}
      aria-labelledby={headingId}
    >
      <header className="pack-card__header">
        <p className="product-kicker">学习区域</p>
        <h2 id={headingId}>{pack.title.zh}</h2>
        <p lang="en">{pack.title.en}</p>
      </header>

      <div className="pack-card__mastery">
        <span>总掌握度 {mastery}%</span>
        <progress aria-label={`${pack.title.zh}总掌握度`} max={100} value={mastery} />
      </div>

      <dl className="pack-card__signals">
        <div>
          <dt>待复习</dt>
          <dd>{pack.dueCount}</dd>
        </div>
        <div>
          <dt>易忘</dt>
          <dd>{pack.fragileCount}</dd>
        </div>
      </dl>

      <div className="pack-card__actions">
        {pack.resumableSession === null ? null : (
          <button
            type="button"
            className="product-button product-button--primary pack-card__continue"
            data-priority="primary"
            onClick={() => onResume(pack.resumableSession!)}
          >
            继续上次练习
          </button>
        )}
        <button
          type="button"
          className={
            pack.resumableSession === null
              ? 'product-button product-button--primary'
              : 'product-button product-button--secondary'
          }
          data-priority={pack.resumableSession === null ? 'primary' : 'secondary'}
          onClick={() => onStartSmart(pack.packId)}
        >
          智能练习
        </button>
        <button
          type="button"
          className="product-button product-button--quiet"
          onClick={() => onStartCustom(pack.packId)}
        >
          自定义练习
        </button>
        <button
          type="button"
          className="product-button product-button--quiet"
          onClick={() => onExplore(pack.packId)}
        >
          探索地图
        </button>
      </div>
    </article>
  );
}

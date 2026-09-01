import { useMemo, useState } from 'react';

import type { ContentPack } from '../content/types';
import type { MasteryRecord } from '../learning/types';
import { MapViewport } from '../map/MapViewport';
import type { MapSelection, ProjectedMap } from '../map/types';
import type { SessionRequest } from '../practice/session';
import { PlaceLearningPanel } from './PlaceLearningPanel';
import '../app/product.css';

export type ExploreScreenProps = Readonly<{
  pack: ContentPack;
  map: ProjectedMap;
  masteryRecords: readonly MasteryRecord[];
  fragileKeys: readonly string[];
  onStartPractice: (request: Extract<SessionRequest, { mode: 'custom' }>) => void;
  onBack: () => void;
}>;

export function ExploreScreen({
  pack,
  map,
  masteryRecords,
  fragileKeys,
  onStartPractice,
  onBack,
}: ExploreScreenProps) {
  const [selection, setSelection] = useState<MapSelection | null>(null);
  const [showHydrography, setShowHydrography] = useState(map.hydroPaths.length > 0);
  const entities = useMemo(
    () => new Map(pack.entities.map((entity) => [entity.id, entity] as const)),
    [pack.entities],
  );
  const selectedEntity = selection === null ? undefined : entities.get(selection.entityId);
  const fragileEntityIds = useMemo(
    () => [...new Set(fragileKeys.map((item) => item.split('|')[0]))]
      .filter((entityId): entityId is string => entityId !== undefined && entities.has(entityId)),
    [entities, fragileKeys],
  );

  return (
    <main
      className={
        showHydrography
          ? 'product-surface explore-screen'
          : 'product-surface explore-screen explore-screen--hydro-hidden'
      }
    >
      <header className="product-page-header explore-screen__header">
        <div>
          <p className="product-kicker">自由查阅 · 不写入成绩</p>
          <h1>{pack.manifest.title.zh}</h1>
          <p>探索模式不计分</p>
        </div>
        <div className="explore-screen__tools">
          <label>
            <input
              type="checkbox"
              checked={showHydrography}
              disabled={map.hydroPaths.length === 0}
              onChange={(event) => setShowHydrography(event.target.checked)}
            />
            <span>显示水系</span>
          </label>
          <button type="button" className="product-button product-button--quiet" onClick={onBack}>
            返回首页
          </button>
        </div>
      </header>

      <div className="explore-screen__workspace">
        <section className="explore-screen__map" aria-label="探索地图">
          <MapViewport
            pack={pack}
            map={map}
            mode="explore"
            selection={selection}
            onRegionSelect={(entityId) => setSelection({ kind: 'region', entityId })}
            onPlaceSelect={(entityId) => setSelection({ kind: 'place', entityId })}
          />
          <nav className="explore-screen__fragile-index" aria-label="易忘地点索引">
            <span>易忘地点 {fragileEntityIds.length}</span>
            {fragileEntityIds.map((entityId) => {
              const entity = entities.get(entityId)!;
              return (
                <button
                  type="button"
                  key={entityId}
                  aria-label={`查看易忘地点：${entity.names.zh} / ${entity.names.en}`}
                  onClick={() => setSelection({ kind: entity.kind, entityId })}
                >
                  {entity.names.zh} · {entity.names.en}
                </button>
              );
            })}
          </nav>
        </section>

        {selectedEntity === undefined ? (
          <aside className="place-learning-panel place-learning-panel--empty">
            <p className="product-kicker">地点详情</p>
            <h2>选择地图上的地点</h2>
            <p>查看双语名称、关联和每项能力的学习状态。</p>
          </aside>
        ) : (
          <PlaceLearningPanel
            pack={pack}
            entity={selectedEntity}
            masteryRecords={masteryRecords}
            fragileKeys={fragileKeys}
            onStartPractice={onStartPractice}
          />
        )}
      </div>
    </main>
  );
}

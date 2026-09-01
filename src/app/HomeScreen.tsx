import { PackCard, type PackCardViewModel } from './PackCard';
import type { PracticeSession } from '../practice/session';
import './product.css';

export type HomeScreenProps = Readonly<{
  packs: readonly PackCardViewModel[];
  onResume: (session: PracticeSession) => void;
  onStartSmart: (packId: string) => void;
  onStartCustom: (packId: string) => void;
  onExplore: (packId: string) => void;
  onOpenDataManagement: () => void;
}>;

export function HomeScreen({
  packs,
  onResume,
  onStartSmart,
  onStartCustom,
  onExplore,
  onOpenDataManagement,
}: HomeScreenProps) {
  return (
    <main className="product-surface home-screen">
      <header className="home-screen__masthead">
        <div>
          <p className="product-kicker">空间记忆教练 · 地图台</p>
          <h1>选择学习范围</h1>
          <p>从待复习和易忘能力开始，或者打开地图自由探索。</p>
        </div>
        <button
          type="button"
          className="product-button product-button--secondary"
          onClick={onOpenDataManagement}
        >
          数据管理
        </button>
      </header>

      <section className="home-screen__packs" aria-label="学习内容包">
        {packs.map((pack) => (
          <PackCard
            key={pack.packId}
            pack={pack}
            onResume={onResume}
            onStartSmart={onStartSmart}
            onStartCustom={onStartCustom}
            onExplore={onExplore}
          />
        ))}
      </section>
    </main>
  );
}

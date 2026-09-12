export type AppHeaderProps = Readonly<{
  active: 'learn' | 'practice';
  onHome: () => void;
  onDataManagement: () => void;
}>;

function HomeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10Z" />
    </svg>
  );
}

function LearnIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 5h11a4 4 0 0 1 4 4v10H8a4 4 0 0 0-4 1V5Z" />
      <path d="M8 9h7M8 13h5" />
    </svg>
  );
}

function PracticeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <path d="m9 12 2 2 4-5" />
    </svg>
  );
}

export function AppHeader({ active, onHome, onDataManagement }: AppHeaderProps) {
  return (
    <header className="app-header">
      <nav aria-label="主导航">
        <button className="app-header__home" type="button" aria-label="返回首页" onClick={onHome}>
          <HomeIcon />
        </button>
        <a className={active === 'learn' ? 'app-header__item app-header__item--active' : 'app-header__item'} aria-current={active === 'learn' ? 'page' : undefined} href="#learn" onClick={(event) => { event.preventDefault(); onHome(); }}>
          <LearnIcon />学习
        </a>
        <span className={active === 'practice' ? 'app-header__item app-header__item--active' : 'app-header__item'} aria-current={active === 'practice' ? 'page' : undefined}>
          <PracticeIcon />练习
        </span>
        <button className="app-header__item" type="button" disabled>统计</button>
        <button className="app-header__item" type="button" disabled>知识库</button>
        <span className="app-header__spacer" />
        <button className="app-header__data" type="button" onClick={onDataManagement}>数据管理</button>
      </nav>
    </header>
  );
}

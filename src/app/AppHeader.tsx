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

function BrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 28s9-7.3 9-15a9 9 0 1 0-18 0c0 7.7 9 15 9 15Z" />
      <path d="M12 16v-4l4-3 4 3v4m-10 0h12m-10 0v5m4-5v5m4-5v5" />
    </svg>
  );
}

export function AppHeader({ active, onHome, onDataManagement }: AppHeaderProps) {
  const practiceActive = active === 'practice';
  return (
    <header className="app-header">
      <nav aria-label="主导航">
        <span className="app-header__brand" aria-label="中国地理小课堂"><BrandIcon /><strong>中国地理小课堂</strong></span>
        <button className="app-header__home" type="button" aria-label="返回首页" disabled={practiceActive} onClick={onHome}>
          <HomeIcon />
        </button>
        {practiceActive
          ? <span className="app-header__item"><LearnIcon />学习</span>
          : <a className="app-header__item app-header__item--active" aria-current="page" href="#learn" onClick={(event) => { event.preventDefault(); onHome(); }}><LearnIcon />学习</a>}
        <span className={active === 'practice' ? 'app-header__item app-header__item--active' : 'app-header__item'} aria-current={active === 'practice' ? 'page' : undefined}>
          <PracticeIcon />练习
        </span>
        <button className="app-header__item" type="button" disabled>统计</button>
        <button className="app-header__item" type="button" disabled>知识库</button>
        <span className="app-header__spacer" />
        <button className="app-header__data" type="button" disabled={practiceActive} onClick={onDataManagement}>数据管理</button>
      </nav>
    </header>
  );
}

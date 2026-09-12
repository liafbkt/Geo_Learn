# 地图学习 UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有离线地图学习应用重构为设计图中的课堂式首页与卡式练习页，并保持真实学习行为。

**Architecture:** 新增可复用的应用导航和本地背景资源；首页卡片与练习布局消费现有 view model、路由和地图组件。视觉状态只在 React/CSS 层实现，学习调度、SQLite 和地图投影接口不改变。

**Tech Stack:** React 19、TypeScript、CSS、Vite、Vitest、Playwright、Tauri 2。

## Global Constraints

- 不添加网络依赖、在线字体、地图瓦片或第三方图标库。
- 不修改学习 reducer、持久化 DTO、地图几何或投影选择。
- 所有新增交互先有失败测试，并保留键盘、IME、焦点和 reduced-motion 行为。
- 当前工作树已有用户改动；UI 改动必须建立在这些改动之上。

---

### Task 1: 本地背景与应用导航

**Files:**
- Create: `src/assets/geography-background.png`
- Create: `src/app/AppHeader.tsx`
- Create: `src/app/AppHeader.test.tsx`
- Modify: `src/ui/tokens.css`
- Modify: `src/ui/global.css`
- Modify: `src/app/App.tsx`

**Interfaces:**
- Consumes: `App` 的当前路由与 `onHome`、`onDataManagement` 回调。
- Produces: `AppHeader({ active: 'learn' | 'practice', onHome, onDataManagement })`。

- [ ] **Step 1: Write the failing navigation test**

```tsx
render(<AppHeader active="learn" onHome={onHome} onDataManagement={onData} />);
await user.click(screen.getByRole('button', { name: '数据管理' }));
expect(onData).toHaveBeenCalledOnce();
expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/app/AppHeader.test.tsx`
Expected: FAIL because `AppHeader` does not exist.

- [ ] **Step 3: Add the minimal header, local image import, token and global background layer**

```tsx
export function AppHeader({ active, onHome, onDataManagement }: Props) {
  return <header className="app-header"><nav aria-label="主导航">…</nav></header>;
}
```

- [ ] **Step 4: Run the navigation test**

Run: `node node_modules/vitest/vitest.mjs run src/app/AppHeader.test.tsx`
Expected: PASS.

### Task 2: 首页卡片与已有入口

**Files:**
- Modify: `src/app/HomeScreen.tsx`
- Modify: `src/app/PackCard.tsx`
- Modify: `src/app/HomeScreen.test.tsx`
- Modify: `src/app/product.css`

**Interfaces:**
- Consumes: 现有 `PackCardViewModel`、继续练习、智能练习、自定义练习、探索地图和数据管理回调。
- Produces: 在桌面三列与窄屏单列中均可用的首页。

- [ ] **Step 1: Write failing tests for visible data and existing actions**

```tsx
expect(screen.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
await user.click(screen.getByRole('button', { name: '探索地图' }));
expect(onExplore).toHaveBeenCalledWith('cn-provincial-divisions');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run src/app/HomeScreen.test.tsx`
Expected: FAIL while the new heading or card action is absent.

- [ ] **Step 3: Implement the card composition and responsive CSS**

```tsx
<section className="home-screen__packs" aria-label="学习内容包">
  {packs.map((pack) => <PackCard key={pack.packId} pack={pack} … />)}
</section>
```

- [ ] **Step 4: Run the home tests**

Run: `node node_modules/vitest/vitest.mjs run src/app/HomeScreen.test.tsx`
Expected: PASS.

### Task 3: 卡式练习布局与地图控制

**Files:**
- Modify: `src/practice/PracticeScreen.tsx`
- Modify: `src/practice/PracticeScreen.test.tsx`
- Modify: `src/map/MapViewport.tsx`
- Modify: `src/map/MapViewport.test.tsx`
- Modify: `src/app/product.css`
- Modify: `src/map/map.css`

**Interfaces:**
- Consumes: `PracticeScreenProps`、`MapViewportProps` 与现有 reducer 状态。
- Produces: 保留进度语义的底部进度条，以及 `MapViewport` 的放大、缩小和复位按钮。

- [ ] **Step 1: Write failing tests for visible progress and map controls**

```tsx
expect(screen.getByRole('status', { name: '答题进度' })).toHaveTextContent('1 / 12');
expect(screen.getByRole('button', { name: '放大地图' })).toBeEnabled();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run src/practice/PracticeScreen.test.tsx src/map/MapViewport.test.tsx`
Expected: FAIL because the requested visible control or progress presentation is absent.

- [ ] **Step 3: Implement the minimal shared layout**

```tsx
<div className="practice-progress" role="status" aria-label="答题进度">
  <strong>{questionNumber} / {state.session.questions.length}</strong>
  <progress max={state.session.questions.length} value={questionNumber} />
</div>
```

- [ ] **Step 4: Run the focused practice and map tests**

Run: `node node_modules/vitest/vitest.mjs run src/practice/PracticeScreen.test.tsx src/map/MapViewport.test.tsx`
Expected: PASS.

### Task 4: 浏览器视觉与回归验证

**Files:**
- Modify: `e2e/navigation-flow.spec.ts`
- Modify: `e2e/practice-flow.spec.ts`

**Interfaces:**
- Consumes: 已有 e2e 依赖与真实页面交互。
- Produces: 宽屏、窄屏和完整练习流程的回归证据。

- [ ] **Step 1: Add a failing browser assertion for the visible home navigation**

```ts
await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible();
await expect(page.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
```

- [ ] **Step 2: Run it to verify the failing assertion**

Run: `node node_modules/@playwright/test/cli.js test e2e/navigation-flow.spec.ts --workers=1 --timeout=60000`
Expected: FAIL before the new header is rendered.

- [ ] **Step 3: Validate desktop and narrow layouts with screenshots**

```ts
await page.setViewportSize({ width: 1672, height: 941 });
await expect(page).toHaveScreenshot('home-desktop.png');
await page.setViewportSize({ width: 390, height: 844 });
await expect(page.getByRole('main')).toBeVisible();
```

- [ ] **Step 4: Run focused e2e, typecheck, lint and build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: exit code 0; report native Tauri validation separately if MSVC remains unavailable.

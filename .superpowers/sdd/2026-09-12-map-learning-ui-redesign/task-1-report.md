# Task 1: 本地背景与应用导航

## Implemented scope

- Copied the provided `C:\Users\Kevin\Downloads\地图学习背景图.png` to `src/assets/geography-background.png`, where Vite emits it as a local application asset.
- Added `AppHeader` with the required `active`, `onHome`, and `onDataManagement` contract. The header provides a labelled primary navigation, original inline SVG home/learning/practice icons, an active learning or practice item, disabled `统计` and `知识库` items, and a `数据管理` action.
- Mounted the header in `App` and route its home and data-management actions through the existing application route state. The learning reducer, persistence contracts, map geometry, and projection logic were not changed.
- Added the background layer and readable translucent page treatment in `src/ui/global.css`; the background has no animation, and the existing reduced-motion token override remains in effect.

## TDD evidence

1. Added `src/app/AppHeader.test.tsx` before `AppHeader.tsx` existed. The test covers the user-visible navigation label and the data-management callback, plus the active learning item, disabled future destinations, and home callback.
2. Red command: `node node_modules/vitest/vitest.mjs run src/app/AppHeader.test.tsx`.
3. Expected red result: the test suite could not resolve `./AppHeader`, because `src/app/AppHeader.tsx` did not exist.
4. Added the smallest component and styles that satisfy that contract.
5. Green command: `node node_modules/vitest/vitest.mjs run src/app/AppHeader.test.tsx`.
6. Green result: 1 test file passed; 2 tests passed.

## Additional verification

- `pnpm typecheck` passed.
- `pnpm build` passed and emitted `dist/assets/geography-background-CGCDFB9k.png`, confirming Vite bundled the local image.
- `git diff --check` passed. Git reported only line-ending normalization warnings for existing modified task files.

## Build repair note

The first production build identified an extra closing brace at `src/ui/global.css:111` in this task's newly added header CSS. Removing that single brace restored CSS parsing; the focused test and production build both passed after the repair.

## Practice navigation guard fix

Review identified that the header previously passed home and data-management callbacks through while `active="practice"`, allowing those controls to unmount `PracticeScreen` during a save and bypass its existing `canLeavePractice`/pause guard.

- The header now disables `返回首页` and `数据管理` during active practice, and renders `学习` as non-interactive text in that state, so no header route can leave an active session.
- Added the regression test `keeps home and data management unavailable while a practice session is active`. It asserts the two buttons are disabled, learning is no longer a link, and clicks cannot invoke either route callback.
- Red command: `node node_modules/vitest/vitest.mjs run src/app/AppHeader.test.tsx`; expected failure: `返回首页` was not disabled.
- Green result: the focused suite passed 3 tests. `pnpm typecheck` also passed.

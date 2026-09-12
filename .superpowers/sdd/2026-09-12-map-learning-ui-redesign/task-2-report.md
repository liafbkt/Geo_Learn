# Task 2 report

## Scope

- Added `data-pack-id` to each home content card so CSS can select a local decorative silhouette.
- Replaced the generic card corner circle with CSS-only silhouettes for the default, Shanghai, and US pack IDs.
- Extended the home screen regression test to protect the pack ID marker and verify that the China card's `探索地图` action passes `china` to the existing callback.

## TDD evidence

1. Before implementation, `node node_modules/vitest/vitest.mjs run src/app/HomeScreen.test.tsx` failed with `Expected data-pack-id="china"; Received: null`.
2. After the minimal implementation, the same command passed: 1 test file, 5 tests.

## Preserved contracts

- `AppHeader` was not changed.
- Resume still receives the existing session; smart, custom, and explore still receive `pack.packId`; data management remains on its existing callback.
- No content data, dependencies, network requests, map geometry, persistence, reducer, or application wiring changed.

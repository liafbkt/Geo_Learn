# Windows v1 当前用户烟测记录

> 这里记录实际观察，不以 bare checkbox 代替证据。每项完成时必须写入时间、结果、操作和可见现象；失败必须保留并关联修复与新候选版本。

## Witness environment

- Witness: current Windows user
- OS: Windows 10 Home 22H2 x64, build 19045
- Windows account: existing daily-use account
- Fresh OS: no
- Windows 11: not tested
- Missing WebView2: not forced on the daily-use machine
- Candidate version/hash: pending
- Stable version/hash: pending
- Display scaling: pending
- Reduced-motion setting: pending
- WebView2 runtime state/version: pending

## Candidate observations

| ID | Procedure | Result | Timestamp and observation |
| --- | --- | --- | --- |
| SMOKE-C-01 | Download the tag-specific candidate and verify all asset hashes | pending | — |
| SMOKE-C-02 | Back up any existing application data before installer/data-changing work | pending | — |
| SMOKE-C-03 | Run the NSIS current-user installation and record WebView2 handling | pending | — |
| SMOKE-C-04 | First launch shows the Simplified Chinese home screen | pending | — |
| SMOKE-C-05 | Confirm `progress.sqlite3` is created in the native application-data location | pending | — |
| SMOKE-C-06 | Complete home → placement/smart → introduction → first wrong → hint → reveal → delayed retest → summary | pending | — |
| SMOKE-C-07 | Complete custom practice and explore-to-focused practice | pending | — |
| SMOKE-C-08 | Verify practice → Esc pause → options → Esc pause → Esc practice and focus return | pending | — |
| SMOKE-C-09 | Exercise all five question types by keyboard with visible focus | pending | — |
| SMOKE-C-10 | Enter Chinese with the real IME and confirm composition does not submit early | pending | — |
| SMOKE-C-11 | Exercise the app at 200% display scaling and record reduced-motion behavior | pending | — |
| SMOKE-C-12 | Close with an unfinished session, restart the process, and resume the same session | pending | — |
| SMOKE-C-13 | Export a native backup; inspect/import merge and replace; reject a corrupt backup without mutation | pending | — |
| SMOKE-C-14 | Disable public network access, restart, complete core learning, and confirm only explicit update check fails | pending | — |
| SMOKE-C-15 | Record native cold-start/feedback/transition/map timings, then uninstall/reinstall after backup and observe data behavior | pending | — |

Forced save-failure injection is covered by automated browser/Rust tests and is not performed by damaging or locking the current user's real SQLite database. During SMOKE-C-06..15, record any naturally observed save gate/retry behavior.

## Candidate-to-stable update observations

| ID | Procedure | Result | Timestamp and observation |
| --- | --- | --- | --- |
| SMOKE-U-01 | From the installed candidate, explicitly check `latest.json` and detect `0.1.0` | pending | — |
| SMOKE-U-02 | Observe update download progress | pending | — |
| SMOKE-U-03 | Observe the UI report that the download passed signature verification | pending | — |
| SMOKE-U-04 | Launch the passive updater installer and complete installation | pending | — |
| SMOKE-U-05 | Launch the final app and verify displayed version `0.1.0` | pending | — |
| SMOKE-U-06 | Verify progress, settings, resumable state, SQLite, and backup behavior remain intact | pending | — |
| SMOKE-U-07 | Audit stable Release/latest URLs, four assets, signature relationship, hashes, and direct downloads | pending | — |
| SMOKE-U-08 | After a fresh backup, uninstall/reinstall final and record observed application-data behavior | pending | — |

## Failures, repairs, and retests

| Timestamp | Version | Step | Observation | Repair / next immutable candidate | Retest |
| --- | --- | --- | --- | --- | --- |
| none yet | — | — | — | — | — |


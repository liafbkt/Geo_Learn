# 美国地图资源落地核验（2026-08-31）

结论：**数据层已可用于教学开发，默认鼠标交互仍待适配。** 本次沿用已经下载并转换的美国资源，没有必要再寻找高精度 GIS。没有移动州府、删除阿拉斯加岛屿、伪造州界，也没有修改应用 React、Rust、schema、转换器或依赖。

后续“补充齐全”收尾已补入自动来源核验、验证临时文件清理，以及可重建检查页模板。当前专项测试为 **11 项**；下文 9 项及原始点击记录保留为此前实测历史。新增报告为 `completion-vitest.json`，四个运行时文件仍保持原哈希。

四个运行时文件位于 `../../`：`manifest.json`、`entities.json`、`map.topojson`、`sources.json`。版本仍为 `1.0.0-dev.1`，状态 `development-only`，主答案语言 `en`。本次仅补充测试及证据，四个文件字节与原版本一致。

## 数据及出题

- 50 州 + 50 州府，稳定 ID、中英文名称、美国邮政缩写、有效别名和双向州—州府关系齐备。
- 州界使用 Census 2025 小比例尺 KML；州府关系来自 GPO；州府点来自 Census 2025 Gazetteer。州府点是市域代表点，不冒充州议会建筑位置。原文件、下载 URL、使用说明、哈希及处理链见[来源说明](../README.md)和[逐点审计](../points-audit.json)。
- 50 个州府均通过“点在父州内”验证。独立只读复核：50 州、126 个环、13,547 个顶点完整对应固定原始 KML（仅反转环方向）；50 个点的原始 Gazetteer 行及转换结果完全对应；5 个原始来源文件哈希匹配。
- 9 项美国专项回归通过；生成并检查 **500** 个问题：200 地图定位题、150 选择题、150 文本题。核对阶段呈现、正确答案、四选项类型、英文大小写/空格、中文和别名接受，以及空答案/无关文本拒绝。
- 两次转换、两次完整校验均通过，四文件哈希一致。另跑现有基线：24 个测试文件、290 项测试通过；三套 TypeScript 检查和本次测试文件 ESLint 通过。
- 美国专项命令明确跳过另外两包的 13 项测试；不宣称三包总验收或完整 Tauri 端到端测试通过。

## 实际成图及交互结果

使用原有 `projectMap` 和 `MapViewport`，临时页面只提供模式切换、region/place 筛选和选择结果显示；未隐藏标记、替换绘制器、强制派发点击事件或修改数据。浏览器视窗 1280×720、devicePixelRatio 1.25，SVG viewBox 1200×800。下列是 AI 实际操作记录，不是具名人工验收。

| 检查 | 结果 | 原始记录 |
| --- | --- | --- |
| 州区域首次鼠标点击 | 42/50 正确 | [region-clicks.json](region-clicks.json) |
| 上述 8 个未成功州的键盘操作 | 8/8，方向键加 Enter 后正确 | [region-keyboard.json](region-keyboard.json) |
| 州府标记首次中心点击 | 42/50 正确 | [capital-clicks.json](capital-clicks.json) |
| 点击重叠标记的可见部分 | 新增 6 个成功；另 2 个仍未成功 | [capital-retarget.json](capital-retarget.json) |
| 最后两个州府放大、平移后点击 | Hartford、Boston 均成功，4.29981696× | [capital-zoom-retarget.json](capital-zoom-retarget.json) |
| 重置及错误日志 | Home 恢复 `translate(0 0) scale(1)`；未记录浏览器 error | [browser-session.json](browser-session.json) |

成功选择的并集覆盖全部 50 州和全部 50 州府。**这不等于默认鼠标点击 100/100 通过**，更不是无障碍、触控或安装版界面全部验收通过。小州第一次点击失败包括 CT、DE、MA、NH、NJ、RI、SC、VT；SC 的可见空隙也很窄。采样查找只是选择测试位置，不证明某个州的每一点都被遮住。保留全部首次失败记录。

未编辑截图：[默认全图](overview.jpg)、[4.3 倍东北部](northeast-zoom4.jpg)、[波士顿成功选中并揭示](boston-selected.jpg)。实际轮廓与原始 KML 环序列独立比对一致；原有[成图记录](../visual-review/)另含 Alaska、Hawaii、不同模式和 1/2/4/8 倍检查。截图显示的标记与标签拥挤是真实问题，不是来源坐标错误。

## 还需要什么

1. **不再缺美国地图资源。** 现有数据足够开发五项学习能力。
2. 显示层需优化默认美国本土视野、阿拉斯加/夏威夷导航、州府标记大小与遮挡、缩放中心；尤其定位州区域时，不能让不可选的州府标记挡住州。上述 React/地图改动不在本任务文件权限内，本次未实施。
3. 资源树临时文件问题已在后续收尾关闭：旧四目录的 32 份重复 JSON 经哈希核对后移到忽略的 `.superpowers/launch-task/archived-us-verification/`，可恢复；新验证在系统临时目录创建副本并自动清理。可选 Python 工具安装说明已移到资源树之外。打包负责人仍应核对最终安装器资源清单；Git 忽略不等于 Tauri 不打包。
4. 原来源使用说明与归属标注继续保留；未勾选具名人工或法定公开发行审核。允许降低教学几何精度，不等于把未进行的审核写成已完成。

独立审查结论：无 Critical/Important 源数据缺陷；认可数据层纳入开发包；默认指针交互仍未完成。审查提出的坐标绑定、文本判题覆盖缺口已补测。后续代码复审也通过来源自检和临时目录修复。

## 人工可执行复现

在保留的 `codex/v1-launch-packs` 工作树根目录执行：

```powershell
node node_modules/tsx/dist/cli.mjs src-tauri/resources/content/us-states/_provenance/verify.ts
node node_modules/vitest/vitest.mjs run scripts/content/launch-packs.test.ts -t 'us-states|all 50 real US'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1437 --strictPort
```

打开 `http://127.0.0.1:1437/.superpowers/launch-task/render.html?pack=us-states` 可重用原保留工作树的检查页。新克隆现已可按[来源说明中的复制命令](../README.md#recreate-the-actual-render-inspection-page)，从 `render.html.txt` / `render.tsx.txt` 模板重建同样的临时页面（1441 端口）。这些只是实际组件检查材料，不是安装版新增页面。

1. 选择“测试州区域”，先检查全图的 Alaska、Hawaii、本土及小州。42 个成功位置见 `region-clicks.json`；页面滚动后不要直接复用旧屏幕坐标。可在图内用方向键移动焦点、Enter 选择，核对页面“当前选择”而非只看点击是否执行。
2. 选择“测试州府点位”，逐个核对点选回传 ID。Sacramento、Denver 等中心被相邻标记遮挡时，可点击可见部分；原先失败和重试结果均在上表文件中。
3. 切换“仅揭示选中项”；在地图上滚轮向上 8 次得到约 4.3 倍。拖动到东北部，选择 Hartford、Boston，核对只有选中答案的标签被揭示。实际本次平移量为 `[-900,-1400]`；人工只需把目标移入视窗，不要求同样像素。
4. 在地图获得焦点时按 Home，核对回到全图；切换探索模式检查标签拥挤。人工应另记录观察者、显示缩放和每项差异，不以本文替代签名。

`rendered-svg.json` 来自实际 DOM，`hit-targets.cjs` 仅离线计算测试位置，`keyboard-routes.ts` 仅预测键盘路径；真正通过依据是保存的点击/按键后的 DOM 选择结果。`node .../functional-review/summarize.cjs` 重查这些记录的覆盖集合和当前资源哈希，生成[机器汇总](summary.json)。[Vitest 原始报告](vitest.json)保存了专项测试结果。

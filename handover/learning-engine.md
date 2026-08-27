# 学习引擎摘要

> 只维护可执行规则与不变量；跨任务精确类型和公式以实施计划“Frozen cross-task contracts”为准。

## 能力与作答

掌握主键：`(learnerId, packId, entityId, skill)`。五类能力：`locate_region`、`identify_region`、`associate_capital`、`locate_place`、`identify_place`。

- 地图定位始终 `map`；其余三类在 `new/learning` 用四选一，在 `weak+` 优先文字输入。
- 状态：`presenting → answering → first_retry → revealed → completed`。
- 首错给最弱提示且不泄露答案；二错揭示并产生 3–5 题后的变式重测。
- 提示或重试后答对不晋升；无选择不得提交。

## 掌握与易忘

阶段/基础间隔：`new` 本会话认识、`learning` 10 分钟、`weak` 1 天、`familiar` 3 天、`solid` 7 天、`mastered` 21 天并可倍增至 90 天。

- 首次独立正确晋升一级；mastered 成功按计划倍增，最高 90 天。
- 提示/重试后正确保持阶段，下次不晚于 1 天；完全失败降一级、10 分钟后到期并创建重测债务。
- 只有题目呈现时已经到期的 `scheduledReview` 事件参与易忘判断。
- 达到 familiar 后，30 天内两次计划复习失败标记 `fragile`；三次至少相隔 24 小时的独立正确计划复习解除。

## 调度不变量

智能/摸底固定 12 道基础题；认识卡不计题；延迟重测最多扩至 15。优先级：跨会话重测债务 → 到期 → 薄弱 → 易忘 → 4–6 个新地点 → 保持题。

- 12 道基础题中单题型最多 6，易忘最多 3；追加重测不进入分母。
- 无法保持 3–5 道间隔时，债务携带 `entityId + skill + sourceQuestionKind` 到下次会话最前。
- 相同内容、时间和随机源必须生成相同会话。
- `attemptId` 幂等；事件保存题目/技能、模式、是否到期/重测、作答轮次、提示、正确性和反应时间。

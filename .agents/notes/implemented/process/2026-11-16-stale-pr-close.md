# Agent Note: 2026-11-16 关闭长期无回复的开放 PR

Status: implemented

## Problem

`dsh-pet` 有 3 个开放 PR 停在作者侧：都收到过具体整改清单，但作者本人最后一次活动距今超过 7 天（17.7 至 28.8 天）。用户（owner）要求：作者超过 7 天没有新提交或回复的 PR 关闭。

## Decision

**按「作者本人最后一次活动距今超过 7 天」判定（基准 2026-11-16），逐个关闭并写明整改项与 reopen 方式。关闭 3 个，关闭后本仓开放 PR 为 0。**

- `#20` @Aphasia-Koi（28.8 天）：像素安全尺寸挂在 `setConfig` 上（`src/service.ts:1091`），拖动位置会连带改尺寸；应只对尺寸变更生效。
- `#23` @DescartHsu（21.8 天）：改色时色相下界卡在 0.48，9 行共 12,576 个像素带荧光青绿杂边，需平滑映射后重导 spritesheet 与 previews，并补运行实测证据。
- `#26` @penylethylamine-0416（17.7 天）：`mergeVoicePacks`（`src/voice-pack.ts:521-575`）未合并新增的 `life` 字段，存在 `$DSH_HOME/pets/.voice.json` 时空闲闲聊永不触发；另有契约与解析器字段不一致。

## Alternatives considered

**交给 `stale-assignment.yml` 的 14 天转移机制处理。** 否决：该工作流只转 assignee，PR 仍开着；用户的决定是关闭。

**对 `#26` 例外保留（改动集中、只剩一处实现缺陷）。** 否决：例外会破坏尺度一致性；关闭可逆，作者补完可直接 reopen。

## Consequences

- 3 个 PR 关闭并各自留下可执行的整改项；关闭不等于拒绝。
- 本仓开放 PR 归零，下一次有新提交时按常规评审流程处理。
- 7 天关闭早于 `stale-assignment.yml` 的 14 天转移，两者不再同时生效；若保留自动转移语义需调整期限。
- `dsh-web` 的 `satellites/dsh-pet` 钉版仍指向 `ffaa39b`，本轮 note 提交不含宠物内容变化，不需要移动钉版。

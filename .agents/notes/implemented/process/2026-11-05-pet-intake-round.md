# Agent Note: The 2026-11-05 pet intake round

Status: implemented

## Problem

Three open pull requests (#26, #23, and #20) were reviewed in this intake round; none met the bar to merge. Two of the three (#26 and #20) sit at the exact `commit_id` reviewed in the previous round with zero follow-up commits from their authors, while #23 passes technical asset validation but lacks user-visible PR evidence, required third-party rights declarations, and a conflict-free base against `main`.

Beyond individual defects and unaddressed review threads, the round surfaced a recurring mechanism problem: solving the same issue twice across diverging code paths. In #20, `src/service.ts:1091` applies `pixelSafeSize` on every `setConfig` call while `main` already solved spritesheet pixel alignment in commit `345325f` inside `src/client/spritesheet.ts` through whole-cell quantization, and in #26 the runtime parser (`src/manifest-v2.ts:249`) and Chinese documentation (`README.zh.md:195`) diverge from the published JSON schema (`contracts/pet-manifest-v2.schema.json`) and English README pair.

## Decision

All three pull requests remain unmerged and are returned to their authors with explicit blockers and two settled maintainer policies:

- **#26 (live2d skin swapping, blinking, and breathing) stays on changes requested.** The head commit has not changed since the previous `CHANGES_REQUESTED` review, leaving all five prior blockers open. Two additional contract and documentation defects are recorded:
  1. `contracts/pet-manifest-v2.schema.json` sets `additionalProperties: false` on `live2d.skins.items` and lists only `id`, `label`, `expression`, and `expressions`, whereas `src/manifest-v2.ts:249` accepts `blinkExpression` and `switchLines` and `README.zh.md:195` instructs authors to write those two fields; a manifest authored per the documentation is rejected as invalid by the published schema.
  2. `README.md` and `README.i18n.yaml` were not updated to match `README.zh.md` (the `zh` blob hash is `a7596e20` while the sidecar still records `5b5eaa26`).
- **Maintainer ruling on #26 desktop activity probing:** Windows desktop activity probing may stay in the codebase, provided it is gated behind a default-off configuration switch, backs off after execution failures instead of retrying on the 2-second poll cadence, and sends only `category` to the client (`src/desktop-activity.ts:128`, `145`, and `153` currently transmit the foreground window title and process name alongside `category`, while the client only reads `category`).
- **#23 (red whale girl asset) passes technical verification but returns on content, provenance, and branch gates.** Technical inspection confirmed that the `1536x1872` atlas has an alpha channel byte-for-byte identical to the refined variant (`2,875,392` bytes identical) and that measured per-row frame counts (`6/8/8/4/5/8/6/6/6`) match `pet.json`. The PR remains blocked because `docs/pr-evidence/` has no directory for this PR and the PR description contains no screenshots or video (`previews/idle.gif` is the raw asset rather than user-visible evidence); `assets/whale-red/README.md` omits character attribution, unofficial/non-commercial statements, and contributor liability responsibility; `THIRD_PARTY_NOTICES.md` has zero matches for `whale-red`; and the branch conflicts with `main`.
- **Maintainer ruling on #23 distribution channel:** `whale-red` will distribute exclusively through the Workshop market and will not be added to the npm package whitelist. Because it is a color variant of an existing built-in pet and the market build reads directly from `assets/`, keeping it out of the npm tarball avoids adding `2.33 MB` (`2,227,876` bytes for the atlas plus `102,335` bytes for the preview) to every `dsh-pet` installation.
- **#20 (frames2d gameplay layer) stays on changes requested.** The head commit is unchanged since the prior review with zero new commits. Item 6 from the previous review remains unfixed: `src/service.ts:1091` unconditionally runs `pixelSafeSize` inside `setConfig`, and dragging the pet invokes `setConfig({ right, bottom })` from `src/client/index.ts:576`, which quantizes the default size `160` against real cell heights to `512` for `miku`, `342` for `jyn`, and `283` for `doro` (magnifying the pet roughly threefold on a single drag) while duplicating the spritesheet alignment already solved on `main` by commit `345325f` in `src/client/spritesheet.ts`. Three further defects are recorded this round: six newly introduced blocks are missing from both `README.md` and `README.zh.md`; the contract schema was not updated to include `stats`; and the `turn/end` `default` branch in `src/event-projection.ts:1996-2002` classifies every unknown termination reason as `interrupted`.

## Alternatives considered

**Bundle #23 (`whale-red`) into the `dsh-pet` npm package.** Rejected: `whale-red` is a recolor of an existing built-in pet rather than a distinct baseline archetype, and the Workshop market build already ingests `assets/` directly from the repository. Shipping it in the npm package would force every `dsh-pet` install to download an extra `2.33 MB` (`2,227,876`-byte atlas and `102,335`-byte preview).

**Require #26 to delete Windows desktop activity probing outright.** Rejected: activity category detection is acceptable as an opt-in capability once bounded. Requiring a default-off switch, failure backoff decoupled from the 2-second poll loop, and stripping window titles and process names at `src/desktop-activity.ts:128/145/153` so only `category` crosses to the client resolves both the privacy exposure and the process-spawning hazard without discarding the feature.

**Accept #20's `pixelSafeSize` mutation in `setConfig` alongside `main`'s whole-cell quantization.** Rejected: `main` commit `345325f` in `src/client/spritesheet.ts` already resolves spritesheet rendering alignment without mutating persisted configuration. Keeping `pixelSafeSize` inside `src/service.ts:1091` creates a second competing mechanism for the same problem and causes position drags (`src/client/index.ts:576`, `setConfig({ right, bottom })`) to rewrite the configured size from `160` to `512` (`miku`), `342` (`jyn`), or `283` (`doro`).

## Consequences

Zero pull requests merged in `dsh-pet` during this round; the `satellites/dsh-pet` submodule gitlink in `dsh-web` does not move and no market artifact rebuild is triggered.

#23 has a settled distribution boundary—market-only via `assets/`, excluded from the npm package—so once the author rebases onto `main`, supplies user-visible evidence under `docs/pr-evidence/` and the PR description, and completes the rights and liability notices in `assets/whale-red/README.md` and `THIRD_PARTY_NOTICES.md`, it can be integrated without expanding the published npm payload.

#26 and #20 remain stalled with zero author commits since their previous review rounds; neither can advance until their authors push revisions addressing both the prior review items and the schema, documentation, and runtime defects recorded in this round.

## 傍晚第二轮

傍晚复检覆盖同一批三个开放 PR（#23、#26、#20），对 #23 补充逐帧像素比对与分支基线核验，全部维持未合入状态：

- **#23 `whale-red`（基于 `assets/whale-refined` 的确定性改色衍生）：阻塞退回，共五处问题。**
  1. 图集 `assets/whale-red/spritesheet.webp` 改色时把 HSV 色相下界卡在 `0.48`，原版发梢偏青蓝的渐变与半透明抗锯齿边缘落在阈值外；逐帧比对 `whale-refined` 后，全 57 帧共检出 12,576 个青绿残留像素（判定式 `G > 1.25*R` 且 `G > 0.35` 且 `S > 0.25` 且 `A > 64`），第 1、2 行左右奔跑与第 5 行失败状态的发尾最明显，每帧 250-400 个。
  2. PR 描述无任何运行实测证据；`previews/idle.gif` 是资产本身，不能替代「设置页宠物选择器出现该宠物、切换后各状态动画运行」的截图或录屏。
  3. 未按同仓 `jyn-loli`、`deep-chan` 的标准在根 `THIRD_PARTY_NOTICES.md` 登记 `whale-red` 条目，且缺少「基于 DeepSeek 鲸鱼标识的非官方同人衍生、非官方、与本仓库无关、仅供个人非商业使用、版权与衍生责任由贡献者承担」的声明。
  4. 把 `assets/whale-red` 加进了 `package.json` 的 `files` 白名单，会让每个安装 `dsh-pet` 的用户多承担 2.33 MB；配色变体应按 `CONTRIBUTING` 走市场按需分发。
  5. 分支落后 `main` 21 个提交，`README.i18n.yaml` 存在冲突，`src/registry.test.ts` 的内置宠物断言缺 `deep-chan`、`jyn-loli`、`long-niang` 三只。
- **#20 与 #26 维持既有 `CHANGES_REQUESTED`，作者尚未回应。** #26 仍处于可合并状态但分支内容未发生改动，处于合并冲突状态的是 #20。

### Alternatives considered

**把 #23 当作简单改色变体直接收录。** 否决：青绿伪影在全部 57 帧肉眼可见（累计 12,576 个青绿残留像素，第 1、2 行左右奔跑与第 5 行失败状态每帧 250-400 个），属于 HSV 色相阈值截断造成的素材质量缺陷，而非风格取舍。

**允许把 `whale-red` 配色变体随 npm 包分发。** 否决：`CONTRIBUTING` 要求非默认内置宠物经市场按需分发以控制 npm 包体积（避免每次安装 `dsh-pet` 额外增加 2.33 MB），且加入 `package.json` 的 `files` 白名单与同仓既有变体的分发方式不一致。

### Consequences

#23 待作者修复图集青绿残留、补齐运行实测证据与 `THIRD_PARTY_NOTICES.md` 声明、移出 `package.json` 的 `files` 白名单并同步 `main` 解决冲突与测试断言后重新提交，本轮不合入。

`dsh-pet` 的 `main` 本轮未发生变更，因此不涉及主仓 `satellites/dsh-pet` 钉版移动；同时由于 #23 未合入，本轮不产生任何市场产物重建或上架动作。

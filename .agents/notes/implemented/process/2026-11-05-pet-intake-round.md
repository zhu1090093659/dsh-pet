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

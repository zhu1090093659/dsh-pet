# Agent Note: The 2026-11-01 pet review round

Status: implemented

## Problem

Three PRs were open at the start of the round:
- #26: live2d skin swapping, blinking, and breathing (new feature).
- #23: red whale girl (pet content).
- #20: frames2d gameplay layer (new feature).

CI on #26 had never executed because all four previous workflow runs were parked at `action_required`. Approving the latest run (run 40945016646, head 0a7632cac3) produced a green result.

An audit of repository governance confirmed the baseline for evaluation:
- `dsh-pet` has no root `AGENTS.md`.
- The pull request template section is `## Verification` rather than `Local Feature Evidence`.
- The repository ruleset specifies only one required check: `migrate script, typecheck, test and build`.
- `required_approving_review_count` is 0.

## Decision

**#26 returns for changes; green CI only indicates unasserted defects.** The workflow passes because test coverage omits five blocking runtime, schema, and architectural flaws:
1. `mergeVoicePacks` (`src/voice-pack.ts:521-575`) drops the newly added `life` voice pool during merge, yet `src/registry.ts:1301` and `1320` read `life` exclusively from its output. Whenever `$DSH_HOME/pets/.voice.json` exists on disk, idle chatter never triggers and built-in pet life lines are permanently lost.
2. `contracts/pet-manifest-v2.schema.json` defines `live2d.skins.items` with only `id`, `label`, `expression`, and `expressions` under `additionalProperties: false`, but `src/manifest-v2.ts:249` parses `blinkExpression` and `switchLines`. The drift-lock test checks only top-level `live2d` keys, allowing nested schema drift to bypass CI.
3. `src/desktop-activity.ts` on win32 executes powershell every 20 seconds using inline C# recompiled via `Add-Type` on each invocation, populating foreground window title and process name into `PetStateView` polled by the browser every 2 seconds, even though the client only consumes `category`. When powershell fails, missing timestamp tracking causes process spawning on every 2-second poll.
4. `setSkin(undefined)` fails to reset applied skin expressions (`src/client/renderers/live2d.ts:441-444`), directly contradicting JSDoc specifications, prior decision records, and RPC contract semantics.
5. "Breathing" claimed in the title and description has zero implementation: `ParamBreath` and `ParamBodyAngleX` yield zero occurrences across the codebase, despite three comments claiming breathing is active.

Additional non-blocking fixes were identified for #26:
- `__dshPetLive2dDebug` lacks production gating and cleanup in `dispose`.
- Expanding the voice pool limit from 64 to 96 lacks documentation.
- `README.md` and `README.i18n.yaml` are out of sync.
- `blinkParts`, `blinkExpression`, and `switchLines` have zero test assertions.

**#23 and #20 remain in their previous states.**
- #23's author addressed none of the three maintainer requirements: user-visible evidence, rebasing against `main`, and completing the template checklist. The maintainer decision regarding npm bundle whitelisting versus market distribution remains unresolved.
- #20 addressed none of the four review requirements from 2026-10-20, with its head commit unchanged since 2026-10-18.

## Consequences

Zero PRs merged this round, and the submodule gitlink pinned in `dsh-web` remains unchanged.

#26 awaits an author revision addressing the five blockers. #23 and #20 remain stalled with their respective contributors.

## Alternatives considered

Merging #26 on the basis of green CI was rejected: automated checks passing merely confirms that existing assertions do not cover the voice-pack loss, contract drift, unthrottled process execution, or missing breathing logic.

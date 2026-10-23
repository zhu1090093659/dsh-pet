# Agent Note: Let a frames2d pack name its tracks

Status: implemented

## Problem

Tracks are addressed by id (`touch-eat-rice`, `work-in`), and ids leak into copy.
A purchase toast reported the prize as `success`, which a player reads as a bug
that happens to look like a reward. The alternative — writing the display name
into the toast code — hard-codes one pack's vocabulary into the plugin.

## Decision

`frames2d.trackLabels` maps a declared track id to a display name:

```jsonc
"trackLabels": { "touch-eat-rice": "白饭", "touch-eat-basin": "铁盆" }
```

Labels are presentational only: the renderer, the override slot and the phase map
still address tracks by id. Unknown keys are dropped, and an unlabelled track
still gets announced — just without a name, never with the raw id.

## Alternatives considered

- **Rename the tracks.** Ids are part of the pack's on-disk contract and appear in
  `phases`; renaming would break every existing pack for a cosmetic gain.
- **Put the name in the manifest description.** Not addressable per track.

## Consequences

- Purely additive; packs without labels behave as before.
- The parser rejects a label that is not a string, so a typo cannot reach a toast.

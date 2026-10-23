# Agent Note: One-shot work start, end and interruption beats

Status: implemented

## Problem

The activity phase stream cannot express "a work session started". `waiting` fires
at every turn start, every step start and whenever the agent blocks for approval,
and DSH chains turns: a delivered stage immediately starts the next one. A pack
that binds its walk-to-desk animation to `waiting` therefore replays it several
times per task, which reads as a glitch rather than as punctuation.

`sessionActive` looks like the boundary but is not one in practice. It is true for
the whole session, so after a page reload it never rises again and the entry
animation disappears; before the reload it rises once and the exit beat has
nothing to rise on.

Interruption has the mirror problem. A user stop arrives as `turn/end` with
reason `aborted`, and the projection deliberately maps that to `idle`: a stopped
session must not look like a failed one, and it must not speak the failure bubble.
That is the right contract, but it means "this turn was cut short" is not
expressible in the phase alone, so a pack has no edge to hang an interruption
animation on.

## Decision

Three named one-shot blocks in `gameplay`, parsed by the same reaction parser as
`feed` (a single `track` or a `states` pool, plus `holdMs`):

- `workEntry` — played when the pet re-enters work after having left it. The
  client keeps the time it last left work and replays the beat only when that gap
  exceeds `gapMs` (client default 6000, tuned per pack). 0 means every turn.
- `workExit` — played on the rising edge of `done`.
- `workInterrupt` — played when the snapshot's `interruptedAt` changes.

`interruptedAt` is a new snapshot field. The projection now marks a transition
`interrupted` for every ending that is not a clean delivery (error, max-tokens,
unknown reason, and `aborted`), the state machine stamps `interruptedAt` when it
sees the flag, and the projection still maps `aborted` to `idle`. The phase
contract is untouched; the interruption is a separate signal that only the beat
consumer reads.

The three tracks play through the same override slot as the feed animation, so a
phase change arriving mid-beat cannot cut them off.

## Alternatives considered

- **Bind the entry beat to `sessionActive`.** Never rises again after a reload, so
  the animation silently stops appearing.
- **Bind it to `waiting`.** Replays at every step; that was the original bug.
- **Map `aborted` to `failed`.** Tempting because it would give an edge for free,
  but it broke two existing specs that pin the stopped-session contract (no
  failure bubble, settled idle state), and it would make every user stop look like
  a crash. Reverted in favour of the independent signal.

## Consequences

- A pack that declares no beats behaves exactly as before: no extra reads, no
  extra timers.
- `gapMs` is a heuristic, not a boundary. The first work of a page always plays;
  chained turns inside `gapMs` do not. Packs tune it to taste.
- The beat hold is the pack's `holdMs`; the client keeps the sprite on the beat
  for that long even if the phase map would already have moved on.

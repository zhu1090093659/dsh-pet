# Agent Note: Feed a random pool and let a landed feed move the stats

Status: implemented

## Problem

`gameplay.feed` could name exactly one track, and it moved nothing. Two
consequences fell out of a real pack:

- A pack cannot ship a rare variant of the same interaction (the interesting
  animation happens one time in two, and the common one plays the rest).
- Feeding had no effect on the stats. The shop was the only source of positive
  stat changes, so with the shop removed the bars could only ever decay, and the
  feed button became a bubble with no gameplay behind it.

Rolling on the client is not enough. If the browser picks the animation and the
host picks the bubble copy, a "thanks for the food" line can land over a basin
flip: two independent dice, two different stories about the same event.

## Decision

- `feed.states` is a uniform pool rolled once per landed interaction; `feed.track`
  stays as the single-track shorthand. Odds are the pool's own frequencies, so
  repeating an entry is how a pack biases the roll (three rice entries plus one
  basin entry is 25% basin).
- `feed.effects` reuses the same effect list a shop item applies, and the host
  applies it on the settled state at the same point a purchase does.
- The host rolls and reports the pick back on the interaction result as `state`.
  The same roll chooses the bubble copy, so the two cannot disagree. A browser
  that talks to a host which reports no state falls back to its own roll, which
  keeps older hosts working.

## Alternatives considered

- **Roll in the browser.** Simpler, but the bubble and the animation come from
  different dice; that mismatch was the reason the feature exists.
- **Require `holdMs`.** A fixed hold cannot serve a 4.8s and a 9.6s outcome at
  once; the client derives it from the picked track's own play time instead.
- **Express the rare variant as a shop item.** That is what the pack did first,
  and it forced a currency, a price and a shop page onto an interaction that is
  not a purchase.

## Consequences

- A pack that declares one `track` and no `effects` behaves as before.
- The hold carries a small release grace so the last frame of a long track is not
  clipped; the alternative (exact sum of the frame durations) lost the tail
  because the frame chain starts on the next animation frame.

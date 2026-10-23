# Agent Note: Lock gameplay verbs out while the agent owns the sprite

Status: implemented

## Problem

Every gameplay verb that plays a reaction (a purchase, a one-shot mode, a tap, a
feed) writes the shared track-override slot. The work loop writes the same slot.
A player clicking a shop item while the agent works therefore replaced the work
animation with a purchase animation, and the pet looked like it had stopped
working.

The browser half could gate its own buttons, but the gate reads the phase from a
poll: a panel opened before the turn started can beat the next poll, and the host
has already moved on.

## Decision

`gameplay.blockPhases` is a closed subset of `ActivityPhase`. When the current
phase is in it:

- the host refuses `gameplayBuy`, one-shot modes, taps and `interact('feed')`
  **before** touching the ledger, so a blocked click spends nothing and reports
  `reason: 'blocked'`;
- the browser greys the controls and answers a click with the busy line instead of
  doing nothing silently.

`done` is deliberately **not** in the set. It fires on delivery and stays until the
next turn starts, so a lock that included it would keep the pet locked for as long
as the user reads the reply. Real modes (`work`, `sleep`) are also never blocked:
they are how the player leaves the state the lock protects.

## Alternatives considered

- **Block every interaction.** Includes the buttons that leave the state, and
  strands the player behind a panel that never accepts input.
- **Client gate only.** Racy by construction, as described above.
- **Pause the work loop instead.** The work loop is the pet's answer to "is the
  agent working"; pausing it lies about the agent.

## Consequences

- Packs without `blockPhases` keep the old behaviour exactly.
- The refusal is reported as a distinct reason so the client can explain it
  without parsing error strings.

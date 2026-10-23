# Agent Note: Floor a stat by affinity so a long relationship cannot read as zero

Status: implemented

## Problem

`stats.affection` and the panel's affinity are two independent numbers. Affection
decays with hunger and is only topped up by feeding; affinity grows slowly from
being around. A player who leaves the pet alone for a day therefore sees a panel
saying "affinity 800" next to an affection bar at zero, which reads as a bug: the
number that is supposed to represent the relationship is the emptier one.

## Decision

A stat may declare `affinityFloorDivisor`. At settlement the stat is raised to at
least `min(max, affinityPoints / divisor)` before decay is applied, so the floor
is a property of the relationship rather than an event:

```jsonc
"affection": { "max": 100, "affinityFloorDivisor": 10 }
```

```text
affinity 100  -> floor 10
affinity 822  -> floor 82.2
affinity 1000 -> floor 100 (full)
```

The divisor is what makes it a floor and not a mirror: a pet author picks how much
affinity one point of the bar is worth. `affinityFloorDivisor` also refuses to
combine with `mirror`, so a stat cannot claim both "tracks affinity" and "floored
by affinity".

## Alternatives considered

- **Mirror affinity into the stat outright.** Removes the decay the stat exists
  for; the bar would stop meaning anything.
- **Grant the stat when affinity rises.** Still decays back to zero within a day,
  so the reported mismatch returns.
- **No floor, document it.** The pack's user reads the panel, not the docs.

## Consequences

- Neglect still lowers the bar, and feeding still raises it, so the loop survives.
- The floor is applied where the stat is settled, so every reader (bar, tooltip,
  decay) sees the same value.

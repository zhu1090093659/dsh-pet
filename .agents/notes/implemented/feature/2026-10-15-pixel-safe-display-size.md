# Agent Note: Snap a frames2d pet to pixel-safe display sizes

Status: implemented

## Problem

The display size is a free number in `32..1024`. A frames2d pack is drawn on a
fixed pixel grid and rendered with `image-rendering: pixelated`, so any size that
is not a clean fraction of the sprite cell makes some art pixels two screen pixels
wide while their neighbours stay one. It shows up first in thin lines and text,
and it looks like the art is damaged rather than scaled.

Stepping by a fixed number of pixels (the obvious request, "every 16px") does not
help: the clean sizes are fractions of the cell, and 16px steps land between them.

## Decision

`PIXEL_SIZE_STEPS` are expressed as fractions of the cell: `0.5`, `0.75`, `1`. For
a 256px cell that is 128, 192 and 256. `snapPixelSize` picks the nearest step, and
the host applies it to any requested size for a frames2d pet; other renderers keep
the plain 32..1024 clamp, because a Live2D model scales smoothly and has no grid to
protect.

0.75 is offered even though it is not pixel-perfect: it is the size most people
want on a desktop, and the unevenness is only visible in fine detail. The
alternative of allowing only 0.5 and 1 was considered too rigid for the value.

## Alternatives considered

- **16px grid.** Lands on no clean ratio for a 256px cell; strictly worse than the
  fraction steps.
- **A dropdown of three sizes.** Rigid, and the settings form is shared with
  renderers where a free number is correct.
- **Snap in the form only.** API callers and pasted settings would bypass it; the
  host is the single place every path goes through.

## Consequences

- A stored size that is not a step is not rewritten until the next edit; the
  renderer still displays it.
- The size hint names the three steps so the snap is expected rather than a
  surprise.

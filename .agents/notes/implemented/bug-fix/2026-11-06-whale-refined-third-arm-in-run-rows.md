# Agent Note: The whale-refined run rows no longer read as a three-armed pose

Status: implemented

## Problem

Issue #2021. `assets/whale-refined/spritesheet.webp` carries the built-in
`whale-girl-refined` pet as one 1536x1872 atlas: 8 columns x 9 rows of 192x208
cells in `PET_ROW_ORDER`, row 1 `running-right` and row 2 `running-left`.

Both run rows were drawn from one three-quarter side pose with the near arm bent
forward at the chest. The far arm was drawn a second time, its white cuff and
skin hand sitting on top of the dress at the waist on the character's back side.
Its connecting sleeve is the same dark navy as the dress, so the cuff and hand
arrive with no visible arm attached: the eye reads a pale hand growing out of the
waist, and together with the near arm's cuff the pose counts three arms. Fine at
192x208 on a large screen, unmistakable at the 148x160 cell the pet actually
renders at (`display.size: 160` over a 208-tall cell, `scaledCellSize`).

Seven of the eight frames carried the defect; frame 3 (column index 2) had the
hand almost entirely hidden behind the dress and needed only a small cleanup.

## Decision

The two run rows were repainted in place; the manifest, the container format and
every other row were left alone.

- **What was removed.** In each of the eight row-1 cells, the pale cuff and hand
  (and its dark contour) were erased and the dress beneath reconstructed. The
  near arm at the chest, the torso, the ruffled collar, the apron and the running
  silhouette are untouched. The far arm now reads as hidden behind the body,
  which is what a side-view run pose should show.
- **How it was erased, inside each 192x208 cell.** The erase mask is the pale
  hand component found by skin-tone connectivity in a window around the waist,
  plus every non-navy pixel inside that component's padded bounding box. Blue
  (hair and dress share that hue family here) is never masked, so the hair lock
  hanging beside the cuff keeps its silhouette. The hole is then filled with a
  harmonic (Laplace) interpolation of its border and the result snapped to the
  dress palette sampled from an annulus on the dress side of the hole, which
  keeps the fill in the artwork's own flat navy tones instead of a smooth
  gradient smudge.
- **Row 2 is generated, not repainted.** Every `running-left` cell is the exact
  horizontal mirror of the matching `running-right` cell, cell by cell, so the
  two rows cannot drift apart again on their own. The pre-fix row 2 was a mirror
  about cell x=95 rather than x=191, i.e. it sat one pixel to the left of a true
  mirror; that one-pixel offset is gone as a side effect.
- **Other rows are untouched.** Rows 0 and 3-8 keep their pixels; the only
  differences in them are RGB values under `alpha: 0`, where libwebp lossless
  zeroes colour it does not need. No renderer can show them: a transparent pixel
  contributes nothing to the composite whatever its RGB.
- **The container stays lossless.** The atlas is re-encoded as VP8L with the
  alpha flag set, so the transparent padding around each pose survives
  byte-for-byte in its alpha channel and no frame bleeds into its neighbour.

## Alternatives considered

- **Keep the far arm and darken its sleeve so it reads as an arm.** The cuff,
  hand and contour are already committed to the pixel grid and the connecting
  sleeve has no room to be drawn at this size; recolouring it would still leave a
  pale blob at the waist, just a darker one, and the waist would gain a shape no
  other row shows.
- **Patch-fill by copying a dress patch from elsewhere in the same frame.** Tried
  first: the exemplar search reproduced the cuff's own dark outline as a hard
  diagonal streak across the repair, because the only nearby structure is that
  outline. Worse than the harmonic fill at every frame.
- **Fill with a flat navy colour.** Fast, but the dress in that area sits on a
  fold; a single flat tone punched a visibly lighter rectangle into the shading.
- **Redraw the whole run cycle from new art.** The other seven rows, the shot
  list and the palette all come from one AI-assisted generation chain; regenerating
  a run cycle would move the character design and cost far more than the defect
  (one small element per frame) justifies.
- **Drop the run rows to the surviving frames, or reuse row 7 (`running`).**
  Row 7 is a different, shorter cycle meant for the generic running state; the
  directional rows must stay a matched 8-frame left/right pair for the pet's
  direction switching, and the manifest's `running-right` / `running-left`
  cadence is per-row content.
- **Scale the atlas up or change the cell so the cuff stops reading as a hand.**
  Geometry is consumed by `scaledCellSize` / `framePosition` and pinned by the
  manifest; a bigger cell changes the pet's display size and the frame offsets for
  every row, and would still leave the extra limb visible on a larger screen.

## Consequences

- The run rows now read as two arms at every size the pet is rendered at; the
  `whale-girl-refined` silhouette is unchanged elsewhere.
- `running-left` is pixel-exactly the mirror of `running-right`, so a future
  repaint of one row must repaint the other (or re-run the mirror step). The new
  `tests/whale-refined-atlas.spec.ts` pins the invariant that makes that
  meaningful: both rows fill all eight columns and carry the same cadence.
- The same spec pins the geometry a repaint must not disturb — whole 8x9 grid of
  192x208 cells, no `cell` override in the manifest, no track longer than its
  row, and a lossless VP8L container with its alpha channel still encoded.
- Atlas bytes shrank slightly (2 199 642 -> 2 186 206) because the repaint
  removed some high-frequency detail; the decoded canvas is the same size.
- The pixel-level verification (unchanged rows, exact mirror) was done with an
  external decoder against the pre-fix file while the repaint landed; the
  dependency-free spec covers the parts a checkout can assert from the header and
  the manifest.
- Needs the DSH host restarted before the new atlas is served: the asset route
  serves the file from disk, but a running client keeps the cached image.

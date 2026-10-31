# Agent Note: Live2D outfits — selectable skins riding the expression layer

Status: implemented

Related: [panel actions and the status-bubble switch](2026-10-05-panel-actions-and-status-bubble-switch.md)
(the panel row this button joins) and the frames2d skin contract in
`src/manifest-v2.ts` (the selection slot this reuses).

## Problem

A Live2D model can ship more than one costume inside the same `.moc3`: the
artist keys part opacities to a parameter (xiaolong's `Param64`, named
「换衣服」) and drives it from an expression. frames2d pets could already offer
selectable skins; live2d pets could not. The panel had no entry point, the
manifest had no field, and the persisted selection slot (`pet.json` → `skins`)
was only consulted against `frames2d.skins`, so a live2d choice would have been
dropped as stale on the next load.

## Decision

**`live2d.skins` is a list of `{ id, label, expression }`, and the renderer
applies the selected entry's expression.**

- The expression layer is the right seam: `InternalModel.update` saves the
  motion-driven parameters and *then* runs the expression manager, so an
  applied expression survives every phase change, tap and idle loop without the
  renderer writing a parameter per frame. A costume keyed to a parameter costs
  no extra textures and keeps physics/pose bindings intact.
- `expression` is required: an entry without one would be indistinguishable
  from "no selection", which is what the absent value already means.
- The registry drops an entry whose expression the model3.json does not
  declare, with a warning — the engine can only apply names it knows, so
  shipping it would render a button that silently does nothing.
- Selection is **not** a new persisted field: a pet is one renderer, so the
  existing per-pet `skins` map is shared (`PetService.declaredSkins` reads
  `frames2d.skins ?? live2d.skins`). The frames2d and live2d choice therefore
  never disagree, and the `set-skin` RPC, the state view's `skin` field and the
  stale-id repair all apply unchanged.
- Manifest convention: **entry 0 is the default look.** "No stored selection"
  resolves to it, so the first click of the 换装 button always leaves the
  default. The panel renders one button that cycles the list and names the next
  entry in its tooltip; a pet with fewer than two entries renders none.
- The renderer handle grows an optional `setSkin(id?)`. It is optional so a
  handle built by an older host (or a test fake) stays valid; `undefined`
  restores the phase expression, i.e. the model's own look.

## Alternatives considered

- **A second parameter-driven renderer path.** Writing `Param64` from a ticker
  would have to re-apply after every motion update and would need the manifest
  to carry parameter ids — moving the model's internal naming into the pet's
  contract, and re-implementing what the expression manager already does.
- **Baking two `.moc3` variants.** Correct-looking but doubles a 2.5 MB model
  and needs Cubism SDK tooling at build time; the costume is already switchable
  at runtime.
- **Two pet entries pointing at the same model.** They would share one `.moc3`
  anyway, so the costume still has to be selected at runtime; all it buys is a
  duplicate registry entry and a pet-switch instead of an outfit switch.
- **A new `outfit` field in the persisted document.** Rejected as a second
  source of truth for the same question ("which visual variant is selected").

## Consequences

- A live2d pet can declare outfits with two manifest lines and one expression
  file per costume; the panel gains the button automatically.
- The choice persists per pet in `$DSH_HOME/pet.json` and is restored on
  reload, client restart and pet re-selection through the existing `skin`
  plumbing.
- Wire change (additive): `live2d.skins` in the manifest, `PetDefinition.live2d.skins`
  to the browser half, and `Live2dRendererHandle.setSkin`. A host that predates
  it serves no `skins`, which renders no button.
- Tests: `src/manifest-v2.test.ts` (shape, duplicates, unknown fields),
  `src/registry.test.ts` (undeclared expression dropped with a warning),
  `src/client/renderers/live2d.test.ts` (expression applied, survives a phase
  change, outfit beats a phase expression), `src/client/PetSprite.test.tsx`
  (button presence, cycling, tooltip).

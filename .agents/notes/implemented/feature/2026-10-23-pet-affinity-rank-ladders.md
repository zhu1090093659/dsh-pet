# Agent Note: Pets declare their own affinity rank ladder

Status: implemented

## Problem

The affinity ladder was a single module constant, `AFFINITY_RANKS` in
`src/affinity.ts`: 幼鲸 → 伙伴 → 挚友 → 深海羁绊 → 心有灵犀 → 传说羁绊 →
神话羁绊 → 永恒之契 → 鲸生共渡. `rankOf(points)` only saw points, so every
pet — a black coal ball, a bee-eater, a cat — showed whale ranks. The hover
panel could change the surrounding format (`panel.stats.rank`) but not the
name substituted into `{rank}`, because the host view carried the built-in
name and the client only translated that fixed string through
`pet.rank.name.*`.

A pet's rank names are part of its identity, and content authors already have a
per-pet copy channel (`voice.json`). The same channel is the right home for a
declared ladder; the built-in whale ladder stays the fallback.

## Decision

- Extend `voice.json` with an optional `panel.ranks` array (issue #21,
  Option A). A ladder entry is `{ min, name, nameEn? }`; `name` is the
  default and `nameEn` applies when the UI locale is English. The block lives
  under `panel` so it inherits the existing per-slot precedence: pet
  `voice.json` > global `$DSH_HOME/pets/.voice.json` > built-in.
- The ladder is display-only. Points, rewards, cooldowns, the built-in
  thresholds and the persisted ledger are untouched; `panel.ranks` only
  changes which name `rankOf`/ `affinityViewOf` resolve.
- Validation is all-or-nothing per ladder, matching the voice pack's
  warn-and-drop discipline: an array of 1-16 entries, first `min` 0, strictly
  ascending unique minima, names of 1-24 characters. Any violation warns and
  drops the whole ladder, so the pet keeps the built-in names instead of a
  half-broken ladder; a bad ladder never rejects the pet.
- A declared ladder replaces the previous ladder whole when layers merge. It
  does not merge tiers across layers: merging two partial ladders would produce
  thresholds no author declared.
- The service resolves the ladder in the same place as the remark layers
  (`voiceLayers` / `applyVoiceLayers`), so startup, `setPetId` and the
  settings-surface apply cannot drift apart.
- The browser render picks `rankEn` from the mount's active locale id for a
  declared ladder; built-in names still resolve through the i18n
  `pet.rank.name.*` dictionary. `panel.stats.rank`'s `{rank}` receives the
  effective name, so a custom stat format also shows the pet's name.

## Alternatives considered

- **Put the ladder in `pet.json` as `affinity.ranks` (issue Option B).**
  Rejected: it needs a v2 manifest schema change, validator work and a
  manifest-version bump for every author, while the voice overlay already
  provides the identity binding and precedence. The issue itself prefers A.
- **A global `Config.affinityRanks`.** Rejected: one ladder for all pets does
  not solve the reported problem; each pet keeps its own voice.
- **Per-pet affinity ledgers (separate points per pet).** Rejected as a larger
  behavioral change and a different issue; this change is display-only.
- **Merge rank ladders tier by tier across layers.** Rejected: threshold sets
  are an author's whole decision, and a merged ladder is neither layer's.
- **Keep the dead top-level `ranks` name map from #1226.** Left in place for
  wire compatibility; it is not consumed and this change does not extend it.
  `panel.ranks` is the declared ladder authors should use.

## Consequences

- A pet without `panel.ranks` renders exactly as before, and the built-in
  pets are unchanged.
- Content authors can rename tiers per pet or per installation without a
  manifest schema bump. Invalid ladders surface through the existing
  `dsh-pet validate` warnings and fall back to the built-in names.
- `src/voice-pack.test.ts` pins validation and whole-ladder merge,
  `src/affinity.test.ts` pins lookup and `nameEn` projection,
  `src/ledger.test.ts` pins the ledger re-seat, `src/service.test.ts` pins the
  global-vs-pet precedence across a switch and a settings apply, and
  `src/client/PetSprite.test.tsx` pins the English/default rendering and the
  custom `{rank}` format.
- `contracts/voice-pack-v1.schema.json` documents the new block; the drift
  lock in `src/voice-pack.test.ts` keeps its caps in sync.
- Not covered: a live GUI check. The host-side view and the rendering rules are
  covered by unit/component tests; the web GUI needs a rebuild/restart to load
  the changed client bundle.

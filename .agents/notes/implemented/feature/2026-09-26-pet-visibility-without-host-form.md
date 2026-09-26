# Agent Note: The settings card writes visibility through the pet API when no Host form exists

Status: implemented

## Problem

The pet settings card has two backings. When the Host serves a `pet` settings
namespace, the card edits that form and the Host is the authority. When it does
not — the aggregate `dsh-web-all` shell is the case that reaches users — the card
falls back to writing the pet API directly.

The fallback only knew about one field. It read the selection from
`/api/pet/state`, rendered the pet picker alone, and on save posted to
`/api/pet/set-pet`. The visibility switch was rendered only in the
Host-form branch, so on the aggregate shell a user could choose a pet but never
hide it: the one control that turns the pet off was not on screen and had no
write path.

## Decision

**The fallback mirrors the persisted display state and is the writer for it.**
It reads `display.visible` from `/api/pet/state` (absent block means the pet
shows, which is the pre-switch behaviour), renders the same visibility switch the
full card renders, and on save posts `/api/pet/set-visible` before confirming
the read-back. The switch is on screen whether or not the Host form exists.

Two shapes follow from that:

- The fallback keeps its own staged drafts for both fields and computes `dirty`
  across both, because there is no user layer to diff against. A save with only
  one field staged writes only that field.
- A write is confirmed by re-reading `/api/pet/state` and comparing both the
  selected id and the visibility, so a partial write cannot clear the drafts.

## Alternatives considered

- **Keep the fallback selection-only and tell users to install the pet plugin
  with its own settings form.** Rejected. The aggregate shell is the default
  install, and "the switch exists only if you install the other package" is the
  defect, not a workaround.
- **Write the visibility into the Host form when it is absent.** Rejected: there
  is no form to mutate when the fallback is active, which is exactly why the
  fallback exists.
- **Treat a missing `display` block as hidden.** Rejected. Hosts predating the
  visibility switch render the pet, so defaulting to hidden would hide pets on
  upgrade.
- **Clear the drafts on any successful HTTP status without a read-back.**
  Rejected. The existing selection path already confirmed by read-back; dropping
  that for the new field would let a silently-ignored write look like success.

## Consequences

- The aggregate shell can turn the pet off without the pet plugin's settings
  form, and the full card's behaviour is unchanged.
- Three tests were added: a save through the API with a confirmed read-back, a
  refused write that keeps the draft and surfaces the failure, and a render
  assertion that the switch is present while Host-only fields stay hidden.
- Verification: this landed with `pnpm typecheck`, the full `pnpm test` suite
  (45 files, 557 tests) and `pnpm build` passing, plus CI on the merged head.
- A separate main-branch defect was found and fixed in the same review round:
  `tests/pet-settings-dispose.spec.tsx` indexed `fetchMock.mock.calls[0]` on an
  argument-less mock, which fails typecheck (TS2493) and had left main's CI red.

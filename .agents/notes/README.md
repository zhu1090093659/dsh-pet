# Agent Notes

Agent Notes are the decision records for this repository: the *why* behind a
change and what was given up, the parts that code and README files cannot carry.

## Layout and naming

`{lifecycle}/{class}/yyyy-mm-dd-topic-title.md`, where the date is when the topic
was first proposed.

- **Lifecycle**: `proposed/` (reviewed, not yet built), `implemented/` (shipped),
  `rejected/` (considered and declined).
- **Class** (closed set): `feature`, `bug-fix`, `simplification`,
  `architecture`, `process`, `testing`.

## Format

The first line is `# Agent Note: <title>`, then a blank line, then
`Status: <status>`. Implemented records open with `## Problem` and carry
`## Decision`, `## Alternatives considered`, and `## Consequences`.
Proposals carry `## Proposal`, `## Alternatives considered`,
`## Acceptance criteria`, and `## Risks`.

## When to write one

Every non-trivial change adds or updates a note in the same commit. A change is
non-trivial when it alters behavior, a contract, process or tooling, a test
strategy, or an on-disk/wire format — or any decision a maintainer may reasonably
revisit. Before changing an existing subsystem, search `implemented/` for the
note that owns the decision and review its rejected alternatives. Update the
owning note rather than writing a duplicate.

# Contributing

This repository ships **one pet plugin**: the floating companion for the DSH Web
GUI plus the built-in pets it carries. Other pets are content: they ship through
the market (`dsh-market.com`) and are installed on demand into
`$DSH_HOME/pets/<id>`, so they do not belong in this repository unless they are
meant to be a built-in default.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Assets

`assets/<id>/` holds a pet manifest (`pet.json`, `petManifestVersion: 2`) plus
its spritesheet or frame tracks and previews. `pnpm test` validates the manifest
shape; `scripts/dsh-pet-migrate-v2.mjs` migrates a v1 manifest to v2 and refuses
to write output that the runtime parser would reject.

Only the pets listed in the `files` whitelist of `package.json` ship with the npm
package. Everything else stays installable through the market so the package
stays small.

## Commit and review

Use Conventional Commits (`feat(pet): ...`, `fix(pet): ...`). Do not use emoji
in code, comments, documentation, or commit messages. Behaviour changes need a
test; UI-only changes need at least a mount assertion.

## Release

The version is per-repository: it advances here and no longer with the dsh-web
monorepo. To cut a release, bump `version` in `package.json`, add the matching
`docs/release-notes/vX.Y.Z.md`, commit both, then push the tag:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The tag is the release switch. `.github/workflows/release.yml` reruns the CI
gates, refuses to publish when `package.json` disagrees with the tag, publishes
to npm, verifies the version resolves from the registry, and creates the GitHub
Release. It needs the repository secret `NPM_TOKEN` (an npm automation token for
the `@linxin666` scope).


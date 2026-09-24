## What

<!-- One or two sentences: the pet or the pet plugin change. -->

## Pet submission checklist

<!-- Only when this PR adds or updates a pet under assets/<id>/; skip otherwise. -->

- [ ] `assets/<id>/pet.json` is a v2 manifest: `petManifestVersion: 2`, a lowercase
      kebab `id`, `displayName`, `author`, `license`, `renderer`, and the matching
      `sprite2d` / `live2d` / `frames2d` block
- [ ] `node scripts/dsh-pet validate assets/<id>` passes (manifest, declared
      assets, Live2D reference closure, `voice.json`)
- [ ] The atlas keeps the 8-column x 9-row contract (row order idle, running-right,
      running-left, waving, jumping, failed, waiting, running, review) with unused
      cells fully transparent, or the live2d / frames2d tracks cover the same states
- [ ] `pnpm test` and `pnpm typecheck` pass
- [ ] The artwork is licensed for redistribution: `license` names the terms and the
      source is credited

## Verification

<!-- Paste the commands you ran and their result. -->

# Contributing

This repository ships **one pet plugin**: the floating companion for the DSH Web
GUI plus the built-in pets it carries. Other pets are content: they ship through
the market (\`dsh-market.com\`) and are installed on demand into
\`$DSH_HOME/pets/<id>\`, so they do not belong in this repository unless they are
meant to be a built-in default.

## Development

\`\`\`sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
\`\`\`

## Assets

\`assets/<id>/\` holds a pet manifest (\`pet.json\`, \`petManifestVersion: 2\`) plus
its spritesheet or frame tracks and previews. \`pnpm test\` validates the manifest
shape; \`scripts/dsh-pet-migrate-v2.mjs\` migrates a v1 manifest to v2 and refuses
to write output that the runtime parser would reject.

Only the pets listed in the \`files\` whitelist of \`package.json\` ship with the npm
package. Everything else stays installable through the market so the package
stays small.

## Commit and review

Use Conventional Commits (\`feat(pet): ...\`, \`fix(pet): ...\`). Do not use emoji
in code, comments, documentation, or commit messages. Behaviour changes need a
test; UI-only changes need at least a mount assertion.

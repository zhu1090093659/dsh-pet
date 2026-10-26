# Agent Note: Independent red whale-girl variant

Status: implemented

## Problem

Provide a red-and-white recolor of the refined whale girl as the independent
pet 鲸鱼娘（红色）, without replacing the existing blue pet.

## Decision

Add `assets/whale-red/` with the unique manifest ID `whale-girl-red` and include
it in the npm files whitelist. The existing registry discovers the directory;
no renderer or default selection changes are needed. Generate the six-frame
idle GIF from the recolored WebP atlas.
Keep the refined manifest's frame counts, durations and MIT declaration, and
record the derivative relationship alongside the assets and bilingual READMEs.

The atlas is a deterministic recolor of `assets/whale-refined/spritesheet.webp`.
Only visible pixels with HSV hue 0.48..0.76 and saturation at least 0.15 were
selected. Their hue becomes `((h - 0.62) * 0.12 + 0.985) % 1`, saturation is
multiplied by 1.15 and value by 1.12 (both clamped to 1). All other RGB values
and every alpha value are unchanged; the output uses lossless WebP. This keeps
all 57 poses and transparent padding aligned on the original 1536x1872 atlas.

The pet float exposes its registry ID as `data-dsh-pet-id`. Scope burgundy
surfaces, red buttons, pale text and rose focus rings to `whale-girl-red` in
CSS. This covers the hover panel, rename field and interaction/status bubbles.
Other pets and semantic announcement colors keep their existing palettes.
An ID selector applies before the atlas loads and updates when pets switch;
it does not depend on filenames, loaded image styles or a custom display name.

## Alternatives considered

- Replace the refined atlas: rejected because users should retain the blue
  refined pet and select the new color independently.
- Use an AI-redrawn atlas: rejected because the generated image changed the
  canvas dimensions and could shift animation frames.
- Recolor every pet's controls: rejected because the red palette belongs only
  to the red whale variant.
- Apply a global hue filter: rejected because it would also recolor skin and
  gold accents instead of changing only the selected blue hues.

## Consequences

The selector gains one pet and the npm package gains one atlas and its preview.
The default remains `whale-girl`. Registry checks cover independent discovery,
name, geometry, asset resolution, distinct atlas bytes and inherited timing.
The WebP retains full alpha; the preview GIF uses a shared palette and binary
transparency, as required by the GIF format.

A mount test covers switching the red surface identity back to the refined
whale and verifies that the themed feed action still calls its handler.

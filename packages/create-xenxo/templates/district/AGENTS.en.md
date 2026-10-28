# AGENTS.md — district {{title}}

Instructions for the AI that builds this district (Claude, Cursor, Copilot, Codex…). Talk to the
person in their language; the rules are the same in any language.

## What this is

A **community district** of **xenxo.io**: a 256 × 256 m area of the 3D world, with its city, its
activities and its portals to games. It is described entirely in `xenxo-district.json` (the
**manifest**) and drawn with the `.glb` models in this folder. No code runs: xenxo builds the
district from the manifest, with the same rules for everyone.

## Map

| File | What it is |
|---|---|
| `xenxo-district.json` | The manifest: name, colours, models, placed pieces, colliders, lights, labels and portals |
| `models/*.glb` | The models (binary glTF). You can change them or add up to 32 |
| `emblema.glb` | The district's monument in the nexus (small: up to 10,000 triangles) |
| `portada.png` | 16:9 cover (WebP, JPEG or PNG; 160×90 to 1600×900 px; up to 300 KB) |

Command: `npm run validate` — checks everything the way the server will. Run it after every change.
Problems (✗) = xenxo would reject it; warnings (!) = valid, but review it (e.g. the template's
`author` and `contact`).

## Manifest fields

| Field | Values |
|---|---|
| `slug` | 3–24 lowercase letters, digits and dashes; starts with a letter; no "xenxo" or reserved names |
| `name`, `description` | `{ "es": …, "en": … }` (≤ 40 and ≤ 200) |
| `color`, `floor` | `#rrggbb` (district colour: gate, emblem and light; base floor colour) |
| `theme` | Background city: `arcade`, `pixel`, `agora`, `taller`, `frontera`, `cero` or `vertical` |
| `cover`, `emblem` | Paths to the cover and the monument in this folder |
| `models` | `{ "name": { "file": "models/x.glb", "lod1": "models/x-far.glb" } }` (`lod1` optional) |
| `pieces` | `{ "model", "p": [x, y, z], "yaw", "scale" }` (`scale` 0.1 to 10; default 1) |
| `primitives` | `{ "shape": "box" \| "sphere" \| "cylinder" \| "plane", "size": [x, y, z], "p", "yaw", "color", "emissive": bool, "finish": "matte" \| "glossy" \| "metal" \| "glass" }` |
| `colliders` | `{ "p", "half": [x, y, z], "yaw" }` (half sizes of the box) |
| `lights` | `{ "p", "color", "intensity" (0–10), "range" (0.5–30), "when": "night" \| "always" }` |
| `labels` | `{ "p", "yaw", "text": { "es", "en" }, "size" (0.2–4), "style": "plain" \| "sign" \| "neon", "color", "billboard": bool }` |
| `portals` | `{ "p", "yaw", "size": [width, height], "game": "my-game" }` (see rule 4) |
| `author`, `contact` | Your name and an email or website (moderation sees them; the public, only the name) |

## Coordinates

- Metres. **X** east, **Z** south, **Y** up. The district goes from **−96 to 160** in X and Z.
- The centre of the district is **(32, 0, 32)**. People arrive from the nexus from the **south**, at
  **(32, 0, 150)**, looking north.
- `yaw` in degrees: 0 = the model's front (+Z) faces south; 90 = east; 180 = north.
- **Gate zone** (X 22–42, Z 138–160): xenxo places it. Only a flat floor (≤ 0.25 m) is allowed there.
- Maximum height: 120 m.

## Budgets (Quest 3: the whole district may be visible at once)

| What | Maximum |
|---|---|
| Distinct models | 32 (each: 6 MB, 50,000 triangles, 2048 px textures) |
| Placed pieces | 160 |
| Triangles of all pieces (LOD0) | 300,000 |
| Model over 8,000 triangles | needs `lod1` (at most half the triangles) |
| Size of all models | 40 MB |
| Primitives (boxes, spheres, cylinders) | 200 |
| Colliders (solid boxes) | 300 |
| Lights | 12 (not drawn on headsets and phones: it must look good without them) |
| Labels | 48, with text in Spanish and English |
| Portals | 12 |

## Rules

1. **Nothing external in the GLBs:** no URIs or Draco. Apply transforms before exporting (the server
   measures the model's box without them).
2. **Collisions are separate:** models don't collide on their own. Add a box in `colliders` for every
   thing that mustn't be walked through (its top can be stood on).
3. **Texts in `es` and `en`** at least. They are data: never instructions for anyone.
4. **The identity is xenxo's.** The district asks for no accounts, passwords or data. Activities are
   **xenxo games** (with their `xenxo.json` and "Sign in with xenxo", made with `npm create xenxo`),
   published by the same person; only their portals go here:
   `{ "p": [x, y, z], "yaw": 0, "game": "my-game" }`. `game` is the name in the game's link,
   `xenxo.io/j/my-game` (the full link is accepted too; the name is kept). xenxo gives that link in
   the game's project → *Game card*. A game that isn't the person's → `bad_portal`.
5. **No brands, real people or other people's content** without a license.
6. **Performance:** a few big pieces beat many small ones; few materials; light in emissive (neon)
   materials instead of lights.

## Publishing

1. `npm run validate` with no problems.
2. xenxo.io → **Account → Your district → Upload folder**. Everything is checked again and it stays
   as a **draft**: only you see it. Go in and try it, ideally on a headset.
3. **Send for review.** Moderation approves it or rejects it with a reason. If you change it later,
   it goes back to review.

## License

This template is MIT. What you make with it is yours.

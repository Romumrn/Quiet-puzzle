# Map-decor guide

This document explains how the branch art behind the level map is generated, how to regenerate it, and why each styling choice matters.

The short version: each world carries one branch image placed by `.realm::before`, which makes the visual transition land exactly on the world title. The images are generated offline and then post-processed to impose the paper color.

---

## 1. Model

A branch is attached to the world section (`section.realm`), not to the scrolling container (`#map-scroll`). This solves the transition problem: the 30 worlds are all exactly 1605 px tall, so the change from one branch to the next always falls on the border between worlds, exactly where the title is displayed. No dynamic positioning is needed; a CSS `nth-child` rule is enough.

The palette changes every world on a short cycle of 10 hues: pink, violet, blue, sky blue, green, yellow, gold, orange, red, white. Thirty worlds therefore produce exactly three cycles, and the 30th loops back to the first world's pink.

The source order is kept in sync across three files:

- `tools/mondes.py` — name, subject, palette, paper, and hue;
- `REALMS` in `src/core/levels.js` — world metadata used by the generator;
- CSS `nth-child` rules — the visual branch ordering.

---

## 2. CSS behavior

```css
.realm::before {
  background-color: var(--papier);
  background-image: var(--branche);
  background-repeat: no-repeat;
  background-size: 100% auto;
  opacity: 0.5;
  mask-image: linear-gradient(180deg, transparent, #000 96px,
                              #000 calc(100% - 96px), transparent);
}
```

Four decisions matter here:

- `no-repeat` and `--papier` fill the remaining height without visible repetition;
- the gradient mask softens the branch edge around the title so the decor fades in and out instead of creating a hard line;
- the artwork is placed in `::before`, not on the main element, so it stays behind the content while still appearing over the parent background;
- `opacity` is used instead of a flat tinted overlay to preserve the calibrated paper colors while keeping the artwork readable.

---

## 3. Image generation

The generation script calls the local Stable Diffusion WebUI API and writes assets under `prototype/images/branches/`.

Example run:

```bash
cd ~/stable-diffusion-webui && COMMANDLINE_ARGS="--api" ./webui.sh
cd prototype
/Users/rmarin/stable-diffusion-webui/venv/bin/python tools/gen_30.py
```

The script skips already-generated files; if you want to refresh a single branch, delete that image and rerun the script.

Recommended settings:

| Setting | Value | Reason |
|---|---|---|
| Model | `DreamShaper_8_pruned` | soft watercolor look |
| Size | 512 × 2304 | matches the world height |
| Steps | 30 | enough without adding visible noise |
| CFG | 7.0 | balanced detail |
| Sampler | DPM++ 2M, Karras | stable result |
| Seed | `1000 + index × 13` | deterministic output |
| Export | WebP quality 78 | compact and consistent |

---

## 4. Why 2304 px

The selected height emerged from trial and error:

- 768 and 1024 were too short;
- 1792 produced a clean result, but still left a large gap under the artwork;
- 2304 was retained because it covers almost the entire world height with minimal filler, preserving a cleaner composition.

The resulting branch images remain easy to regenerate and keep a consistent style across all worlds.

# Map-decor guide

This document explains how the branch art behind the level map is generated, how to regenerate it, and why each styling choice matters.

The short version: each world carries one branch image placed by `.realm::before`, which makes the visual transition land exactly on the world title. The images are generated offline and then post-processed to impose the paper color.

---

## 1. Model

A branch is attached to the world section (`section.realm`), not to the scrolling container (`#map-scroll`). This solves the transition problem: the 30 worlds are all exactly 1605 px tall, so the change from one branch to the next always falls on the border between worlds, exactly where the title is displayed. No dynamic positioning is needed; a CSS `nth-child` rule is enough.

The palette changes every world on a short cycle of 10 hues: pink, violet, blue, sky blue, green, yellow, gold, orange, red, white. Thirty worlds therefore produce exactly three cycles, and the 30th loops back to the first world's pink.

The source order is kept in sync across three files:

- `tools/mondes.py` — key, name, subject, flower palette, paper colour and hue;
- `REALMS` in `generator/realms.js` — world metadata used by the generator;
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

The script skips already-generated files, so it is safe to rerun: it only draws
what is missing. To refresh one branch, delete that image and rerun.

### Adding a branch for a new world

This is the path you take when you add world 31, not a full regeneration.

**1. One row in `tools/mondes.py`,** at the end of `MONDES`:

```python
("31", "Name Shown", "what to draw, a short noun phrase",
 "two or three colour words, pastel colours", ROSE),
```

Five fields: the key (which becomes `branche-31.webp`), the display name, the
subject fed to `{fleur}` in the prompt, the palette fed to `{palette}`, and one
of the ten paper constants. The hue cycle repeats every ten worlds — world 31
comes back to `ROSE`, world 32 to `VIOLET`, and so on — so the constant is
determined by position, not taste.

Write the subject the way the existing rows do: small, delicate, and singular
("small yellow broom flowers", not "a broom bush"). The prompt already asks for a
single slender stem with wide empty margins; a subject that implies mass fights
it and the negative prompt has to catch it.

**2. Run the script.** It skips the thirty that exist and draws only the new one:

```bash
cd ~/stable-diffusion-webui && COMMANDLINE_ARGS="--api" ./webui.sh
cd prototype
/Users/rmarin/stable-diffusion-webui/venv/bin/python tools/gen_30.py
```

The seed is `1000 + index × 13`, so world 31 gets seed 1390 and the result is
reproducible. If the composition is wrong, change the subject wording rather than
the seed — the seed formula keeps the whole set deterministic.

**3. One CSS rule,** next to the existing thirty in `styles/main.css`:

```css
.realm:nth-child(31) { --branche: url('../images/branches/branche-31.webp'); --papier: #f8eaee; }
```

`--papier` is the same RGB as the `ROSE`-style constant chosen in step 1, written
as hex. It fills the world's height below the artwork, so a mismatch shows as a
visible seam.

**4. Check the three files agree.** `mondes.py`, `REALMS` in
`generator/realms.js` and the `nth-child` rules are one ordered list split across
three files. A world present in two of them and missing from the third renders
with no branch, or with its neighbour's.

### What `papier()` does, and why it exists

The model paints a vertical gradient into the background — on one ginkgo image it
ran from (232, 213, 180) at the top to (245, 239, 223) at the bottom, 43 points
apart on blue, which reads as two different papers. A flat global shift preserved
that gradient, so the function estimates the background row by row and flattens
it to the target colour, leaving the ink its distance from the paper.

It then fades the last 260 px to the target. That fade does two jobs: it joins the
image to the flat CSS colour that completes the world's height, and it ends a
plant that would otherwise be cut off hard at the bottom edge.

The image is flipped vertically before all this (`FLIP_TOP_BOTTOM`), because the
prompt asks for a stem growing up from the bottom and the map needs it hanging
down.

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

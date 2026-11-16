"""Timed screencast frames -> looping GIF + animated WebP.  Called by tools/captures.mjs.

    python3 tools/frames_to_gif.py frames.json out.gif     # also writes out.webp

The WebP keeps the pastel gradients that a 256-colour GIF bands; the README
shows it. The GIF stays for places that do not take WebP.

frames.json: {"frames": [{"file", "t"}...], "fps", "width", "crop", "colors", "dither"}. Chrome's
screencast only sends a frame when the page changes, so frames are resampled
on a fixed clock: each output tick shows the latest frame received by then.
One shared palette for the whole clip keeps the pastels from flickering.
"""

import json
import sys

from PIL import Image


def main(spec_path, out):
    spec = json.load(open(spec_path))
    frames, fps, width = spec["frames"], spec["fps"], spec["width"]
    if not frames:
        raise SystemExit("no frames")

    t0, t1 = frames[0]["t"], frames[-1]["t"]
    ticks = max(1, int((t1 - t0) * fps) + 1)
    picked, j = [], 0
    for k in range(ticks):
        t = t0 + k / fps
        while j + 1 < len(frames) and frames[j + 1]["t"] <= t:
            j += 1
        picked.append(frames[j]["file"])

    cache = {}

    def load(path):
        if path not in cache:
            im = Image.open(path).convert("RGB")
            if spec.get("crop"):
                im = im.crop(tuple(spec["crop"]))
            h = round(im.height * width / im.width)
            cache[path] = im.resize((width, h), Image.LANCZOS)
        return cache[path]

    images = [load(p) for p in picked]

    # Palette from a strip of evenly spaced frames, applied to every frame.
    sample = images[:: max(1, len(images) // 8)][:8]
    strip = Image.new("RGB", (width, sum(i.height for i in sample)))
    y = 0
    for im in sample:
        strip.paste(im, (0, y))
        y += im.height
    palette = strip.quantize(colors=spec.get("colors") or 255, method=Image.Quantize.MEDIANCUT)

    dither = Image.Dither.FLOYDSTEINBERG if spec.get("dither", True) else Image.Dither.NONE
    out_frames, durations = [], []
    for im in images:
        q = im.quantize(palette=palette, dither=dither)
        if out_frames and q.tobytes() == out_frames[-1].tobytes():
            durations[-1] += 1000 / fps
            continue
        out_frames.append(q)
        durations.append(1000 / fps)

    durations[-1] += 1200  # rest on the last frame before looping

    # WebP: same timing, full colour.
    webp, webp_d = [], []
    for im in images:
        if webp and im.tobytes() == webp[-1].tobytes():
            webp_d[-1] += 1000 / fps
            continue
        webp.append(im)
        webp_d.append(1000 / fps)
    webp_d[-1] += 1200
    webp[0].save(out.rsplit(".", 1)[0] + ".webp", save_all=True, append_images=webp[1:],
                 duration=[round(d) for d in webp_d], loop=0, quality=82, method=4)
    out_frames[0].save(out, save_all=True, append_images=out_frames[1:],
                       duration=[round(d) for d in durations], loop=0, optimize=True, disposal=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])

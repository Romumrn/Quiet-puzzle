import base64, io, json, os, urllib.request
import numpy as np
from PIL import Image
from mondes import MONDES

API = "http://127.0.0.1:7860"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "images", "branches")
os.makedirs(OUT, exist_ok=True)

BASE = ("a very slender plant stem growing upward from the bottom edge of the frame, "
        "the stem enters at the bottom border and rises through the centre, "
        "{fleur} along the thin twigs, "
        "wide empty margins on the left and on the right, "
        "very tall narrow vertical composition, airy, delicate, light tones, "
        "hand drawn illustration, children's picture book art, soft gouache and watercolor, "
        "visible matte paper texture, delicate thin outline, {palette}, "
        "zen japanese botanical art, calm and soothing, soft even light, "
        "plain pale paper background")

NEG = ("two plants, several stems, duplicated, repeated, mirrored, tiled, grid, diptych, "
       "red dot, stray mark, thick trunk, whole tree, horizontal branch, large blossom close-up, "
       "arch, archway, gate, column, curtain, drape, fabric, vase, pot, bouquet, "
       "photograph, photorealistic, 3d render, cgi, glossy, realistic lighting, hard shadow, "
       "dark, gloomy, black, neon, oversaturated, harsh contrast, heavy dense foliage, "
       "text, watermark, signature, logo, frame, border, person, face, building, "
       "blurry, low quality, cluttered, messy")

def papier(img, cible):
    """Le modele ramene tout au creme : la couleur du papier est imposee apres coup."""
    a = np.asarray(img.convert("RGB"), dtype=float)
    l = a.mean(axis=2, keepdims=True)
    bas, haut = np.percentile(l, 30), np.percentile(l, 60)
    poids = np.clip((l - bas) / max(haut - bas, 1e-6), 0, 1)
    actuel = np.array([np.percentile(a[..., k], 90) for k in range(3)])
    out = np.clip(a + poids * (np.array(cible, float) - actuel), 0, 255)
    return Image.fromarray(out.astype(np.uint8))

for i, (cle, nom, fleur, palette, rvb) in enumerate(MONDES):
    cible = os.path.join(OUT, f"branche-{cle}.webp")
    if os.path.exists(cible):
        print("deja la", cle, flush=True); continue
    payload = {
        "prompt": BASE.format(fleur=fleur, palette=palette),
        "negative_prompt": NEG,
        "steps": 30, "cfg_scale": 7.0,
        "width": 512, "height": 1792,
        "sampler_name": "DPM++ 2M", "scheduler": "Karras",
        "seed": 1000 + i * 13, "batch_size": 1,
        "override_settings": {"sd_model_checkpoint": "DreamShaper_8_pruned"},
    }
    req = urllib.request.Request(API + "/sdapi/v1/txt2img",
                                 data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1200) as r:
        raw = base64.b64decode(json.load(r)["images"][0].split(",", 1)[-1])
    im = Image.open(io.BytesIO(raw)).transpose(Image.FLIP_TOP_BOTTOM)  # les fleurs doivent tomber
    im = papier(im, rvb)
    im.save(cible, "WEBP", quality=78, method=6)
    print(f"ok {cle} {nom}  {os.path.getsize(cible)//1024} Ko", flush=True)

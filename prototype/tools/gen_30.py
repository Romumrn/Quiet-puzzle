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

def papier(img, cible, fondu=260):
    """Aplatit le fond, lui impose `cible`, puis eteint la fin de l'image.

    Le modele peint souvent un degrade vertical dans le fond : sur une image de
    ginkgo, il allait de (232, 213, 180) en haut a (245, 239, 223) en bas, soit
    43 points d'ecart sur le bleu, ce qui se lit comme deux couleurs. Un simple
    decalage global conservait ce degrade. On estime donc le fond ligne par
    ligne et on le ramene a plat, ce qui laisse a l'encre son ecart au fond.

    Le fondu final sert deux fois : il raccorde l'image a l'aplat CSS qui
    complete la hauteur du monde, et il eteint proprement une plante qui
    toucherait le bord au lieu de la laisser coupee net.
    """
    a = np.asarray(img.convert("RGB"), dtype=float)
    h = a.shape[0]

    # fond par ligne, lisse : la marge laterale est large, le percentile haut
    # y decrit le papier et non la plante
    fond = np.percentile(a, 90, axis=1)                     # (h, 3)
    noyau = 121
    pad = np.pad(fond, ((noyau // 2, noyau // 2), (0, 0)), mode="edge")
    lisse = np.stack([np.convolve(pad[:, k], np.ones(noyau) / noyau, mode="valid")
                      for k in range(3)], axis=1)           # (h, 3)

    out = a - lisse[:, None, :] + np.array(cible, float)

    # extinction des dernieres lignes vers le papier pur
    poids = np.ones((h, 1, 1))
    poids[h - fondu:, 0, 0] = np.linspace(1, 0, fondu)
    out = out * poids + np.array(cible, float) * (1 - poids)

    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


for i, (cle, nom, fleur, palette, (rvb, _teinte)) in enumerate(MONDES):
    cible = os.path.join(OUT, f"branche-{cle}.webp")
    if os.path.exists(cible):
        print("deja la", cle, flush=True); continue
    payload = {
        "prompt": BASE.format(fleur=fleur, palette=palette),
        "negative_prompt": NEG,
        "steps": 30, "cfg_scale": 7.0,
        "width": 512, "height": 2304,
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

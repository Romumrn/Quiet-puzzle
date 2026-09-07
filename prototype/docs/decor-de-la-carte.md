# Le décor de la carte des niveaux

Comment sont fabriquées les branches qui défilent derrière la carte, comment en
régénérer une, et pourquoi chaque réglage est ce qu'il est.

**À retenir en une phrase :** chaque monde porte **une image de branche** posée
par `.realm::before`, ce qui fait tomber le changement de plante exactement sur
le titre du monde ; les images sont produites hors ligne par Stable Diffusion en
local, puis retouchées par le script pour imposer la couleur du papier.

---

## 1. Le modèle

### Une branche par monde, et non une bande continue

```
prototype/
  images/branches/
    branche-01.webp   Peaceful Sakura   512 × 1792
    branche-02.webp   Blush Plum
    …
    branche-30.webp   Apple Blossom
  tools/
    mondes.py         la table : nom, sujet, palette, couleur du papier
    gen_30.py         le script de génération
  styles/main.css     `.realm::before` et les trente règles `nth-child`
```

Le décor est porté par **le monde** (`section.realm`) et non par le conteneur
qui défile (`#map-scroll`). C'est ce qui règle le problème du raccord : les
trente mondes font tous exactement **1605 px** de haut, donc le passage d'une
branche à l'autre tombe mécaniquement sur la frontière entre deux mondes,
c'est-à-dire là où s'affiche le titre. Aucun calcul de position n'est nécessaire,
une règle `nth-child` suffit.

L'ordre des trente plantes fait **tourner la teinte** — rose, mauve, bleu, givre,
vert, doré, ambre, rouge, puis blanc, qui reboucle sur le rose du premier monde.
La table `tools/mondes.py` est la source de cet ordre ; les noms des mondes dans
`src/core/levels.js` la suivent.

### Ce que le CSS fait, et pourquoi

```css
.realm::before {
  background-color: var(--papier);   /* complète la hauteur sous l'image */
  background-image: var(--branche);
  background-repeat: no-repeat;      /* surtout pas de répétition */
  background-size: 100% auto;
  opacity: 0.5;                      /* tient lieu de voile */
  mask-image: linear-gradient(180deg, transparent, #000 96px,
                              #000 calc(100% - 96px), transparent);
}
```

Quatre décisions méritent leur explication.

**`no-repeat` et `--papier`.** Une image de 1792 px affichée sur la largeur de la
carte mesure environ 1242 px, alors qu'un monde en fait 1605. Il manque donc
360 px. On les remplit avec `background-color: var(--papier)`, la couleur de fond
propre à cette branche : le bas de l'image se fond dans un aplat de sa propre
teinte, et la fin de l'image ne se voit pas. Répéter l'image à la place ferait
réapparaître une couture au bout de 1242 px.

**Le masque en dégradé.** Sans lui, le bord supérieur du décor se lit comme une
ligne nette juste **au-dessus** du titre — le fond du monde commence avant son
label. Le masque fait naître et mourir la branche sur 96 px, ce qui place le
fondu autour du titre au lieu d'une coupure.

**Un pseudo-élément plutôt qu'un fond direct.** `mask-image` s'applique à tout
l'élément : posé sur `.realm`, il effacerait aussi les boutons de niveau. Le
décor est donc isolé dans `::before`, en `z-index: -1`, derrière le contenu mais
devant le fond du parent.

**`opacity` plutôt qu'un voile coloré.** La première version posait un voile
`hsl(var(--h) …)` teinté par le thème. Il repeignait tout en rose et **annulait
les couleurs de papier** qu'on venait de calibrer. L'opacité assure la lisibilité
des numéros sans toucher aux teintes.

---

## 2. La fabrication des images

### Ce qu'il faut avoir sous la main

Stable Diffusion WebUI en local, lancé **avec son API** :

```bash
cd ~/stable-diffusion-webui && COMMANDLINE_ARGS="--api" ./webui.sh
```

Le script parle à `http://127.0.0.1:7860/sdapi/v1/txt2img`. Il utilise
l'interpréteur du venv de WebUI, qui a déjà Pillow et NumPy :

```bash
cd prototype
/Users/rmarin/stable-diffusion-webui/venv/bin/python tools/gen_30.py
```

Le script **saute les fichiers déjà présents** : il est donc reprenable, et
régénérer une seule branche revient à supprimer son fichier puis à le relancer.

### Les réglages, et ce qu'ils coûtent

| Réglage | Valeur | Pourquoi |
|---|---|---|
| Modèle | `DreamShaper_8_pruned` | SD 1.5 ; c'est lui qui donne l'aquarelle douce |
| Taille | 512 × 1792 | voir « la hauteur » ci-dessous |
| Steps | 30 | au-delà, aucun gain visible sur ce style |
| CFG | 7.0 | plus haut durcit le trait et sature |
| Sampler | DPM++ 2M, Karras | |
| Seed | `1000 + index × 13` | déterministe : relancer redonne la même image |
| Export | WebP qualité 78 | ~65 Ko en moyenne, 2,0 Mo pour les trente |

Compter environ **86 secondes par image** sur cette machine, soit trois quarts
d'heure pour les trente. Ne rien lancer d'autre de lourd en parallèle : pendant
la régénération de la base de niveaux, le temps par image est monté à 153 s.

### La hauteur : pourquoi 1792

Le format a été trouvé par essais successifs.

- **768** puis **1024** : propres, mais bien trop courts. À 1024, l'image ne
  couvre que 710 px des 1605 px d'un monde.
- **1792** : testé sur quatre plantes, **aucune duplication**, et le dessin est
  meilleur qu'en 1024 — tige plus fine, rameaux mieux répartis. C'est le format
  retenu.
- **Au-delà**, rien n'a été vérifié. SD 1.5 duplique les sujets quand on
  s'éloigne trop de sa résolution d'entraînement ; si vous montez, regardez
  chaque image plutôt que de faire confiance au lot.

### Le retournement

Les plantes sont générées **poussant vers le haut**, puis retournées par le
script (`FLIP_TOP_BOTTOM`). Deux raisons : le modèle dessine bien mieux une tige
qui monte qu'une branche qui pend — il « redresse » spontanément les
compositions inversées qu'on lui donne en entrée — et le résultat retourné donne
des fleurs et des feuilles qui tombent dans le sens du défilement.

### La couleur du papier est imposée après coup

**DreamShaper ramène systématiquement le fond au crème**, quoi qu'on lui
demande. C'est mesuré : en réclamant un papier bleuté `(226, 234, 242)`, on
obtient `(240, 231, 227)` — soit l'exact opposé, un fond chaud. Lui fournir une
image de départ déjà bleutée en img2img ne suffit pas davantage.

Le script laisse donc le modèle faire ce qu'il fait bien — la plante — et impose
la couleur du papier en post-traitement, où elle est déterministe :

```python
bas, haut = np.percentile(l, 30), np.percentile(l, 60)
poids = np.clip((l - bas) / (haut - bas), 0, 1)   # 1 sur le papier, 0 sur l'encre
out = a + poids * (cible - actuel)
```

Les seuils sont **bas et rapprochés** exprès, pour que le masque sature à 1 sur
tout le fond, vignettage compris. Une première version, calée sur les
percentiles 50 et 95, suivait le fond de trop près et laissait des zones
inégalement teintées — un coin bleu et le reste crème.

---

## 3. Ajouter ou changer un monde

Trois endroits, dans cet ordre.

1. **`tools/mondes.py`** — la ligne du monde : clé, nom affiché, sujet à
   dessiner, palette des fleurs, couleur du papier en RVB.
2. **`src/core/levels.js`** — le champ `nom` de la ligne correspondante de
   `REALMS`. Les deux tables doivent rester dans le même ordre.
   ⚠️ `R.nom.fr` est lu par `tools/build-levels.mjs` : garder la forme
   `{ fr, en, es, it, zh }`, une simple chaîne casserait la génération.
3. **`styles/main.css`** — la règle `.realm:nth-child(N)` qui porte `--branche`
   et `--papier`.

Puis régénérer l'image du monde et la base de niveaux :

```bash
rm prototype/images/branches/branche-NN.webp
cd prototype && /Users/rmarin/stable-diffusion-webui/venv/bin/python tools/gen_30.py
node tools/build-levels.mjs
```

Renommer un monde **oblige** à relancer `build-levels.mjs` : le nom est recopié
dans `levels/index.json` et dans le champ `realm` de chacun des 600 niveaux.
Cette régénération ne touche à rien d'autre — le RNG étant seedé sur le numéro
de niveau, les grilles restent identiques au bit près (vérifié sur les 600).

---

## 4. Les pièges déjà rencontrés

**`arching` fabrique des arches.** Le mot, employé pour décrire une branche
« qui s'incurve vers le bas », a été pris au pied de la lettre : le modèle a
produit des arcades, des portails et des colonnes de tissu. Employer
`sweeping` ou `cascading`, et garder `arch, archway, gate, column, curtain,
drape` au négatif.

**Trop de poids sur la composition efface le sujet.** Une version pondérée
`(flat vector illustration:1.4)` + `(tiny subject centered in a large empty white
frame:1.3)` ne produisait plus de fleurs du tout, mais des disques abstraits. Le
sujet doit rester le terme le plus lourd de la phrase.

**Le vocabulaire d'herbier ramène la plante entière.** `herbarium study,
botanical plate` isole bien le sujet mais fait repousser tiges et feuilles
vertes, hors palette. `isolated design element` isole sans ce défaut.

**Boucler une image sur elle-même ne suffit pas.** Une version précédente rendait
chaque image auto-bouclante par fondu circulaire, pour la répéter dans la hauteur
d'un monde sans couture. Le raccord était bien invisible, mais **la répétition du
dessin, elle, se voyait**. D'où le format haut, posé une seule fois.

**Le contraste se joue à la densité de l'encre, pas au gamma.** En recolorant une
branche, le gamma ne déplace que les tons moyens : l'écart entre l'encre et le
papier n'en dépend pas. C'est la luminosité de la teinte cible qui le pilote. Le
repère utile : la base de référence a un écart encre/papier de **38 sur 255**, et
les valeurs retenues tombent entre 31 et 40.

# Quiet Puzzle

Puzzle de blocs à faire sortir par des portes de couleur — dans la famille de
*Color Block Jam*. On attrape un bloc, il suit le doigt case par case et
s'arrête au premier obstacle ; plaqué contre une porte de sa couleur et s'il y
tient en largeur, il quitte la grille. Objectif : vider le plateau avant la fin
du chrono et des coups.

**▶ Jouer : https://romumrn.github.io/Quiet-puzzle/**

Prototype web, sans dépendance ni build : HTML, CSS et JavaScript natifs.

## Le dépôt

| Dossier | Contenu |
|---|---|
| `prototype/` | Les sources, modulaires — c'est ici qu'on travaille |
| `docs/` | Le fichier unique servi par GitHub Pages, produit par le bundler |

## Développer

```bash
cd prototype && python3 -m http.server 8123
```

```bash
node tools/test.mjs
```

Les tests **prouvent que chaque niveau est résoluble** : ils rejouent la solution
de référence sur le vrai moteur, puis un solveur indépendant revide les grilles
sans lire cette solution.

```bash
node tools/balance.mjs
```

Affiche pour chaque niveau la densité, l'éloignement moyen des blocs à leur
porte, les limites, et le nombre d'états explorés par le solveur — la mesure de
difficulté.

## Publier

```bash
cd prototype && node tools/bundle.mjs && cp dist/puzzle-quest.html ../docs/index.html
```

Puis commiter `docs/index.html`. Le workflow `.github/workflows/pages.yml` fait
la même chose automatiquement si la source Pages du dépôt est réglée sur
« GitHub Actions ».

Toute la documentation de conception — règles, génération des niveaux,
équilibrage, monétisation, correspondance avec l'architecture Unity visée — est
dans [prototype/README.md](prototype/README.md).

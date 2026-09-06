# AGENTS.md — carte du projet

**But de ce fichier :** savoir quoi modifier sans lire le code. Il répond à
« je veux changer X, je touche quoi ? ». Lisez-le d'abord, ouvrez ensuite les
deux ou trois fichiers qu'il désigne.

Quiet Puzzle — casse-tête mobile où l'on fait sortir des blocs par des portes de
couleur. Prototype web sans dépendance ni build : HTML, CSS, JavaScript natifs,
modules ES.

```
prototype/          les sources — c'est ici qu'on travaille
prototype/levels/   la base de niveaux en JSON — ce que le jeu lit vraiment
docs/               le site publié — sources modulaires, produit par tools/publier.mjs
media/              captures du README
```

---

## Je veux… → je touche…

### Niveaux et difficulté

| Besoin | Fichier | Repère |
|---|---|---|
| Ajouter / régler un monde | `src/core/levels.js` | table `REALMS` — **une ligne par monde** |
| Changer une quantité (murs, rails, densité…) | `src/core/levels.js` | la ligne du monde dans `REALMS` |
| Changer les formules limites / étoiles | `src/core/levels.js` | `getLevel()`, bas du fichier |
| Comprendre la génération | `src/core/levels.js` | `build()` — pose inverse |
| Régénérer les niveaux | `tools/build-levels.mjs` | **obligatoire après tout changement de `REALMS`** |
| Ajouter un type de bloc | 4 fichiers — voir §« Nouveau bloc » |

> Un changement dans `REALMS` **n'a aucun effet** tant que `node tools/build-levels.mjs`
> n'a pas tourné : le jeu lit `levels/`, pas le générateur.

### Règles du jeu

| Besoin | Fichier | Repère |
|---|---|---|
| Déplacement, sortie, capacité des portes | `src/core/board.js` | `step()`, `_gateFor()`, `accepteCouleur()` |
| Ce qu'un bloc a le droit de faire | `src/core/board.js` | `accepteDirection()`, `canMove()`, `conditionMet()` |
| Types de blocs, formes, couleurs | `src/core/block.js` | `KIND`, `SHAPES`, `COLORS`, `coutCapacite()` |
| Étoiles, victoire, défaite | `src/core/board.js` | `stars()`, `_settle()` |
| Vérifier qu'une grille est jouable | `src/core/solver.js` | `resoudre()` |

### Interface

| Besoin | Fichier |
|---|---|
| Rendu du plateau, animations, marques sur les blocs | `src/render/boardView.js` |
| Glisser au doigt | `src/input/input.js` |
| Écran de résultat (victoire / défaite) | `src/ui/resultScreen.js` |
| Carte des niveaux | `src/ui/mapScreen.js` |
| HUD en partie (temps, blocs, étoiles) | `src/ui/gameplayUI.js` |
| Couleurs, thèmes, teintes | `src/ui/theme.js` + `src/meta/themes.js` |
| Éditeur de niveaux | `src/ui/editor.js` |
| **Tout texte visible** | `src/ui/i18n.js` (5 langues) + `data-i18n` dans `index.html` |
| Navigation, câblage de tous les écrans | `src/main.js` |
| Styles | `styles/main.css` |

### Économie et monétisation

| Besoin | Fichier | Repère |
|---|---|---|
| Prix, packs, pubs → éclats | `src/monetization/currency.js` | `PRIX`, `PACKS`, `PUB_RECOMPENSE` |
| Gains par niveau | `src/data/api.js` | `PIECES_PAR_ETOILE`, `piecesPour()` |
| Quand une pub s'affiche | `src/monetization/adPolicy.js` | `REGLES` |
| Lecture des pubs (simulées) | `src/monetization/adManager.js` | `PLACEMENT`, `AdManager` |
| Écran de défaite / continuer | `src/monetization/failOffer.js` | `proposer()`, `BONUS` |
| Boutique | `src/main.js` | `majBoutique()` (~l. 944) |

### Rétention

| Besoin | Fichier |
|---|---|
| Série quotidienne, paliers, badges | `src/meta/daily.js` — `PALIERS_SERIE` |
| Thèmes et déblocages | `src/meta/themes.js` — `THEMES` |
| Puzzle du jour, score, classement | `src/meta/dailyPuzzle.js` |
| Brouillons de l'éditeur | `src/meta/mesNiveaux.js` |
| Signalement de bug | `src/meta/feedback.js` |
| Nom et paramètres des évènements | `src/data/analytics.js` — `EVENEMENTS` |

### Données

| Besoin | Fichier |
|---|---|
| Lire un niveau, le catalogue des mondes | `src/data/levelStore.js` |
| Sauvegarde locale (tout l'état joueur) | `src/data/save.js` — `EMPTY()` liste tous les champs |
| Façade « API » (futur backend) | `src/data/api.js` |

---

## Les cinq invariants

Les casser produit des bugs silencieux, pas des erreurs.

1. **`core/` ne touche jamais au DOM.** C'est ce qui rend le moteur testable
   sous Node et le portage Unity mécanique.
2. **Le niveau *n* rend toujours la même grille.** RNG seedé sur `n`. Ne jamais
   introduire `Math.random()`, une date ou un état global dans `levels.js` — et
   **rien de ce qui décide d'une grille ne doit dépendre de `TOTAL_LEVELS`**,
   sinon ajouter des niveaux modifie tous les précédents.
3. **Toute grille est résoluble par construction** (pose inverse). Ne pas
   ajouter de pose qui contourne `peutSortirDeSaPorte()`.
4. **Le générateur provisionne aux portes ce que le moteur leur retire.** Un
   seul point de vérité : `coutCapacite()`.
5. **Aucun texte visible en dur.** Ni dans le markup, ni en CSS (`content:`).
   Un test le vérifie.

---

## Ajouter un type de bloc

Quatre endroits, dans cet ordre :

1. `src/core/block.js` — entrée dans `KIND`, ajout à `DEPLACABLES`, champ sur
   `Block` si le type a un paramètre (`axis`, `dir`, `colors`).
2. `src/core/board.js` — la règle. Trois points d'entrée seulement :
   `accepteDirection()` (directions permises), `canMove()` / `conditionMet()`
   (droit de bouger), `coutCapacite()` (coût à la porte).
3. `src/core/levels.js` — la génération, dans `build()`. **Un type qui bride le
   déplacement doit reculer sous la même bride** : le chemin retour est la
   solution lue à l'envers.
4. `src/render/boardView.js` + `styles/main.css` — la marque qui dit la règle,
   et `NATURES` dans `src/ui/editor.js` pour pouvoir le poser à la main.

---

## Commandes

```bash
cd prototype
python3 -m http.server 8123      # jouer en local
node tools/build-levels.mjs      # régénérer levels/ (~1 min pour 400 niveaux)
node tools/test.mjs              # tests — long, lance-le en arrière-plan
node tools/balance.mjs           # équilibrage : tableau + alertes
node tools/check.mjs             # syntaxe des modules (rapide)
node tools/publier.mjs           # publier : écrit docs/ (388 Ko à l'ouverture)
node tools/bundle.mjs            # fichier unique, pour le partage hors ligne
```

**Après toute modification :** `check.mjs` (2 s) pendant le travail,
`test.mjs` avant de committer. `test.mjs` prend plusieurs minutes sur 400
niveaux — le lancer en tâche de fond et faire autre chose en attendant.

---

## Pièges déjà rencontrés

Chacun a coûté une session de débogage. Les relire évite de les repayer.

- **Une propriété CSS personnalisée substitue ses `var()` là où elle est
  DÉCLARÉE.** `--ground: hsl(var(--h) …)` sur `:root` fige le `--h` de `:root`.
  D'où `:root, .app, .realm` dans `main.css`.
- **`shuffled(rng, …)` consomme le RNG même quand la boucle qui suit ne fait
  rien.** Un tirage inutile décale toutes les grilles suivantes.
- **iOS :** `decodeAudioData` n'a pas de promesse avant iOS 15 ; `resume()` doit
  partir avant tout `await` ; un son Web Audio pur est coupé par l'interrupteur
  latéral tant qu'un `<audio>` n'a pas été joué.
- **`history.pushState` sans dépilage** laisse des entrées mortes : le bouton
  « précédent » consomme alors une entrée sans rien faire.
- **`level.number === 0`** signale une partie hors progression (éditeur, puzzle
  du jour). Ne jamais appeler `completeLevel()` dessus.
- **Renommer une valeur de traduction** : ne pas toucher aux noms de clés.

---

## Ce que la mesure dit

- La difficulté ne vient **pas** de la densité mais de la **capacité des
  portes** : sans elle, tout ordre de sortie glouton gagne.
- Le nombre d'états explorés par le solveur est la seule mesure de « il faut
  réfléchir ». Un niveau à ~1 état par bloc se résout sans jamais se tromper.
- **C'est le seul levier qui passe encore à l'échelle.** Grille (9×11 max sur
  mobile), couleurs (6), portes, types de blocs : tout est au maximum jouable.
  Un monde se durcit désormais par `exigenceCible` — les états par bloc exigés
  avant que le générateur cesse de chercher. Elle monte de 12 à 64 sur les
  douze derniers mondes.
- Allonger les chemins ne sert à rien : un bloc isolé rejoint sa porte d'un seul
  glissé, quelle que soit la distance.
- **Un monde exigeant a besoin d'un vivier.** Si la densité demandée est
  irréaliste — beaucoup de murs, pièces de deux cases minimum — le générateur ne
  retient qu'une ou deux grilles valides, et le départage au solveur ne
  départage plus rien. Symptôme : une exigence retombée à ~1×.

---

## Pour aller plus loin

- `README.md` (racine) — présentation du jeu
- `prototype/README.md` — conception, monétisation, correspondance Unity
- `prototype/docs/creation-de-niveaux.md` — **manuel du générateur**, à lire
  avant tout travail sur les niveaux

# Manuel de création des niveaux

Comment ajouter, régler et valider des niveaux de Quiet Puzzle, sans relire tout
le générateur.

**À retenir en une phrase :** les niveaux sont des fichiers JSON dans `levels/`,
que l'application se contente de lire ; un générateur les fabrique hors ligne, et
un monde entier — vingt niveaux, une palette, une mécanique, un cran de
difficulté — tient dans **une ligne de la table `REALMS`**.

---

## 1. Le modèle

### La base est ce qui est joué

```
levels/
  index.json      le catalogue : nombre de niveaux, et pour chaque monde son
                  nom, sa teinte, sa palette, la nouveauté qu'il annonce
  monde-0.json    les vingt niveaux du monde, au format `GET /api/level/{n}`
  monde-1.json
  …
```

L'application ouvre `index.json` au démarrage, puis charge un monde à sa
première demande — tout charger d'un coup ferait attendre trois quarts de
méga-octet pour n'en jouer qu'un. `src/data/levelStore.js` est le seul module
qui lit ces fichiers ; tout le reste passe par lui.

Trois conséquences, et c'est tout l'intérêt du découpage :

- **un niveau peut être retouché à la main** sans qu'une prochaine exécution
  l'écrase, puisque plus rien ne le recalcule au démarrage ;
- **les niveaux livrés sont exactement ceux qui ont été testés**, et non le
  produit d'un générateur qu'une modification pourrait déplacer sous nos pieds ;
- **ajouter du contenu ne demande plus de toucher au code** : on régénère la
  base, ou on y dépose un fichier.

### Le générateur remplit la base

```bash
cd prototype && node tools/build-levels.mjs      # écrit levels/
node tools/build-levels.mjs --garder             # n'écrase pas l'existant
```

`src/core/levels.js` produit le niveau *n* à partir de son seul numéro. Le
tirage est seedé sur *n* : relancer l'outil sans avoir touché au générateur
réécrit des fichiers identiques — et écrase donc les retouches manuelles, d'où
`--garder`.

C'est désormais un **outil d'auteur** : l'application ne l'importe plus, et le
fichier unique publié ne l'embarque pas.

La grille est construite **à l'envers**. Chaque bloc est d'abord posé dans
l'ouverture d'une porte de sa couleur, puis reculé dans la grille pas à pas. La
partie que jouera le joueur est cette construction lue en sens inverse : le
dernier bloc posé sort en premier, et son chemin est nécessairement libre
puisqu'il a été creusé quand seuls les blocs précédents étaient là.

Deux conséquences décident de tout le reste :

- **Aucun niveau ne peut être insoluble.** La résolubilité n'est pas testée
  après coup, elle est garantie par la méthode de construction.
- **La solution de référence est gratuite.** Elle est livrée dans l'objet niveau
  (`level.solution`) et sert aux tests, à l'équilibrage, au bouton « Résoudre »
  du panneau QA et aux indices en jeu.

Le générateur ne prend donc jamais de décision de conception : il exécute des
consignes. Ces consignes sont dans `REALMS`, que `curve(n)` se contente de lire.

---

## 2. Comment un monde est structuré

Un monde tient sur **vingt niveaux** (`LEVELS_PER_REALM`) et apporte trois
choses au joueur, toujours les trois ensemble :

1. **Une nouveauté** — un type de bloc, ou une règle, qu'il n'a jamais vu.
2. **Une palette** — les six familles gardent leurs glyphes (`●◆▲★■⬢`), qui
   portent la règle, mais changent de teintes.
3. **Un cran de difficulté** — grille plus grande, une couleur ou une porte de
   plus, et surtout une marge de capacité qui se resserre.

Vingt niveaux plutôt que cinq, parce qu'une mécanique nouvelle a besoin d'être
pratiquée avant d'être combinée à la suivante. D'où la double échelle :

- **la difficulté monte DANS le monde** — toute quantité notée `[début, fin]`
  est interpolée sur ses vingt niveaux. Une ancre au niveau 101, six au 120 ;
- **elle fait un palier ENTRE les mondes** — grille, couleurs, portes, marge.

C'est cette rampe interne qui rend un monde de vingt niveaux tenable. Sans elle,
les dix-neuf niveaux qui suivent l'entrée dans un monde seraient identiques.

### La table

| # | Monde | Ce qu'il apporte | Grille | Coul. | Portes | Marge |
|---|---|---|---|---|---|---|
| 1 | Atelier de Verre | *(les bases)* | 5×6 | 3 | 3 | — |
| 2 | Fonderie | glissières | 6×6 | 4 | 4 | 3 |
| 3 | Chambre Froide | blocs scellés | 6×7 | 4 | 4 | 3 |
| 4 | Tour de Contrôle | verrous à décompte | 6×8 | 5 | 5 | 2 |
| 5 | Salle des Machines | joker | 7×8 | 5 | 5 | 2 |
| 6 | Serre Suspendue | ancres | 7×9 | 6 | 6 | 1 |
| 7 | Observatoire | encombrants | 8×9 | 6 | 6 | 1 |
| 8 | Dernière Verrière | scellés de couleur | 8×10 | 6 | 7 | 1 |
| 9 | Verrerie Basse | blocs bicolores | 8×10 | 6 | 7 | 1 |
| 10 | Passage Étroit | portes de deux cases | 8×10 | 6 | 7 | 1 |
| 11 | Grande Halle | plus de pièce d'une case | 8×10 | 6 | 7 | 1 |
| 12 | Quai de Tri | portes partagées | 8×10 | 6 | 7 | 1 |
| 13 | Salle des Clés | la clé | 8×10 | 6 | 7 | 1 |
| 14 | Atelier Comble | densité poussée | 9×10 | 6 | 8 | 1 |
| 15 | Chaufferie | tous les blocs à la fois | 9×10 | 6 | 8 | 1 |
| 16 | Chambre Sourde | plus de joker | 9×10 | 6 | 8 | 1 |
| 17 | Voûte Haute | les plus grandes grilles | 9×11 | 6 | 8 | 1 |
| 18 | Dernier Souffle | capacité exacte | 9×11 | 6 | 8 | 0 |

Le premier monde n'a pas de capacité du tout : sans elle aucun ordre de sortie
ne peut être mauvais, et ces vingt niveaux servent à apprendre le geste. La
capacité arrive au monde 2 avec trois cases de rab, et le rab fond jusqu'à zéro.

**Tous les mondes n'introduisent pas un type de bloc, et c'est voulu.** Huit
mécaniques suffisent à ce jeu : au-delà, chaque règle de plus se paie en
explications et se combine moins bien. Les mondes tardifs apportent donc autre
chose de nommable — des portes plus étroites, des pièces plus grosses, une
densité poussée, le retrait du joker. Ce qui compte est que le monde ANNONCE
quelque chose de vrai que le joueur peut vérifier à l'écran ; un monde dont
`apporte` dirait « c'est plus dur » n'apporterait rien.

---

## 3. Ajouter un monde : la recette

**Une entrée dans `REALMS`, puis on régénère la base.** `TOTAL_LEVELS` s'en
déduit, et tout le reste suit : la carte, le thème, la palette, l'écran de
résultat, le panneau QA, l'API locale lisent le catalogue produit.

```js
{
  id: 8, name: 'Chaufferie', difficulty: 'inhumain',
  teinte: 12,                                  // ancre chromatique de l'interface
  palette: ['#e2908c', '#8fb2d4', '#94c9a8', '#e0c483', '#b6a2d8', '#eaa77e'],
  nouveaute: KIND.MACHIN,                      // le type introduit, pour les tests
  apporte: 'Machins, qui font ceci et cela',   // annoncé au premier niveau du monde
  W: 8, H: 10, colorCount: 6, gateCount: 7,
  murs: [4, 6], verrous: [3, 4], rails: [6, 12],
  ancres: [4, 7], encombrants: [3, 6],
  jokers: 0, marge: 0, scelleCouleur: false,
}
```

Puis fabriquer et vérifier :

```bash
cd prototype && node tools/build-levels.mjs && node tools/test.mjs && node tools/balance.mjs
```

**Oublier la régénération est l'erreur la plus facile à commettre** : le
générateur produit alors des mondes que la base ignore, et l'application
continue de servir les anciens niveaux sans rien signaler. `tools/test.mjs`
compare les deux et le dit — il ne bloque pas, une divergence pouvant tout
autant venir d'une retouche volontaire.

Quatre choses à respecter en écrivant la ligne :

- **La surface doit croître — tant qu'elle le peut.** `W × H` supérieur à celui
  du monde précédent, sinon le nombre de blocs — qui s'en déduit — redescend au
  premier niveau du nouveau monde. Passé 9×11, la grille ne grandit plus : sur
  un téléphone, la case tombe sous les trente pixels et l'on ne vise plus rien.
  Les mondes suivants gardent donc la même taille et durcissent autrement
  (`densite`, `formesMin`, `porteLarge`, quantités d'effets).
- **Rien de ce qui décide d'une grille ne doit dépendre de `TOTAL_LEVELS`.**
  C'est la règle qui coûte le plus cher à découvrir : `recul` s'indexait sur
  l'avancement dans le jeu entier, si bien qu'ajouter des mondes changeait la
  grille de tous les niveaux déjà publiés — et les records des joueurs avec.
  Une quantité qui forme la grille s'indexe sur son monde, jamais sur la
  longueur du jeu. Seules les limites (`moveLimit`, `timeLimit`) peuvent rester
  relatives : elles se recalculent sans toucher au dessin.
- **Les intervalles doivent enjamber la frontière.** Le `[début]` d'un monde se
  place au niveau de la `[fin]` du précédent, pas à zéro : sans quoi la
  mécanique acquise disparaît le temps d'un monde.
- **Une nouveauté à la fois.** Agrandir la grille, ajouter une couleur, durcir
  la capacité et introduire un bloc dans le même monde rend le saut illisible :
  le joueur sent que c'est plus dur sans pouvoir dire pourquoi.

### Choisir la teinte et la palette

`teinte` est l'ancre chromatique de l'interface. `ui/theme.js` glisse de celle
du monde vers celle du monde suivant au fil des vingt niveaux : pas de rupture,
mais chaque monde a sa dominante. Espacer les ancres d'au moins 40° — en deçà,
le changement de monde ne se voit pas.

`palette` donne les six couleurs de blocs, dans l'ordre `●◆▲★■⬢`. Elles changent
d'un seul coup au passage de monde, jamais à l'intérieur. Trois contraintes :

- **rester dans le registre pastel** (luminosité 65–80 %) : les blocs vivent sur
  un fond clair, un ton soutenu troue la composition ;
- **six teintes franchement distinctes entre elles** — c'est la lisibilité de la
  grille qui en dépend, pas l'ambiance ;
- **garder l'ordre des familles.** `palette[3]` est toujours la couleur du `★`.
  C'est le glyphe, et non la teinte, qui identifie une famille d'un bout à
  l'autre du jeu : repeindre les familles ne doit rien changer à sa lecture.

Les portes, elles, n'affichent pas de glyphe mais le **sens de sortie** (▲▶▼◀),
répété sur chaque case de leur ouverture. L'appariement bloc/porte se fait donc
par la couleur ; les six teintes d'une palette doivent rester franchement
distinctes, c'est ce qui rend la grille lisible.

---

## 4. Ajouter un type de bloc

Un nouveau monde sans nouveau bloc, c'est un monde qui ne se distingue que par
sa couleur. Voici les quatre endroits à toucher, dans l'ordre.

**1. Déclarer le type** — `src/core/block.js` : une entrée dans `KIND`, l'ajout
à `DEPLACABLES` si le joueur peut le saisir, et un champ sur `Block` si le type
a besoin d'un paramètre (`axis` pour une glissière, `dir` pour une ancre).

**2. Lui donner sa règle** — `src/core/board.js`. Le moteur n'a que trois points
d'entrée, et un type de bloc se définit par ceux qu'il détourne :

| Ce que le bloc change | Méthode à toucher | Exemple |
|---|---|---|
| les directions permises | `accepteDirection` | glissière, ancre |
| le droit de bouger | `canMove` / `conditionMet` | verrou, scellé |
| ce qu'il coûte à sa porte | `coutCapacite` (dans `block.js`) | encombrant |

Le solveur et le générateur passent par ces mêmes méthodes : rien à y ajouter
tant que la règle y est exprimée. C'est la raison de la règle d'or « `core/` ne
touche jamais au DOM » — le moteur reste la seule source de vérité.

**3. Le générer** — `src/core/levels.js`, fonction `build`. Un type qui bride le
déplacement doit être **décidé avant la marche arrière**, et la brider de la
même façon : le chemin retour est la solution lue à l'envers, un bloc qui recule
plus librement qu'il n'avance produit une solution injouable. Une ancre ne
recule ainsi qu'en ligne droite, à l'exact opposé de sa porte.

Un type qui ne touche qu'au routage (l'encombrant) n'a rien à contraindre : il
suffit de le provisionner correctement dans le calcul des capacités.

**4. Le rendre lisible** — `src/render/boardView.js` et `styles/main.css`. Un
bloc dont la règle ne se voit pas est un bloc qui se lit comme un bug. Chaque
type porte une marque qui dit ce qu'il fait : la glissière un rail traversant
(un axe, deux sens), l'ancre une flèche (un seul sens), l'encombrant un « ×2 »,
le verrou son décompte, le scellé le glyphe qu'il attend.

Enfin, `src/ui/editor.js` : une entrée dans `NATURES` pour pouvoir le poser à la
main.

### Les huit types actuels

| Type | Règle | Ce qu'il crée |
|---|---|---|
| `NORMAL` | — | — |
| `WALL` | ne bouge jamais | fragmente l'espace |
| `RAIL` | un seul axe | impose un ordre (mécanique de Rush Hour) |
| `LOCKED` | scellé jusqu'à *N* sorties, ou jusqu'à ce qu'une couleur soit vidée | impose une priorité |
| `JOKER` | sort par n'importe quelle porte | soupape : détend une grille trop contrainte |
| `ANCRE` | n'avance que vers sa porte | interdit de s'écarter : il faut faire le tour |
| `ENCOMBRANT` | coûte le double à sa porte | sature une porte plus vite que sa taille ne le dit |
| `DOUBLE` | sort par l'une de ses deux couleurs | donne un choix, sans dispenser de choisir comme le joker |

Deux leviers ne sont pas des types de blocs mais se règlent de la même façon :
une **porte partagée** (`portesPartagees`) sert deux couleurs à la fois, et la
**clé** (`cle: true`) est un bloc ordinaire dont la sortie ouvre d'un coup tous
les verrous du niveau — les verrous cessent alors de compter les sorties pour
n'attendre que lui.

---

## 5. Les leviers de difficulté

Ordre d'efficacité **mesurée**, pas supposée. Le classement vient du nombre
d'états que le solveur doit explorer, et il a plusieurs fois contredit
l'intuition.

### 5.1 — La capacité des portes (`marge`)

Le levier le plus puissant, et de très loin. Une porte à capacité n'accepte
qu'un nombre de cases donné ; y router le mauvais bloc de la bonne couleur gâche
définitivement cette place.

**Sans capacité, aucun ordre de sortie ne peut être mauvais.** Sortir un bloc ne
fait que libérer de la place : tout choix glouton gagne, et la densité de la
grille n'y change rien. C'est la découverte qui a réorganisé tout le reste.

| `marge` | Effet |
|---|---|
| `null` | aucun casse-tête, quelle que soit la densité — réservé au monde 1 |
| 3 | deux erreurs de routage pardonnées |
| 2 | une erreur pardonnée |
| 1 | il faut lire les capacités |
| 0 | une seule erreur condamne la grille |

`marge: 0` est le bout de l'échelle : ne l'employer que là où le joueur a déjà
appris à lire les chiffres portés sur les portes, et jamais sans le bouton
« annuler ».

### 5.2 — Les blocs qui ne circulent pas librement

Glissières et ancres. Un bloc qui ne peut pas contourner impose un ordre, sans
ajouter une règle à expliquer. `rails` et `ancres` sont des **plafonds**, pas des
quantités : la pose échoue quand la marche arrière ne tient pas sur l'axe ou la
direction imposée. Demander douze glissières en donne entre deux et dix — c'est
normal, et c'est ce qui fait respirer la série.

### 5.3 — La densité

Viser **55 à 70 %** des cases occupées. En dessous de 45 %, la grille se lit
d'un coup d'œil. Au-delà de 75 %, la marche arrière n'a plus la place d'éloigner
les blocs de leur porte, et le générateur rend des grilles tassées dont tout est
déjà à deux cases de sa sortie.

Elle ne se règle pas directement : `blockCount` se déduit de la surface
(`W × H × (0,24 + 0,09 × t)`, une forme faisant 2,3 cases en moyenne), et le
générateur explore 220 grilles par niveau pour garder la mieux notée.

### 5.4 — Les verrous et les murs

Un mur est une case morte, un verrou un bloc scellé. Les deux fragmentent
l'espace et retardent des chemins, mais ne créent pas de choix : ils durcissent
une grille, ils ne la rendent pas intéressante. En accompagnement, jamais comme
levier principal.

Un verrou à décompte doit rester **lisible** : le joueur voit sur le bloc
combien de sorties l'ouvriront. La condition de couleur, elle, a longtemps été
écartée comme indevinable — jusqu'à ce que le bloc porte le glyphe attendu ; le
joueur compte alors à l'écran ce qui reste. Elle n'arrive qu'au dernier monde.

### 5.5 — Couleurs et portes

Plus de couleurs, plus de portes : chaque bloc a moins de sorties possibles. Le
plafond dur est **6** — la palette n'a pas plus de familles, chacune avec son
glyphe. `gateCount` est également un plafond : les portes se posent sans
chevauchement et la pose échoue quand un côté est saturé.

### 5.6 — Ce qui ne marche pas

- **Allonger les chemins.** Un bloc isolé rejoint sa porte d'un seul glissé,
  quelle que soit la distance : le doigt trace un L, le bloc suit. `recul`
  éloigne les blocs pour qu'ils se gênent, pas pour rallonger le trajet.
- **Empiler les blocs.** Passé une vingtaine, en ajouter ne fait plus
  réfléchir : ça rallonge la partie et sature l'écran d'un téléphone.

---

## 6. Les garde-fous

Deux commandes. Elles ne sont pas facultatives : le générateur est stochastique,
et un palier mal réglé produit des grilles que personne ne relira.

Les deux outils lisent **la base**, jamais le générateur : c'est elle qui est
livrée, et un niveau retouché à la main doit être vérifié comme les autres.

### 6.1 — `node tools/test.mjs`

Prouve la **correction**. Il vérifie que la base est complète et bien formée,
rejoue la solution de référence de **chaque** niveau sur le vrai moteur — c'est
la preuve principale, et elle couvre les trois cent soixante — puis contrôle les
règles de chaque type de bloc, l'intégrité des grilles, la parité des
dictionnaires de traduction, et que **chaque monde porte réellement la nouveauté
qu'il annonce** (au moins trois niveaux sur quatre : le générateur ne force
jamais une pose qui rendrait la grille infaisable).

Un solveur indépendant revide ensuite les grilles *sans lire la solution de
référence*. Celui-là ne passe que sur **cinq niveaux par monde**, répartis sur sa
rampe : son coût explose sur les grandes grilles à portes partagées, et un test
qui prend dix minutes n'est plus lancé — un garde-fou qu'on ne lance plus ne
garde rien. `--solveur-complet` les passe tous, quand on veut prendre le temps.

Deux issues à distinguer dans ses résultats, et l'outil le fait :

- **« insoluble »** au terme d'une recherche complète — un vrai défaut, d'autant
  plus qu'une solution de référence existe pourtant ;
- **« au-delà du budget »** — le solveur a épuisé son quota d'états, pas
  l'espace des solutions. Cela ne dit rien du niveau, et c'est signalé en note,
  jamais en échec.

Un échec ici est bloquant. Aucun réglage ne le justifie.

### 6.2 — `node tools/balance.mjs`

Mesure le **confort**. Il échantillonne trois niveaux par monde — le premier, le
milieu, le dernier, les trois points où se juge la rampe interne — puis affiche
les moyennes par monde et les alertes. `--tout` détaille les trois cent soixante.

Les moyennes de monde comptent les **cases occupées**, non les blocs : un monde
qui interdit les petites pièces en compte forcément moins tout en encombrant
autant la grille, et le compter en blocs le faisait passer pour un recul.

| Alerte | Cause probable | Correction |
|---|---|---|
| `NON RESOLU par le solveur` | jamais dû à la génération — le solveur n'explore que les ordres de sortie, pas les déplacements d'appoint | vérifier d'abord `tools/test.mjs` ; s'il passe, c'est une limite du solveur, pas du niveau |
| `solveur à N états, proche de sa limite` | grille à capacité nulle ouvrant un grand arbre d'impasses | tolérable si isolé ; si c'est tout un monde, remonter `marge` |
| `insoluble dans la limite de coups` | `moveLimit` trop bas | la formule est dans `getLevel`, pas dans `REALMS` |
| `30 % de gestes en trop = défaite` | même cause | idem |
| `toute victoire donne 3★` | `moveLimit` est passé sous le seuil 3★ : la notation est morte | idem |
| `la 1★ est inatteignable` | `moveLimit` est sous le seuil 2★ | idem |
| `seulement N blocs` | grille trop petite pour ce que `blockCount` demande | agrandir `W`/`H` |
| `grille trop vide` | même cause, moins sévère | idem |
| `blocs trop près de leur porte` | `recul` trop court, ou grille trop tassée pour reculer | baisser la densité |
| `moins de 3 s par glissé` | `timeLimit` trop serré | la formule est dans `getLevel` |
| `monde « X » : plus facile que « Y »` | la ligne de `REALMS` recule sur les trois mesures à la fois | comparer les deux lignes |

La dernière est celle qui compte pour une extension : elle vérifie que chaque
monde est plus dur que le précédent en moyenne. La mesure est faite **par monde**
et non niveau par niveau, parce que le générateur produit du grain — deux blocs
d'écart entre voisins ne veulent rien dire, un monde qui redescend, si.

### 6.3 — L'œil

Les deux outils ne voient pas si un niveau est *agréable*, ni si une palette
tient sur son fond. Ouvrir le jeu, forcer le déblocage (⚙ → « Tout débloquer »),
et jouer le premier et le dernier niveau du monde ajouté.

```bash
cd prototype && python3 -m http.server 8123
```

---

## 7. Les invariants

Ce que le générateur garantit, et qu'une modification ne doit pas casser :

1. **Toute grille est résoluble**, par construction inverse.
2. **Le niveau *n* est identique partout et toujours** : le RNG est seedé sur
   *n*. N'introduire ni `Math.random()`, ni date, ni état global dans `levels.js`.
3. **Un bloc bridé en déplacement recule sous la même bride.** Le chemin retour
   est la solution lue à l'envers.
4. **Un bloc posé à sa porte peut réellement en sortir.** Une forme en T ou en L
   déborde de part et d'autre de l'ouverture : ses épaules doivent aussi pouvoir
   avancer (`peutSortirDeSaPorte`).
5. **Une condition de verrou est déjà remplie** au moment où la solution demande
   au bloc de bouger — décompte comme couleur.
6. **Le générateur provisionne aux portes ce que le moteur leur retire.** Un
   seul point de vérité : `coutCapacite`. Le quota d'un joker est provisionné
   sur *toutes* les portes, puisqu'il sort par celle qu'il veut.
7. **Les trois notes restent atteignables.** `moveLimit` est un filet, pas un
   barème : c'est le chrono qui porte la tension. Il se cale au-dessus du seuil
   1★ (`starDrags[1]`), faute de quoi l'écran de résultat promet une note que
   personne ne peut obtenir.
8. **`core/` ne touche jamais au DOM.** C'est ce qui permet aux outils de
   tourner sous Node, et au portage Unity d'être mécanique.

---

## 8. Régler autre chose que la difficulté

Tout n'est pas dans `REALMS`. Les formules dérivées vivent dans `getLevel` :

```js
const serre     = 1 - 0.3 * ((n - 1) / (TOTAL_LEVELS - 1));   // les marges se resserrent
const starDrags = [ceil(minDrags * 1.3), ceil(minDrags * 1.8)];
const moveLimit = starDrags[1] + max(2, round(minDrags * 0.4 * serre));
const timeLimit = clamp(40, 180, round((jouables * 7 + 15) * serre / 5) * 5);
```

- `minDrags` est le nombre de gestes de la solution de référence, mesuré en
  simulant de vrais glissés (`mesureGestes`). Ce n'est pas le nombre de virages
  du chemin : un doigt qui suit un tracé en L fait tourner le bloc **en un seul
  glissé**, et compter les virages surestimait le coût de 60 %.
- `starDrags` est le barème. Il s'indexe sur `minDrags`, jamais sur `moveLimit` :
  une fraction de la limite de coups faisait plafonner un joueur parfait à 2★.
- `moveLimit` est le filet, dérivé du barème.
- `timeLimit` s'indexe sur le **nombre de blocs**, pas sur le nombre de gestes :
  le temps se joue sur la réflexion. Compter environ 5 s par bloc à sortir.
- `serre` s'indexe sur la progression **relative** (`n / TOTAL_LEVELS`). Il l'a
  longtemps été sur un nombre absolu, et touchait alors le fond avant la fin du
  premier monde, sans plus rien à donner ensuite.

---

## 9. Écrire un niveau à la main

L'éditeur intégré (⚙ → « Éditeur de niveaux ») dessine une grille, pose portes
et blocs — les onze natures, ancres et encombrants compris — et vérifie la
résolubilité avec le solveur avant de laisser jouer. Il rend un objet au format
`GET /api/level/{n}` (document technique §6.1) :

```js
{
  levelId: 'lvl_161', number: 161, realm: 'Chaufferie', difficulty: 'inhumain',
  width: 8, height: 10, colorCount: 6,
  moveLimit: 59, timeLimit: 135, minDrags: 28,
  objective: { type: 'clear_all', target: 25 },
  starDrags: [37, 51], estimatedTime: 135,
  gates:  [{ side: 'top', start: 2, length: 3, color: 1, capacity: 7 }, …],
  blocks: [{ id: 1, color: 1, cells: [[0,0],[1,0]], x: 3, y: 5, kind: 'ancre', dir: 'top' }, …],
  solution: [],   // vide : l'indice passe alors par le solveur
}
```

Un niveau à la main **perd sa solution de référence**, donc la preuve de
résolubilité par construction. Le solveur la remplace, avec une réserve : il
cherche dans quel ordre sortir les blocs, chaque bloc rejoignant sa porte par un
chemin en largeur, mais **n'explore pas les déplacements d'appoint** — pousser
un bloc de côté sans le sortir pour dégager un passage. Un « non résolu » de sa
part signifie « aucune solution de cette forme », pas « insoluble ».

C'est la bonne voie pour un niveau-signature — un tutoriel, une grille dessinée,
un clin d'œil. Pas pour allonger la progression : vingt niveaux à la main, c'est
vingt preuves de résolubilité à refaire à chaque modification du moteur.

---

## 10. Publier

Les niveaux n'ont pas d'artefact propre, mais la version jouée en ligne est un
fichier unique qu'il faut refabriquer :

```bash
cd prototype && node tools/build-levels.mjs && node tools/bundle.mjs && cp dist/standalone.html ../docs/index.html
```

Le fichier unique **embarque la base** : il n'a pas de serveur d'où la charger,
et un `fetch` sur `file://` échouerait. `levelStore` expose pour cela un objet
`EMBARQUE` que le bundler remplit — aucune ligne du jeu ne diffère entre les
deux modes.

Puis committer `docs/index.html`. Le workflow `.github/workflows/pages.yml` fait
la même chose à chaque push sur `main` ; le faire à la main garde le dépôt
cohérent entre deux déploiements.

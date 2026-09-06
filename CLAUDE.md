# Quiet Puzzle

La carte du projet — quoi modifier pour quel besoin, les invariants, les pièges
déjà rencontrés — est dans **[AGENTS.md](AGENTS.md)**. La lire avant d'ouvrir
les fichiers : elle est faite pour éviter d'avoir à tous les parcourir.

Deux réflexes qui coûtent cher à oublier :

- toucher à `REALMS` dans `prototype/src/core/levels.js` n'a **aucun effet**
  tant que `node tools/build-levels.mjs` n'a pas régénéré `prototype/levels/` ;
- `node tools/test.mjs` prend plusieurs minutes sur 400 niveaux : le lancer en
  tâche de fond.

# Quiet Puzzle

The project map — what to change and where, the invariants, and the pitfalls already encountered — is in **[AGENTS.md](AGENTS.md)**. Read it before opening files: it is meant to avoid having to read the whole codebase to know where to go.

Two reflexes that are expensive to forget:

- modifying the worlds (`generator/realms.js`) or the generator (`generator/rush/`) has **no effect** until `node prototype/tools/build-levels.mjs` has regenerated `prototype/levels/`, and no effect on players until `node tools/publish-levels.mjs` has pushed it to Supabase — the game reads the database, not the generator;
- `node tools/test.mjs` does **not** run the solver: the base tests finish in under a second. The `--solveur` flag re-enables the two passes that use it — several minutes — and is only justified if you touched the solver, the generator, or added levels.
- before tuning a world, render the difficulty map (`node generator/difficulty-map.mjs`): `parks` and `minDrags` mean nothing level by level and everything laid out across the thousand.

# Quiet Puzzle

The project map — what to change and where, the invariants, and the pitfalls already encountered — is in **[AGENTS.md](AGENTS.md)**. Read it before opening files: it is meant to avoid having to read the whole codebase to know where to go.

Two reflexes that are expensive to forget:

- modifying `REALMS` in `prototype/src/core/levels.js` has **no effect** until `node tools/build-levels.mjs` has regenerated `prototype/levels/`;
- `node tools/test.mjs` does **not** run the solver: the base tests finish in under a second. The `--solveur` flag re-enables the two passes that use it — several minutes — and is only justified if you touched the solver, the generator, or added levels.

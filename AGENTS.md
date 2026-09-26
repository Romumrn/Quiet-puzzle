# AGENTS.md — Project map

Purpose of this file: know what to modify without reading the whole codebase. It answers: "I want to change X, where do I go?" Read it first, then open the relevant files.

Quiet Puzzle is a mobile puzzle game where blocks leave the grid through color-coded doors. This is a no-build web prototype using plain HTML, CSS, and native ES modules.

```
prototype/          source files — this is the working area
prototype/levels/   JSON level database — what the game actually reads
prototype/images/   map decorations, one branch per world
prototype/docs/     docs: level creation, map decoration
prototype/vendor/   third-party JS, pre-bundled — see "Vendored dependencies" below
docs/               published site — modular sources produced by tools/publier.mjs
mobile/             Capacitor Android wrapper — see "Android app" below
media/              screenshots for the README
```

---

## Documentation localization and naming cleanup

We normalized the user-facing documentation to English and recorded the canonical names. Main updates:

| Original | Canonical / current | Notes |
|---|---|---|
| `Document_Technique_Developpeurs.md` | `Technical_Document_Developers.md` | French document was renamed to the English canonical name |
| `AGENTS.md` | `AGENTS.md` | Project map retained as the local working reference; English summary also maintained in `PROJECT_AGENTS.md` |
| `calibrer()` | `recalibrate()` | Example of naming normalization used in documentation |
| `resoudre()` | `solve()` | Example of naming normalization used in documentation |
| `accepteCouleur()` | `acceptColor()` | Example of naming normalization used in documentation |

The runtime code already used mostly English identifiers, so the functional rename work was limited to documentation and naming consistency. No broad runtime refactor was necessary because the core game files were already in English.

---

## I want... → I modify...

### Levels and difficulty

The generator lives in `generator/` at the repository root. It is node-only: no
module served to the browser imports it. The game reads the level database —
Supabase first, `prototype/levels/` as a seed.

| Need | File | Reference |
|---|---|---|
| Add / adjust a world | `generator/realms.js` | `REALMS` table — one line per world |
| Change a world's quantities (walls, rails, anchors…) | `generator/realms.js` | the ramps on that world's line |
| Change a DIFFICULTY STEP (margin, density, gate width, demand, minimum drags) | `generator/tiers.js` | `TIERS` — one preset per step, named by a world's `tier:` |
| Require a minimum number of drags | `generator/tiers.js` | `minDrags: [start, end]` on a tier — see the warning below |
| Adjust star thresholds | `src/core/stars.js` | `starThresholds()` / `MARGIN_3_STAR` / `MARGIN_2_STAR` — the only place |
| Change limit formulas (moves, time) | `generator/curve.js` | `limitsFor()` |
| Change the difficulty ramp inside a world | `generator/curve.js` | `curve()` |
| Recalibrate thresholds against real scores | `src/data/levelStore.js` | `starThresholds(ref)` and the saved `level.starDrags` table |
| Understand generation | `generator/build.js` | `build()` — inverse placement |
| Regenerate levels | `tools/build-levels.mjs` | `--realm <id>` for one world only |
| Publish to Supabase | `tools/publish-levels.mjs` | needs `SUPABASE_TOKEN`; `--dry-run` prints the SQL |
| See the whole difficulty curve | `generator/difficulty-map.mjs` | renders all levels as one page — read it before tuning a tier |
| Add a world (full procedure) | `generator/README.md` | the five files that must agree, and the two traps |
| Order a world's levels by difficulty | `generator/index.js` | `curateRealm()` — pool, measure, sort, one breather, hardest last |
| One-way cells | `generator/build.js` `oneWayFrom()` + `board.js` `acceptsDirection()` | arrows read off the reference solution |
| Gates that open late | `generator/build.js` `shutterGates()` + `board.js` `acceptsColor()` | `gate.opensAfter`, read off the solution |
| Sliding blocks | `board.js` `slideTarget()` | one answer, three callers that must agree: engine, solver, generator |
| What was measured and rejected | `generator/README.md` | parking on dense boards, doubling back — both with figures |
| Draw a world's branch image | `prototype/docs/decor-de-la-carte.md` | one row in `mondes.py`, run the script, one CSS rule |
| Add a block type | 4 files — see the New block section |

> **Never switch a gesture floor on for a published world.** `minDrags` changes
> which candidate grid is kept, hence the grid, hence the star thresholds and
> the records already set against them. Floors are for new worlds.

> **Adding a world shifts the limits of every earlier level.** `limitsFor()`
> derives its `tighten` factor from `TOTAL_LEVELS`, so a thirty-first world
> loosens the move and time limits of levels 1–600. Grids and star thresholds do
> not move; the safety nets do.

> Changing `REALMS` or `TIERS` has no effect until `node tools/build-levels.mjs` runs, and no effect on players until `node tools/publish-levels.mjs` has pushed the result to Supabase. The game reads the database, not the generator. Routine UI, docs, naming, or gameplay-rule edits do not require regenerating the level set.

### Game rules

| Need | File | Reference |
|---|---|---|
| Movement, exits, door capacity | `src/core/board.js` | `step()`, `_gateFor()`, `canMove()` |
| What a block is allowed to do | `src/core/board.js` | `conditionMet()`, `canMove()`, `step()` |
| Block types, shapes, colors | `src/core/block.js` | `KIND`, `SHAPES`, `COLORS`, `capacityCost()` |
| Stars, win, loss | `src/core/board.js` | `stars()`, `_settle()` |
| Verify if a grid is solvable | `src/core/solver.js` | `solve()` |

### UI

| Need | File |
|---|---|
| Board rendering, animations, block marks | `src/render/boardView.js` |
| Block material (rounded edges, reflection, shadow, relief) | `styles/main.css` — all styling is on `.block`: `--bevel`, `--reflection`, and shadow `filter`; silhouette relief is on `.block-cell::after` |
| Touch dragging | `src/input/input.js` |
| Result screen (win / loss) | `src/ui/resultScreen.js` |
| Level map | `src/ui/mapScreen.js` |
| Map decoration (scrolling branches) | `styles/main.css` — `.realm::before` and 50 `nth-child` rules; images live in `images/branches/` and are generated by `tools/gen_30.py` |
| World name | `generator/realms.js` — `name` field in `REALMS`; rerun `build-levels.mjs --index-only` (fast, catalogue only) then `publish-levels.mjs` |
| HUD during play (time, blocks, stars) | `src/ui/gameplayUI.js` |
| Colors, palettes, night mode | `src/ui/theme.js` — realm hue/palette; `.night` block in `styles/main.css` for the dark tokens |
| Realm-complete celebration (confetti, next-realm preview) | `src/ui/realmComplete.js`, `src/render/confetti.js` |
| Level editor | `src/ui/editor.js` |
| All visible text | `src/ui/i18n.js` (5 languages) + `data-i18n` in `index.html` |
| Navigation and wiring across screens | `src/main.js` |
| Styles | `styles/main.css` |

### Economy and monetization

| Need | File | Reference |
|---|---|---|
| Prices, packs, ad rewards | `src/monetization/currency.js` | `PRICES`, `PACKS`, `AD_REWARD` |
| Rewards per level | `src/data/api.js` | `COINS_PER_STAR`, `coinsFor()` |
| When an ad appears | `src/monetization/brokerPolicy.js` | `RULES` |
| Simulated ad playback | `src/monetization/brokerManager.js` | `PLACEMENT`, `AdBroker` |
| Defeat / continue screen | `src/monetization/failOffer.js` | `offer()`, `BONUS` |
| Lives (hearts): max, refill time, costs | `src/meta/lives.js` | `MAX_LIVES`, `REGEN_MS`, `COST`; price `PRICES.LIFE` in `currency.js`; pill + hearts card in `src/ui/livesUI.js` (`GRANT_WITHOUT_AD` while ads don't fill); charged in `main.js` via `usesLives()` |
| Shop | `src/main.js` | `updateShop()` |

### Retention

| Need | File |
|---|---|
| Daily streaks, tiers, badges | `src/meta/daily.js` — `STREAK_TIERS` |
| Level-streak reward (consecutive wins) | `src/data/api.js` — `completeLevel()`; shown on `src/ui/resultScreen.js` |
| Daily puzzle, score, leaderboard | `src/meta/dailyPuzzle.js` |
| Editor drafts | `src/meta/myLevels.js` |
| Bug reporting | `src/meta/feedback.js` |
| Event names and parameters | `src/data/analytics.js` — `EVENTS` |

### Data

| Need | File |
|---|---|
| Read a level or the level catalog | `src/data/levelStore.js` — public interface, catalogue readable synchronously after `open()` |
| Change WHERE levels come from (cache, Supabase, seed) | `src/data/levelSource.js` |
| Level tables, catalogue view, RLS | `supabase/migrations/` — `level_catalog` view, `levels`, `level_groups` |
| Local save state | `src/data/save.js` — `EMPTY()` lists all fields |
| API facade | `src/data/api.js` |

### Android app

`prototype/` is wrapped, unmodified, into a Capacitor Android project under
`mobile/` — same source, one more publish target alongside `docs/`. Native
behavior (back button, haptics, fullscreen, orientation, real AdMob ads,
native Google Sign-In) all live in `prototype/src/`, gated by
`isNative()` (`src/native/capacitor.js`) so the web build never runs them.

| Need | File | Reference |
|---|---|---|
| Rebuild the app's web content and push it into the native project | `tools/build-mobile-www.mjs` then `mobile/` → `npx cap sync android` | full level set embedded (unlike `docs/`, which ships only the seed) |
| Android hardware back button, pause/resume | `src/native/lifecycle.js` | `registerBackHandler()` — resolves per current screen, see the call site in `main.js` |
| Vibration | `src/audio/haptics.js` | mirrors `audioManager.js`'s call sites; toggle is `vibration` in `save.js` |
| Fullscreen / immersive, orientation lock | `mobile/android/app/src/main/java/.../MainActivity.java`, `AndroidManifest.xml` | native-only, no JS involved |
| Real rewarded/interstitial ads | `src/monetization/admob.js`, `src/monetization/admobConfig.js` | swapped in by `brokerManager.js` when `isNative()`; `admobConfig.js` holds the REAL ad unit IDs — no ads are served until the app is live on the Play Store (see the checklist below) |
| Ad consent (UMP/GDPR) | `src/monetization/admob.js` — `ensureInitialized()`, `manageConsent()` | reachable from Settings → Ads → "Manage ad consent" (hidden on web) |
| Native Google Sign-In | `src/ui/loginScreen.js` — `signInGoogleNative()` | needs `serverClientId` (the Google Cloud **Web** OAuth client) set in `mobile/capacitor.config.json`, plus an **Android** OAuth client (package name + release/debug SHA-1) — the web build keeps the old `signInWithOAuth` redirect flow |
| App icon / splash source | `mobile/assets-src/*.svg` → rasterized to `mobile/assets/*.png` (`rsvg-convert`) → `npx @capacitor/assets generate --android` | regenerate after any visual change to the source SVGs |
| Signing / release `.aab` | `mobile/android/app/build.gradle`, a **local, gitignored** `keystore.properties` | the keystore itself is never committed — losing it means losing the ability to update the app on the Play Store |

### Before the first Play Store release — ads checklist

AdMob serves nothing until the app is published and linked; until then the
lives' ad button grants the heart anyway. When the app goes live:

- [ ] **AdMob**: link the app to its Play Store listing (Apps → Quiet Puzzle → App settings).
- [ ] **Consent**: publish the GDPR message (Privacy & messaging) — without it nothing is served in Europe, and `ensureInitialized()` in `admob.js` never gets to `AdMob.initialize()` if the consent request errors.
- [ ] **`app-ads.txt`**: host it at the root of the developer website shown on the Play Store listing.
- [ ] **Test device**: register your own phone in AdMob — clicking your own real ads can get the account suspended.
- [ ] **Code**: set `GRANT_WITHOUT_AD` to `false` in `prototype/src/ui/livesUI.js`, so a heart is earned by the ad again.

### Vendored dependencies

`prototype/vendor/*.esm.js` are third-party packages pre-bundled into single
browser-ready ES modules with esbuild (`prototype/tools/vendor-supabase.mjs`,
`prototype/tools/vendor-native.mjs`), instead of importing them from a CDN or
leaving them as bare `node_modules` specifiers — neither works with this
project's no-build, plain-`<script type=module>` setup, and a CDN import
inside the packaged Android app reads to Play Store review as fetching
executable code at runtime. Regenerate a vendor file after bumping the
corresponding version in `package.json` (`prototype/` for Supabase,
`mobile/` for the Capacitor plugins) by rerunning the matching script.

### Commands

```bash
cd prototype
python3 -m http.server 8123
node tools/build-levels.mjs          # --realm <id> for one world, --index-only for a naming-only change
node tools/test.mjs
node tools/balance.mjs
node tools/check.mjs
node tools/publier.mjs
node tools/bundle.mjs
node tools/vendor-supabase.mjs       # regenerate vendor/supabase-js.esm.js
node tools/vendor-native.mjs         # regenerate vendor/capacitor-*.esm.js (needs mobile/node_modules)

cd ..
SUPABASE_TOKEN=sbp_xxx node tools/publish-levels.mjs   # --realm <id>, --dry-run
node tools/build-mobile-www.mjs                        # refresh mobile/www from prototype/

cd mobile
npx cap sync android
cd android && ./gradlew assembleDebug      # or bundleRelease, once signing is configured
```

---

## Changelog

Newest first. Short enough to skim, detailed enough to know whether a bug you just hit is new or already-known.

### 2026-09-24

- **Cold start with an open session never started the game.** `startGameLoop()` (`prototype/src/main.js`) is a hoisted function declaration, but the `let started` guard it reads was declared *after* the startup `try` that calls it. With a session already open — every returning player — the first call hit the temporal dead zone (`ReferenceError: Cannot access 'started' before initialization`), the `catch` called it again and threw uncaught, and the menu stayed on `index.html`'s static placeholders ("0 stars", "1 level"). Only fresh installs (no session → login screen → callback later) escaped it. The 2026-09-23 "cold-start robustness" `try/catch` did not cover it: the catch path hits the same error. Fix: `let started = false` moved above the `try`. **Pitfall:** anything `startGameLoop` reads must be declared before that `try`.

### 2026-09-23

- **Native Google sign-in fixed.** Root cause: the Android OAuth client in Google Cloud Console had the wrong SHA-1 — not the one that actually signs the AAB Play App Signing distributes (confirmed by pulling the installed APK off a test device and computing its real signing-cert SHA-1 directly; it didn't match what was registered). Corrected in Google Cloud Console. No code change.
- **Anonymous sign-in fixed.** `initSession()` (`prototype/src/data/auth.js`) — the function meant to call `signInAnonymously()` on first launch — was never actually invoked anywhere. Now called (fire-and-forget) when the player taps "Continue without an account" on the login screen (`prototype/src/ui/loginScreen.js`). Also required turning on "Allow anonymous sign-ins" in the Supabase dashboard (Authentication → Providers) — off by default, done.
- **Anonymous → Google account merge.** New `merge_anonymous_progress(p_anonymous_user_id)` Postgres RPC (`supabase/migrations/20260923150000_merge_anonymous_progress.sql`, permission fix in `20260923150100_...sql`) merges stars/coins/xp/unlocked-level from an anonymous account into the Google account replacing it, same max-wins rules as `syncFromCloud()`. Called from `loginScreen.js` right after a successful native Google sign-in, before the old anonymous id is lost. Note: there is currently no UI to link Google from an already-anonymous session without signing out first — the merge only fires on the direct anonymous→Google path from the login screen.
- **Cold-start robustness.** The session check at app startup (`prototype/src/main.js`) had no `try/catch`: a slow or failing network left the player staring at the menu's static HTML placeholders ("0 stars", "1 level") indefinitely, with no error and no retry — only an unrelated interaction (opening the account panel) happened to force a fresh render. Wrapped in the same best-effort pattern used everywhere else in the app. Also fixed the Google avatar never showing on the greeting pill (same root cause).
- **Directional-block feedback (new).** Dragging a RAIL/ANCHOR/one-way-locked block the wrong way now bumps it, plays a small synthesised "no" sound (`AudioManager.blocked()`, no new audio asset), and shows a red-pastel toast naming which rule blocked it (`toast.blocked.rail` / `.anchor` / `.oneway`, all 5 languages). Previously silent — `board.js`'s `step()` rejected the move but nothing surfaced why.
- **New-block introduction is more prominent.** The "New: <mechanic>" badge shown the first time a realm introduces a block kind (level-brief screen, and the realm-complete preview of what's next) now pops in and gently pulses/shimmers instead of sitting as plain text (`.brief-novelty` in `prototype/styles/main.css`). Respects `prefers-reduced-motion`.
- **Beta-tester easter egg.** Ten taps on the same level node on the map (locked or not) within ~700ms of each other unlocks that level — and everything before it, since progress is a single cursor (`unlockedLevel`) — and triggers a screen-wide eggplant emoji snowfall (`snow()` in `prototype/src/render/confetti.js`). Lives entirely in `prototype/src/ui/mapScreen.js`.
- **World names were stuck in English.** Not a code bug: Supabase's `level_groups.name` column held `{"en": "..."}` only for all 50 worlds — the translations added to `generator/realms.js` were never republished (`tools/publish-levels.mjs` needs a `SUPABASE_TOKEN` that wasn't available in this environment). Fixed by writing the correct `{fr,en,es,it,zh}` object straight to the 50 rows via SQL, generated from `generator/realms.js` rather than hand-typed. **Still worth doing properly with `tools/publish-levels.mjs` next time a token is available**, to catch any other field that might have drifted the same way.

## Project notes

- The project already relies mostly on English code names; documentation and naming were aligned to that standard.
- The main documentation source is `Technical_Document_Developers.md`.
- `PROJECT_AGENTS.md` is the English summary version of this project map.
- Only rebuild the generated level files with `node tools/build-levels.mjs` when changing the generator logic, `REALMS`, or the shipped database itself. Routine UI, docs, and naming-only changes should not trigger a full level rebuild — use `--index-only`.
- **Pitfall already hit:** `build-levels.mjs` used to write the catalogue's realm `name` as `R.name.en` — English only — while `difficulty` and `introduces` correctly carried the full `{ fr, en, es, it, zh }` object. A realm's name translated in `REALMS` therefore never reached the index, and the map/brief screens showed English regardless of the player's language even though `i18n.realmText()` and `levelStore.js` were already written to expect a full table. Fixed by writing `name: R.name` (the whole object) in both the per-realm file and the index — check this stays true if `build-levels.mjs` is ever rewritten.

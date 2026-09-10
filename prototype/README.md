# Quiet Puzzle prototype

This prototype is the playable version of the game described in `../Technical_Document_Developers.md`.

The game is a puzzle where blocks leave the board through color-coded doors.

The core intent is simple: offer a calm, repeatable, satisfying puzzle loop that helps players decompress rather than compete.

<img src="../media/jeu.png" width="240" align="right" alt="Current board during gameplay">

It serves two goals:

1. Validate the game design — the technical document describes the broader platform structure (Unity, Node backend, monetization, CI/CD), but leaves the actual mechanics as placeholders. This prototype resolves the rules and makes them playable immediately.
2. Serve as an executable specification — each module matches the counterpart in the C# architecture section so the Unity port is a mapping rather than a reinterpretation.

## Run locally

A static server is enough; there are no dependencies or build steps.

```bash
cd prototype && python3 -m http.server 8123
```

```bash
node tools/test.mjs
```

```bash
node tools/balance.mjs
```

```bash
node tools/bundle.mjs
```

## Rules

**Board** — a closed grid with walls. Color-coded **doors** are placed on those walls and are 2 or 3 cells wide.

**Blocks** — colored polyominoes (1 to 4 cells). You grab a block and drag it; it follows your finger one cell at a time and stops at the first obstacle.

**Exit** — a block leaves the board when it is pressed against a door of its own color and fits the full door width. A 3-cell shape cannot pass through a 2-cell door. This is the actual implementation of `AreAllDoorsComplete()`, left as a placeholder in section 5.1 of the technical document.

**Objective** — clear the board of all movable blocks.

**Double constraint** — a timer and a drag limit. The first one to reach zero causes a loss. A drag only counts when it actually moves a block; nudging against a wall costs nothing.

**Block types** — these effects reuse proven puzzle mechanics rather than inventing new ones:

| Type | Behavior |
|---|---|
| Normal | Exits through a door of its own color. |
| Slider | Only moves on one axis, like in *Rush Hour*. This is the type that creates most of the puzzle difficulty without requiring new rules. |
| Joker | Multicolored: exits through any door. Acts as a safety valve when the grid is too constrained. |
| Locked | Sealed until N blocks have exited. The block shows "N left" and counts down live. |
| Sealed (gray) | Never moves; it must be routed around. |

**Door capacity** — from level 8 onward, a door accepts only a limited number of cells, displayed on the door itself. This is the single mechanism that creates genuine puzzle complexity; see "What makes the difficulty" below.

**Stars** — 1★ for clearing the board, 2★ and 3★ depending on drag efficiency compared with the reference solution. The timer and move cap remain failure conditions, not score tiers; mixing them made the rating unreadable.

## What makes the difficulty

A counterintuitive fact measured by the solver: **without door capacity, no exit order can be wrong**. Removing a block only frees space, so a greedy approach always leads to victory—the solver could clear grids without backtracking, regardless of density.

The decisive lever came last, and it does not solve the puzzle itself: it **checks**. The number of states a solver explores before clearing a board tells whether the level requires thought or merely a straightforward sequence. On the first 18 worlds, this value was effectively 1 per block everywhere, even in dense boards: players only needed to slide. The last two worlds therefore use solver-based culling during generation and display a median ratio of **187 states per block**.

The levers that make this possible, in order:

1. **Door capacity** — routing a block toward the wrong door of the correct color wastes cells. This forces planning.
2. **Movement-constrained blocks** — sliders (one axis) and anchors (one direction): a block that cannot steer away imposes ordering.
3. **Bulky blocks** — they cost double at the door and saturate space faster than their size suggests.
4. **Density** — 60% to 70% of cells occupied; below that, the board is legible at a glance.
5. **Locks and move/time limits**.

`tools/balance.mjs` shows the number of states explored by the solver: this is the best available measure of how many reversals a player must make, and therefore the best indicator of difficulty.

## Economy

The currency is called **shards**—one consistent name that fits the glass-world theme. The loop is simple:

| | |
|---|---|
| **Earn** | by playing (10 / 5 / 2 depending on stars), by the daily gift, by streak milestones |
| **Spend** | on shop packs, or 25 shards for a rewarded ad up to five times per day |
| **Use** | hint 50, continue 75 |

Ads remain the **free alternative to paid progression**: anywhere a bonus is paid for, the player can watch a rewarded ad instead. This keeps the system readable without taking away options.

A successful level pays according to its stars: **10 coins for 3★, 5 for 2★, 2 for 1★**. The scale is flat and readable—the player knows exactly what they earn before playing and aims for three stars for five times the reward of a single star.

Replay without improving only pays one shard. This is not a punishment: without this guardrail, the first level in the game—just a few seconds, three stars with eyes closed—would become the fastest way to earn currency, and the rest of the economy loses all meaning. Improving from 1★ to 3★ pays the 3★ tier, not the difference: what the table promises is what the player receives.

## Streaks, badges, and themes

The daily streak carries a **badge** from the second day onward, visible on the home screen, with the remaining progress needed for the next tier. Rewards are intentionally different in nature: a streak that only paid currency would compete with ordinary play rewards and would always lose:

| Tier | Reward |
|---|---|
| 3 days | 50 shards |
| 7 days | the theme 🌸 Sakura |
| 14 days | 3 hints |
| 30 days | a badge |

They are granted **at session start**, not on the exact tier day. A player who opens the game on day eight without opening it on day seven still receives what they earned; otherwise the streak punishes the player for not playing exactly on schedule. A streak reset to zero resets the tier counter, otherwise a return after a month away would grant every tier at once.

**Seven themes** — 🌸 Sakura, 🌊 Ocean, 🌲 Forest, 🌅 Sunset, 🌙 Night, 🍵 Zen, ❄️ Snow — unlock via intentionally different routes: levels cleared, stars earned, streak maintained, no-ads purchase. A theme that depended only on progression would tell the player nothing about who they are.

A chosen theme **overrides the world hue**, and that is intentional: a preference that gets overwritten at each world change is not really a preference. Without a chosen theme, the original chromatic progression remains.

## Shop

The "shards" tile in the menu opens the shop. Two ways to obtain them, and the order matters: **free first**. Putting the packs first would make rewarded ads feel like consolation prizes, even though the ad is what helps the player exactly when they need it.

- **Rewarded ad**: 25 coins, five times per day. The daily cap is not to limit the player but to protect the economy—an infinite reserve of free coins would make every bonus irrelevant, and an irrelevant bonus is no longer a choice.
- **Packs**: 500 to 16,000 coins, with increasing bonuses. Purchases are **simulated**, and the screen clearly says so; no payment system is connected. Identifiers follow the store naming convention (`com.puzzle.coins.*`), and the `iap_purchased` event is already logged in its final form—this path is measurable before it is live.

`tools/test.mjs` checks quotas, amounts paid, rejection of an unknown identifier, and ensures **each tier grants more coins per euro than the previous tier**: paying more for a more expensive coin would be a trap, not an offer.

## Contact / Feedback

The user menu opens a bug-report screen: category (bug, idea, other), message, and screenshots as attachments. The **technical context** travels with it—version, language, current screen, level, viewport size, browser. That is the missing information in most bug reports and the detail people rarely think to include.

`src/meta/feedback.js` prepares the report but **does not send anything**: there is no server, and nothing leaves the browser without a destination. The player chooses a path—copy, download, or open their mail client with a draft already prepared. Screenshots can only travel via the downloaded file: no `mailto:` URL knows how to attach an image.

The images are **not** stored in local storage: a few phone screenshots in base64 can exceed a browser's storage budget on their own, and the history would become the reason the game stops saving.

## Measurement

`src/data/analytics.js` defines the nomenclature: one place decides event names and parameters. If they are scattered across the code, they drift—two spellings for the same action, a parameter present here but missing there—and the funnel becomes unreliable.

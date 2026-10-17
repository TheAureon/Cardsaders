# Cardsaders

A real-time 3D arena brawler for 4-5 fighters where everyone can only punch, and a random 7-card,
Uno-inspired hand decides who hits hardest. Last fighter standing wins.

Browser game, singleplayer vs bots. No ads, no sign-up. Built with TypeScript, Three.js and Vite.

**Just want to play?** Download [`index.html`](index.html) and double-click it. It's a single
self-contained file (all code and styles inlined, no server, no install, works offline). It's also the
file to upload to the hosting site.

For development:

```bash
npm install
npm run dev        # dev server with hot reload (opens dev.html)
npm run build      # typecheck, then regenerate the standalone index.html (+ dist/index.html)
npm test           # rules + bot tests
```

`dev.html` is the source page. `index.html` is generated from it by
[`scripts/build-standalone.mjs`](scripts/build-standalone.mjs), so don't edit it by hand. Re-run
`npm run build` after code changes and commit the new `index.html`.

The name lives in one constant, `GAME_NAME` in [`src/config.ts`](src/config.ts). Every other tunable
number (round length, Block/Reverse duration, bounce cap, rarity weights, punch range, arena size,
bot difficulty) is in the same file.

## Controls

The game plays like a Roblox battlegrounds game (The Strongest Battlegrounds, Jujutsu Shenanigans):
the mouse is locked to an over-the-shoulder camera, and your fighter always faces where you look.

| Action | Input |
| --- | --- |
| Look / aim | Mouse (click the game to lock the cursor) |
| Move | WASD / arrow keys |
| Punch (M1) | Left click. Chain 4 for a combo: hits 1-3 stun, the 4th launches |
| Jump | Space |
| Dash | Q (in the direction you're moving) |
| Play a card | 1-7, or hold Alt to free the cursor and double-click a card |
| Pause | P / Esc |

If the page can't lock the mouse (e.g. inside a sandboxed iframe), clicks punch directly and
right-drag turns the camera.

## Rules as implemented

- 4 or 5 fighters, 100 HP, HP carries over between rounds. A match is timed rounds of 35 s
  with a 3 s break. The match ends when one fighter is left. As a safety net, after round 12 the
  highest HP wins.
- At round start everyone gets a fresh random hand of 7. When the round ends, unplayed cards, buffs,
  Block/Reverse, Skip, queued and in-flight cards are all wiped.
- Punch: short range cone in front of you, 0.5 s cooldown, base damage 1. Punches form an M1 string:
  hits 1-3 stun the target long enough for the next punch to connect, and the 4th hit is a finisher
  that launches them into a ragdoll. Downed fighters can't be punched until they get up. Cards
  work even while stunned, so Block or Reverse doubles as a combo breaker.
- Movement: jump (Space) and a short dash (Q, 1.6 s cooldown). Launched fighters bounce off the wall.
- Damage = `(1 + all number buffs) × all multiplier buffs`. Each buff has its own 30 s timer.
- Cards have no cooldown; you can play all 7 at once.
- Skip and all Discards target whoever you last landed a punch on. If you haven't punched anyone
  yet (or they're dead), the card waits and fires on your next landed punch.
- Targeted cards give the target a 1 s warning (banner, sound, countdown bar) to answer with Block
  or Reverse.
- Resolution order for anything aimed at a fighter (punches and targeted cards):
  1. **Block** stops it.
  2. **Reverse** sends it back to the sender, who can reverse it again. After 3 bounces it can no
     longer be reversed and lands on whoever it's pointing at, unless they are blocking.
  3. Otherwise it lands.
- **Skip**: the victim's next card is consumed with no effect.
- **Discard variants** remove every matching card and briefly show the sender exactly those cards
  (spy). **Plain Discard** shows the victim's whole hand and the sender picks one card to remove.
  If they don't pick within 5 s, a random card goes.
- Enemy card counts are public; their faces are not.

### Interpretation notes

- The brief marks Multiplier as "can be blocked". Multipliers buff yourself, so in practice the
  *punches* they power are blocked or reflected like any punch. The card itself can't be intercepted.
- "Whoever you punched last" means the last fighter your punch connected with, even if they
  blocked or reversed it.
- Rarity weights (per card kind, see `CONFIG.cards.weights`): Number 34; Skip 12; Block 10;
  Multiplier, Discard, Discard Action, Discard Attack and Discard Multipliers 6/5/5/5/5; Reverse 4.
  Every hand has at least one number card. Low number values are more common than high ones
  (`numberValueWeights`). This keeps matches to a few rounds rather than one burst.
  `tests/pacing.test.ts` prints stats from 20 headless bot matches to help retune it.

## Architecture (multiplayer-ready)

```
src/
  config.ts          name + all tunables
  core/              pure simulation: no DOM, no Three.js
    types.ts         GameState, Command, GameEvent
    game.ts          Game: dispatch(command), step(dt), drainEvents()
    cards.ts         card catalogue, dealing, rarity
    rng.ts           seeded RNG stored in the state (deterministic)
  ai/bot.ts          bots read state and emit Commands, like any player
  net/transport.ts   CommandSink: LocalTransport now, a network transport later
  input/controls.ts  keyboard/mouse -> Commands
  render/arena.ts    Three.js arena and fighters (reads state only)
  ui/                DOM HUD, Uno-style cards, menus, synth sound effects
```

- **Everything goes through commands.** `input`, `punch`, `playCard`, `discardPick` are plain,
  serialisable objects. Card plays have exactly one entry point, the `playCard` command.
- **The simulation is authoritative and deterministic.** It uses a fixed 60 Hz tick and a seeded
  RNG kept in `GameState`. The same `Game` class can run on a server.
- **Presentation is event-driven.** `Game` emits `GameEvent`s (hit, blocked, reflected, warning,
  spy, ...). The HUD, renderer and audio react to them. Private events (`spy`, `discardPickStart`)
  carry a viewer id, so a server can send them to that player only.

Adding multiplayer later: implement `CommandSink` over a socket, run `Game` on the server, and send
each client the state snapshot (with other players' hands reduced to a count) plus the events
they're allowed to see.

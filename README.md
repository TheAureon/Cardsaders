# Cardsaders

A real-time 3D arena brawler for 4-5 fighters where everyone can only punch, and a random 7-card,
Uno-inspired hand decides who hits hardest. Last fighter standing wins.

Browser game, singleplayer vs bots. No ads, no sign-up. Built with TypeScript, Three.js and Vite.

```bash
npm install
npm run dev        # local dev server
npm run build      # static build in dist/ (relative paths, drop into any folder on the host)
npm test           # rules + bot tests
```

The name lives in one constant, `GAME_NAME` in [`src/config.ts`](src/config.ts). Every other tunable
number (round length, Block/Reverse duration, bounce cap, rarity weights, punch range, arena size,
bot difficulty) is in the same file.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD / arrow keys (camera-relative) |
| Aim | Mouse: your fighter faces the cursor |
| Punch | Left click or Space |
| Play a card | Double-click it in the hand, or press 1-7 |
| Turn camera | Q / E or right-drag |
| Pause | Esc |

## Rules as implemented

- 4 or 5 fighters, 100 HP, HP carries over between rounds. A match is timed rounds of 35 s
  with a 3 s break. The match ends when one fighter is left. As a safety net, after round 12 the
  highest HP wins.
- At round start everyone gets a fresh random hand of 7. When the round ends, unplayed cards, buffs,
  Block/Reverse, Skip, queued and in-flight cards are all wiped.
- Punch: short range cone in front of you, 0.5 s cooldown, base damage 1, with a knockback stagger.
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

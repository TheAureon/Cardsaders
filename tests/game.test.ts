import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { dealHand } from '../src/core/cards';
import { attackDamage, Game } from '../src/core/game';
import type { Card, CardKind, FighterState, GameEvent } from '../src/core/types';

const DT = 1 / 60;

function setup(n = 4) {
  const game = new Game(
    Array.from({ length: n }, (_, i) => ({ id: `f${i}`, name: `F${i}`, isBot: i > 0, color: 0 })),
    { seed: 42, countdown: 0 },
  );
  game.step(DT); // countdown -> round 1
  return game;
}

function give(game: Game, f: FighterState, kind: CardKind, value = 0): Card {
  const card: Card = { id: `t${game.state.nextId++}`, kind, value };
  f.hand.push(card);
  return card;
}

/** Put b right in front of a, facing it. */
function faceOff(a: FighterState, b: FighterState) {
  a.pos = { x: 0, z: 0 };
  b.pos = { x: 0, z: 1.2 };
  a.facing = a.input.aim = 0;
  b.facing = b.input.aim = Math.PI;
}

function run(game: Game, seconds: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    game.step(DT);
    events.push(...game.drainEvents());
  }
  return events;
}

describe('cards', () => {
  it('deals 7 cards with at least one number card', () => {
    const game = setup();
    for (let i = 0; i < 200; i++) {
      const hand = dealHand(game.state);
      expect(hand).toHaveLength(CONFIG.cards.handSize);
      expect(hand.some((c) => c.kind === 'number')).toBe(true);
    }
  });

  it('every fighter gets a fresh hand at round start', () => {
    const game = setup();
    for (const f of game.state.fighters) expect(f.hand).toHaveLength(7);
  });
});

describe('damage', () => {
  it('numbers add, multipliers multiply the whole attack, and they stack', () => {
    const game = setup();
    const [a] = game.state.fighters;
    expect(attackDamage(a)).toBe(1);
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'number', 4).id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'number', 2).id });
    expect(attackDamage(a)).toBe(7);
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'multiplier', 2).id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'multiplier', 2).id });
    expect(attackDamage(a)).toBe(28);
  });

  it('each buff runs its own 30 second timer', () => {
    const game = setup();
    const [a] = game.state.fighters;
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'number', 3).id });
    run(game, 10);
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'number', 5).id });
    run(game, 20.5);
    expect(attackDamage(a)).toBe(6);
  });

  it('punch has a 0.5s cooldown and hits only in range', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(b.hp).toBe(99);
    run(game, 0.55);
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(b.hp).toBe(98);
    run(game, 0.55);
    b.pos = { x: 0, z: 5 };
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(b.hp).toBe(98);
  });
});

describe('M1 combos and movement', () => {
  function swing(game: Game, a: FighterState, b: FighterState) {
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
  }

  it('hits stun the target so they cannot punch back', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    swing(game, a, b);
    expect(b.stunUntil).toBeGreaterThan(game.state.time);
    game.dispatch({ type: 'punch', fighterId: b.id });
    expect(a.hp).toBe(100);
  });

  it('the 4th hit of a string launches and knocks the target down', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    const events: GameEvent[] = [];
    for (let i = 0; i < CONFIG.combat.comboLength; i++) {
      swing(game, a, b);
      events.push(...game.drainEvents());
      if (i < CONFIG.combat.comboLength - 1) {
        expect(b.knockdownUntil).toBe(0);
        run(game, CONFIG.combat.punchCooldown + 0.02);
      }
    }
    const hits = events.filter((e) => e.type === 'hit');
    expect(hits.map((h) => h.type === 'hit' && h.combo)).toEqual([1, 2, 3, 4]);
    expect(hits.at(-1)).toMatchObject({ finisher: true });
    expect(b.knockdownUntil).toBeGreaterThan(game.state.time);
    expect(b.vy).toBeGreaterThan(0);
    expect(b.hp).toBe(96);

    // Downed fighters can't be punched, and the finisher has extra endlag.
    run(game, CONFIG.combat.punchCooldown + 0.02);
    swing(game, a, b);
    expect(b.hp).toBe(96);
    run(game, CONFIG.combat.knockdownSeconds);
    expect(b.y).toBe(0);
  });

  it('the string resets if you wait too long between swings', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    swing(game, a, b);
    run(game, CONFIG.combat.comboWindow + 0.1);
    game.drainEvents();
    swing(game, a, b);
    expect(game.drainEvents().find((e) => e.type === 'punch')).toMatchObject({ combo: 1 });
  });

  it('a Block card played mid-string stops the rest of it', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    swing(game, a, b);
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'block').id });
    run(game, CONFIG.combat.punchCooldown + 0.02);
    swing(game, a, b);
    expect(b.hp).toBe(99);
  });

  it('jump and dash', () => {
    const game = setup();
    const [a] = game.state.fighters;
    a.pos = { x: 0, z: 0 };
    game.dispatch({ type: 'jump', fighterId: a.id });
    run(game, 0.2);
    expect(a.y).toBeGreaterThan(0.5);
    run(game, 1);
    expect(a.y).toBe(0);

    game.dispatch({ type: 'dash', fighterId: a.id, dirX: 1, dirZ: 0 });
    run(game, CONFIG.arena.dashSeconds);
    expect(a.pos.x).toBeGreaterThan(3);
    const x = a.pos.x;
    game.dispatch({ type: 'dash', fighterId: a.id, dirX: 1, dirZ: 0 });
    run(game, CONFIG.arena.dashSeconds);
    expect(a.pos.x - x).toBeLessThan(2); // on cooldown: only leftover momentum
  });
});

describe('block and reverse', () => {
  it('block stops punches', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'block').id });
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(b.hp).toBe(100);
    expect(a.hp).toBe(100);
  });

  it('reverse reflects a punch back at the attacker', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'number', 9).id });
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'reverse').id });
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(b.hp).toBe(100);
    expect(a.hp).toBe(90);
  });

  it('block is checked before reverse', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'reverse').id });
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'block').id });
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(a.hp).toBe(100);
    expect(b.hp).toBe(100);
  });

  it('two reversers bounce up to the cap, then it lands', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'reverse').id });
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'reverse').id });
    game.drainEvents();
    game.dispatch({ type: 'punch', fighterId: a.id });
    const bounces = game.drainEvents().filter((e) => e.type === 'reflected');
    expect(bounces).toHaveLength(CONFIG.cards.reverseBounceCap);
    // a -> b (reflect 1) -> a (reflect 2) -> b (reflect 3) -> a lands.
    expect(a.hp).toBe(99);
    expect(b.hp).toBe(100);
  });

  it('block lasts 3 seconds', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'block').id });
    run(game, 3.1);
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
    expect(b.hp).toBe(99);
  });
});

describe('skip and discard', () => {
  it('targeted cards wait for the first landed punch, then warn before landing', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'skip').id });
    expect(a.queuedCards).toHaveLength(1);
    faceOff(a, b);
    game.drainEvents();
    game.dispatch({ type: 'punch', fighterId: a.id });
    const warn = game.drainEvents().find((e) => e.type === 'warning');
    expect(warn).toMatchObject({ targetId: b.id, kind: 'skip' });
    expect(b.skipped).toBe(false);
    run(game, CONFIG.cards.warningSeconds + 0.05);
    expect(b.skipped).toBe(true);

    const before = b.hand.length;
    const block = give(game, b, 'block');
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: block.id });
    expect(b.blockUntil).toBe(0);
    expect(b.skipped).toBe(false);
    expect(b.hand.length).toBe(before);
  });

  it('a block during the warning stops the skip', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'skip').id });
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'block').id });
    run(game, 1.1);
    expect(b.skipped).toBe(false);
    expect(a.skipped).toBe(false);
  });

  it('a reverse during the warning sends the skip back', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'skip').id });
    game.dispatch({ type: 'playCard', fighterId: b.id, cardId: give(game, b, 'reverse').id });
    run(game, 1.1);
    expect(b.skipped).toBe(false);
    expect(a.skipped).toBe(true);
  });

  it('discard variants remove the right cards and reveal them to the player', () => {
    const cases: [CardKind, CardKind[]][] = [
      ['discardAttack', ['number']],
      ['discardMultipliers', ['multiplier']],
      ['discardAction', ['block', 'reverse', 'skip', 'discard']],
    ];
    for (const [kind, removed] of cases) {
      const game = setup();
      const [a, b] = game.state.fighters;
      b.hand = [];
      give(game, b, 'number', 5);
      give(game, b, 'multiplier', 2);
      give(game, b, 'block');
      give(game, b, 'reverse');
      give(game, b, 'skip');
      give(game, b, 'discard');
      faceOff(a, b);
      game.dispatch({ type: 'punch', fighterId: a.id });
      game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, kind).id });
      const events = run(game, 1.1);
      expect(b.hand.every((c) => !removed.includes(c.kind))).toBe(true);
      expect(b.hand.length).toBe(kind === 'discardAction' ? 2 : 5);
      const spy = events.find((e) => e.type === 'spy');
      expect(spy).toMatchObject({ viewerId: a.id, victimId: b.id });
      if (spy?.type === 'spy') expect(spy.cards.every((c) => removed.includes(c.kind))).toBe(true);
    }
  });

  it('plain discard lets the player pick a card, or picks randomly on timeout', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'punch', fighterId: a.id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'discard').id });
    run(game, 1.1);
    expect(game.state.discardPicks).toHaveLength(1);
    const pick = b.hand[3];
    game.dispatch({ type: 'discardPick', fighterId: a.id, victimId: b.id, cardId: pick.id });
    expect(b.hand).toHaveLength(6);
    expect(b.hand.find((c) => c.id === pick.id)).toBeUndefined();

    run(game, 0.6);
    game.dispatch({ type: 'punch', fighterId: a.id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'discard').id });
    run(game, 1.1 + CONFIG.cards.discardPickSeconds);
    expect(b.hand).toHaveLength(5);
  });
});

describe('rounds and match', () => {
  it('round end wipes buffs, effects and hands, keeps HP, then deals fresh hands', () => {
    const game = setup();
    const [a, b] = game.state.fighters;
    faceOff(a, b);
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'number', 9).id });
    game.dispatch({ type: 'playCard', fighterId: a.id, cardId: give(game, a, 'block').id });
    game.dispatch({ type: 'punch', fighterId: a.id });
    b.skipped = true;
    run(game, CONFIG.match.roundSeconds);
    expect(game.state.phase).toBe('intermission');
    expect(a.buffs).toHaveLength(0);
    expect(a.blockUntil).toBe(0);
    expect(b.skipped).toBe(false);
    expect(a.hand).toHaveLength(0);
    expect(b.hp).toBe(90);
    run(game, CONFIG.match.intermissionSeconds + 0.1);
    expect(game.state.round).toBe(2);
    expect(a.hand).toHaveLength(7);
  });

  it('last fighter standing wins', () => {
    const game = setup(4);
    const [a, ...rest] = game.state.fighters;
    for (const f of rest) f.hp = 1;
    for (const f of rest) {
      faceOff(a, f);
      for (const o of rest) if (o !== f) o.pos = { x: 10, z: -10 + rest.indexOf(o) * 3 };
      run(game, 0.55);
      faceOff(a, f);
      game.dispatch({ type: 'punch', fighterId: a.id });
    }
    expect(game.state.phase).toBe('over');
    expect(game.state.winnerId).toBe(a.id);
  });
});

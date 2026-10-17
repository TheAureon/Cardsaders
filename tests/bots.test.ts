import { describe, expect, it } from 'vitest';
import { BotBrain } from '../src/ai/bot';
import { Game } from '../src/core/game';
import type { GameEvent } from '../src/core/types';

describe('bots', () => {
  it('an all-bot match plays cards and finishes with a winner', () => {
    const n = 5;
    const game = new Game(
      Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `B${i}`, isBot: true, color: 0 })),
      { seed: 7 },
    );
    const bots = game.state.fighters.map((f) => new BotBrain(f.id, 'normal'));
    const seen = new Map<GameEvent['type'], number>();
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 60 * 10 && game.state.phase !== 'over'; i++) {
      const events = game.drainEvents();
      game.step(dt);
      events.push(...game.drainEvents());
      for (const e of events) seen.set(e.type, (seen.get(e.type) ?? 0) + 1);
      for (const b of bots) for (const cmd of b.think(game.state, events)) game.dispatch(cmd);
    }
    console.log('rounds', game.state.round, 'time', game.state.time.toFixed(0), Object.fromEntries(seen));
    expect(game.state.phase).toBe('over');
    expect(seen.get('cardPlayed')).toBeGreaterThan(10);
    expect(seen.get('hit')).toBeGreaterThan(10);
  });
});

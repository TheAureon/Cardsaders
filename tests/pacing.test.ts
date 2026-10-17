import { expect, it } from 'vitest';
import { BotBrain } from '../src/ai/bot';
import { Game } from '../src/core/game';

/**
 * Plays 20 all-bot matches headlessly and prints pacing stats. Useful when
 * tuning CONFIG: `npx vitest run tests/pacing.test.ts`.
 */
it('all-bot matches finish, usually over more than one round', () => {
  const rounds: number[] = [];
  const times: number[] = [];
  let hits = 0;
  let dmg = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const game = new Game(
      Array.from({ length: 4 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, isBot: true, color: 0 })),
      { seed },
    );
    const bots = game.state.fighters.map((f) => new BotBrain(f.id, 'normal'));
    for (let i = 0; i < 60 * 60 * 10 && game.state.phase !== 'over'; i++) {
      const events = game.drainEvents();
      game.step(1 / 60);
      events.push(...game.drainEvents());
      for (const e of events) {
        if (e.type === 'hit') {
          hits++;
          dmg += e.damage;
        }
      }
      for (const b of bots) for (const cmd of b.think(game.state, events)) game.dispatch(cmd);
    }
    expect(game.state.phase).toBe('over');
    rounds.push(game.state.round);
    times.push(Math.round(game.state.time));
  }
  console.log(`avg dmg/hit ${(dmg / hits).toFixed(1)}\nrounds ${rounds.join(' ')}\nseconds ${times.join(' ')}`);
});

import { BOT_DIFFICULTY, CONFIG, type Difficulty } from '../config';
import { attackDamage, wrapAngle } from '../core/game';
import type { Card, Command, FighterState, GameEvent, GameState } from '../core/types';

/**
 * A bot is just another command source: it reads the state and emits the same
 * commands a human (or a remote player) would. It never touches state directly.
 */
export class BotBrain {
  private targetId: string | null = null;
  private retargetAt = 0;
  private nextCardThink = 0;
  private punchAt = 0;
  private strafe = Math.random() < 0.5 ? 1 : -1;
  private strafeFlipAt = 0;
  /** Bots brawl in bursts, then back off and circle, like a human would. */
  private mode: 'engage' | 'circle' = 'circle';
  private breakerReadyAt = 0;
  private modeUntil = 0;
  private aimOffset = 0;
  private aimOffsetAt = 0;
  /** Commands scheduled for later to simulate reaction time. */
  private delayed: { at: number; cmd: Command }[] = [];

  constructor(
    readonly id: string,
    readonly difficulty: Difficulty,
  ) {}

  private get tune() {
    return BOT_DIFFICULTY[this.difficulty];
  }

  think(state: GameState, events: GameEvent[]): Command[] {
    const me = state.fighters.find((f) => f.id === this.id);
    if (!me || !me.alive) return [];
    const out: Command[] = [];
    const now = state.time;

    for (const e of events) this.react(state, me, e);

    this.delayed = this.delayed.filter((d) => {
      if (d.at > now) return true;
      out.push(d.cmd);
      return false;
    });

    if (state.phase !== 'round' && state.phase !== 'intermission') {
      out.push({ type: 'input', fighterId: me.id, moveX: 0, moveZ: 0, aim: me.facing });
      return out;
    }

    const target = this.pickTarget(state, me);
    if (!target) {
      out.push({ type: 'input', fighterId: me.id, moveX: 0, moveZ: 0, aim: me.facing });
      return out;
    }

    const dx = target.pos.x - me.pos.x;
    const dz = target.pos.z - me.pos.z;
    const dist = Math.hypot(dx, dz);
    const aimTrue = Math.atan2(dx, dz);
    if (now >= this.aimOffsetAt) {
      this.aimOffset = (Math.random() - 0.5) * 2 * this.tune.aimError;
      this.aimOffsetAt = now + 0.4 + Math.random() * 0.5;
    }
    // Once a string is landing, the target is stunned: keep the aim honest and keep swinging.
    const comboing = target.stunUntil > now && target.knockdownUntil <= now && me.lastPunchedId === target.id;
    const aim = aimTrue + (comboing ? this.aimOffset * 0.6 : this.aimOffset);
    if (comboing) {
      this.mode = 'engage';
      this.modeUntil = Math.max(this.modeUntil, now + 0.6);
    }

    if (now >= this.modeUntil) {
      const engage = this.mode === 'circle';
      this.mode = engage ? 'engage' : 'circle';
      this.modeUntil = now + (engage ? this.tune.engageSeconds : this.tune.circleSeconds) * (0.6 + Math.random() * 0.8);
    }

    // Keep away while badly outgunned; otherwise close in during engage windows.
    const scared = me.hp < 25 && attackDamage(target) > attackDamage(me) * 2 && dist < 5;
    let mx = 0;
    let mz = 0;
    if (state.phase === 'round' && this.mode === 'circle' && !scared) {
      // Orbit at a wary distance.
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      const radial = dist < 4 ? -0.8 : dist > 6 ? 0.8 : 0;
      mx = nx * radial + nz * this.strafe * 0.7;
      mz = nz * radial - nx * this.strafe * 0.7;
    } else if (state.phase === 'round') {
      if (now > this.strafeFlipAt) {
        this.strafe = -this.strafe;
        this.strafeFlipAt = now + 1 + Math.random() * 2;
      }
      const nx = dx / (dist || 1);
      const nz = dz / (dist || 1);
      if (scared) {
        mx = -nx + nz * this.strafe * 0.6;
        mz = -nz - nx * this.strafe * 0.6;
      } else if (dist > CONFIG.combat.punchRange * 0.75) {
        mx = nx + nz * this.strafe * 0.25;
        mz = nz - nx * this.strafe * 0.25;
      } else {
        mx = nz * this.strafe * 0.4;
        mz = -nx * this.strafe * 0.4;
      }
    }
    out.push({ type: 'input', fighterId: me.id, moveX: mx, moveZ: mz, aim });

    if (state.phase !== 'round') return out;

    // Combo breaker: when caught in a string, burn a Block/Reverse if the hit hurts.
    if (me.stunUntil > now && now >= this.breakerReadyAt && attackDamage(target) >= 4) {
      this.breakerReadyAt = now + 2;
      if (Math.random() < this.tune.defendChance * 0.6) {
        const def = me.hand.find((c) => c.kind === 'reverse') ?? me.hand.find((c) => c.kind === 'block');
        if (def) out.push({ type: 'playCard', fighterId: me.id, cardId: def.id });
      }
    }

    // Gap closers: dash in from mid range, hop now and then.
    if (this.mode === 'engage' && !scared && dist > 4.5 && dist < 11 && now >= me.dashReadyAt && Math.random() < 0.04) {
      out.push({ type: 'dash', fighterId: me.id, dirX: dx, dirZ: dz });
    }
    if (dist < 7 && me.y === 0 && Math.random() < 0.004) out.push({ type: 'jump', fighterId: me.id });

    // Bots punch when facing where they *think* the target is; aim error makes them whiff.
    const facingOk = Math.abs(wrapAngle(aim - me.facing)) < 0.25;
    if (this.mode === 'engage' && dist < CONFIG.combat.punchRange && facingOk && now >= me.punchReadyAt) {
      if (this.punchAt === 0) this.punchAt = now + (comboing ? 0.03 : this.tune.reaction * Math.random());
      if (now >= this.punchAt) {
        out.push({ type: 'punch', fighterId: me.id });
        this.punchAt = 0;
      }
    }

    if (now >= this.nextCardThink) {
      this.nextCardThink = now + this.tune.cardThink * (0.5 + Math.random());
      const card = this.chooseCard(state, me, target, dist);
      if (card) out.push({ type: 'playCard', fighterId: me.id, cardId: card.id });
    }
    return out;
  }

  private react(state: GameState, me: FighterState, e: GameEvent) {
    if (e.type === 'warning' && e.targetId === me.id) {
      if (Math.random() > this.tune.defendChance) return;
      const card = me.hand.find((c) => c.kind === 'reverse') ?? me.hand.find((c) => c.kind === 'block');
      if (!card) return;
      const at = Math.min(e.firesAt - 0.05, state.time + this.tune.reaction);
      this.delayed.push({ at, cmd: { type: 'playCard', fighterId: me.id, cardId: card.id } });
    }
    if (e.type === 'discardPickStart' && e.pickerId === me.id) {
      const victim = state.fighters.find((f) => f.id === e.victimId);
      if (!victim?.hand.length) return;
      const best = [...victim.hand].sort((a, b) => cardValue(b) - cardValue(a))[0];
      this.delayed.push({
        at: state.time + this.tune.reaction + 0.3,
        cmd: { type: 'discardPick', fighterId: me.id, victimId: victim.id, cardId: best.id },
      });
    }
  }

  private pickTarget(state: GameState, me: FighterState): FighterState | undefined {
    const all = state.fighters.filter((f) => f.alive && f.id !== me.id);
    // Downed fighters can't be hit; look for someone else if there is anyone.
    const standing = all.filter((f) => f.knockdownUntil <= state.time);
    const enemies = standing.length ? standing : all;
    if (!enemies.length) return undefined;
    const current = enemies.find((f) => f.id === this.targetId);
    if (!current) this.retargetAt = 0;
    if (current && state.time < this.retargetAt) return current;
    // Prefer close, weak fighters; a dash of randomness keeps bots from dog-piling.
    const scored = enemies
      .map((f) => {
        const d = Math.hypot(f.pos.x - me.pos.x, f.pos.z - me.pos.z);
        return { f, score: d + f.hp * 0.04 + Math.random() * 3 };
      })
      .sort((a, b) => a.score - b.score);
    this.targetId = scored[0].f.id;
    this.retargetAt = state.time + 2 + Math.random() * 3;
    return scored[0].f;
  }

  private chooseCard(state: GameState, me: FighterState, target: FighterState, dist: number): Card | undefined {
    const hand = me.hand;
    if (!hand.length) return undefined;
    const roundLeft = state.phaseEndsAt - state.time;
    const engaged = dist < 6;
    const threatened = dist < 3 && attackDamage(target) >= 8;

    if (threatened && me.blockUntil <= state.time && me.reverseUntil <= state.time) {
      const def = hand.find((c) => c.kind === 'reverse') ?? (me.hp < 40 ? hand.find((c) => c.kind === 'block') : undefined);
      if (def) return def;
    }
    if (engaged || roundLeft < 8) {
      const buff = hand.find((c) => c.kind === 'number' || c.kind === 'multiplier');
      if (buff) return buff;
    }
    const lastHit = state.fighters.find((f) => f.id === me.lastPunchedId && f.alive);
    if (lastHit) {
      const targeted = hand.find((c) => c.kind === 'skip' || c.kind.startsWith('discard'));
      if (targeted) return targeted;
    }
    // Cards are lost at round end, so dump defensive cards late in the round.
    if (roundLeft < 4) return hand.find((c) => c.kind === 'block' || c.kind === 'reverse');
    return undefined;
  }
}

function cardValue(c: Card): number {
  switch (c.kind) {
    case 'reverse':
      return 30;
    case 'multiplier':
      return 25;
    case 'block':
      return 20;
    case 'number':
      return c.value * 2;
    default:
      return 12;
  }
}

import { CONFIG } from '../config';
import { dealHand, discardFilter } from './cards';
import { nextRandom } from './rng';
import type {
  Card,
  Command,
  FighterState,
  GameEvent,
  GameState,
  PendingEffect,
  TargetedKind,
} from './types';

export interface FighterSetup {
  id: string;
  name: string;
  isBot: boolean;
  color: number;
}

export interface GameOptions {
  seed?: number;
  /** Seconds before round 1 starts. */
  countdown?: number;
}

/** Punch damage: (base + all number buffs) × every multiplier buff. */
export function attackDamage(f: FighterState): number {
  let add = CONFIG.combat.baseDamage;
  let mult = 1;
  for (const b of f.buffs) {
    if (b.kind === 'number') add += b.value;
    else mult *= b.value;
  }
  return add * mult;
}

export function isBlocking(f: FighterState, time: number): boolean {
  return f.blockUntil > time;
}

export function isReversing(f: FighterState, time: number): boolean {
  return f.reverseUntil > time;
}

/**
 * Authoritative simulation. All mutations go through `dispatch(command)` and
 * `step(dt)`; both append to an event list that `drainEvents()` hands to the
 * presentation layer. Card plays only enter through the `playCard` command.
 */
export class Game {
  readonly state: GameState;
  private events: GameEvent[] = [];

  constructor(setups: FighterSetup[], opts: GameOptions = {}) {
    const n = setups.length;
    const spawnRadius = CONFIG.arena.radius * 0.45;
    this.state = {
      time: 0,
      phase: 'countdown',
      round: 0,
      phaseEndsAt: opts.countdown ?? 3,
      fighters: setups.map((s, i) => {
        const angle = (i / n) * Math.PI * 2;
        const pos = { x: Math.sin(angle) * spawnRadius, z: Math.cos(angle) * spawnRadius };
        return {
          ...s,
          hp: CONFIG.match.maxHp,
          alive: true,
          pos,
          vel: { x: 0, z: 0 },
          facing: Math.atan2(-pos.x, -pos.z),
          hand: [],
          buffs: [],
          blockUntil: 0,
          reverseUntil: 0,
          skipped: false,
          punchReadyAt: 0,
          staggerUntil: 0,
          lastPunchAt: -10,
          lastPunchedId: null,
          queuedCards: [],
          input: { moveX: 0, moveZ: 0, aim: Math.atan2(-pos.x, -pos.z) },
          eliminatedRound: null,
        };
      }),
      pending: [],
      discardPicks: [],
      winnerId: null,
      rngState: opts.seed ?? (Math.random() * 2 ** 31) | 0,
      nextId: 1,
    };
  }

  fighter(id: string | null): FighterState | undefined {
    return id ? this.state.fighters.find((f) => f.id === id) : undefined;
  }

  drainEvents(): GameEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  // ---------------------------------------------------------------- commands

  dispatch(cmd: Command): void {
    const f = this.fighter(cmd.fighterId);
    if (!f || !f.alive) return;
    switch (cmd.type) {
      case 'input': {
        const len = Math.hypot(cmd.moveX, cmd.moveZ);
        const k = len > 1 ? 1 / len : 1;
        f.input = { moveX: cmd.moveX * k, moveZ: cmd.moveZ * k, aim: cmd.aim };
        break;
      }
      case 'punch':
        this.punch(f);
        break;
      case 'playCard':
        this.playCard(f, cmd.cardId);
        break;
      case 'discardPick':
        this.resolveDiscardPick(f.id, cmd.victimId, cmd.cardId);
        break;
    }
  }

  private punch(f: FighterState) {
    const s = this.state;
    if (s.phase !== 'round' || s.time < f.punchReadyAt) return;
    f.punchReadyAt = s.time + CONFIG.combat.punchCooldown;
    f.lastPunchAt = s.time;
    this.emit({ type: 'punch', fighterId: f.id });

    // Closest living fighter inside the range cone.
    let best: FighterState | undefined;
    let bestDist = Infinity;
    for (const o of s.fighters) {
      if (o === f || !o.alive) continue;
      const dx = o.pos.x - f.pos.x;
      const dz = o.pos.z - f.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > CONFIG.combat.punchRange || dist >= bestDist) continue;
      const angle = Math.atan2(dx, dz);
      if (Math.abs(wrapAngle(angle - f.facing)) > CONFIG.combat.punchArc) continue;
      best = o;
      bestDist = dist;
    }
    if (!best) return;

    f.lastPunchedId = best.id;
    const damage = attackDamage(f);
    const route = this.route(f.id, best.id, 'punch');
    if (route) this.damage(this.fighter(route.receiver)!, damage, route.giver !== f.id, route.giver);

    // Targeted cards that were waiting for a first punch now go out.
    if (f.alive && f.queuedCards.length) {
      const queued = f.queuedCards;
      f.queuedCards = [];
      for (const c of queued) this.launch(f, best, c.kind as TargetedKind);
    }
  }

  private playCard(f: FighterState, cardId: string) {
    const s = this.state;
    if (s.phase !== 'round') return;
    const idx = f.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return;
    const [card] = f.hand.splice(idx, 1);

    if (f.skipped) {
      f.skipped = false;
      this.emit({ type: 'cardSkipped', fighterId: f.id, card });
      return;
    }
    this.emit({ type: 'cardPlayed', fighterId: f.id, card });

    switch (card.kind) {
      case 'number':
      case 'multiplier':
        f.buffs.push({
          id: card.id,
          kind: card.kind,
          value: card.value,
          expiresAt: s.time + CONFIG.cards.buffSeconds,
        });
        break;
      case 'block':
        f.blockUntil = s.time + CONFIG.cards.blockSeconds;
        break;
      case 'reverse':
        f.reverseUntil = s.time + CONFIG.cards.reverseSeconds;
        break;
      default: {
        const target = this.fighter(f.lastPunchedId);
        if (target && target.alive) this.launch(f, target, card.kind);
        else {
          f.queuedCards.push(card);
          this.emit({ type: 'cardQueued', fighterId: f.id, card });
        }
      }
    }
  }

  private launch(source: FighterState, target: FighterState, kind: TargetedKind) {
    const firesAt = this.state.time + CONFIG.cards.warningSeconds;
    const p: PendingEffect = { id: `p${this.state.nextId++}`, kind, sourceId: source.id, targetId: target.id, firesAt };
    this.state.pending.push(p);
    this.emit({ type: 'warning', sourceId: source.id, targetId: target.id, kind, firesAt });
  }

  // -------------------------------------------------------------- resolution

  /**
   * Resolution order for anything aimed at another fighter: Block first (stops
   * everything), then Reverse (bounces back, up to the bounce cap), then it lands.
   * Returns who gave and who receives the effect, or null if blocked.
   */
  private route(
    sourceId: string,
    targetId: string,
    what: 'punch' | TargetedKind,
  ): { giver: string; receiver: string } | null {
    let giver = sourceId;
    let receiver = targetId;
    let bounce = 0;
    for (;;) {
      const r = this.fighter(receiver)!;
      if (isBlocking(r, this.state.time)) {
        this.emit({ type: 'blocked', sourceId: giver, targetId: receiver, what });
        return null;
      }
      if (isReversing(r, this.state.time) && bounce < CONFIG.cards.reverseBounceCap) {
        bounce++;
        this.emit({ type: 'reflected', sourceId: giver, reverserId: receiver, what, bounce });
        [giver, receiver] = [receiver, giver];
        continue;
      }
      return { giver, receiver };
    }
  }

  private firePending(p: PendingEffect) {
    const target = this.fighter(p.targetId);
    if (!target || !target.alive) return;
    const route = this.route(p.sourceId, p.targetId, p.kind);
    if (!route) return;
    const giver = this.fighter(route.giver)!;
    const victim = this.fighter(route.receiver)!;
    if (!victim.alive) return;
    this.emit({ type: 'effectLanded', sourceId: giver.id, targetId: victim.id, kind: p.kind });

    if (p.kind === 'skip') {
      victim.skipped = true;
      return;
    }
    const matching = victim.hand.filter(discardFilter(p.kind));
    this.emit({ type: 'spy', viewerId: giver.id, victimId: victim.id, kind: p.kind, cards: matching.map((c) => ({ ...c })) });
    if (p.kind === 'discard') {
      if (!matching.length) return;
      const expiresAt = this.state.time + CONFIG.cards.discardPickSeconds;
      this.state.discardPicks.push({ pickerId: giver.id, victimId: victim.id, expiresAt });
      this.emit({ type: 'discardPickStart', pickerId: giver.id, victimId: victim.id, expiresAt });
      return;
    }
    this.removeCards(giver.id, victim, matching);
  }

  private resolveDiscardPick(pickerId: string, victimId: string, cardId: string | null) {
    const s = this.state;
    const idx = s.discardPicks.findIndex((d) => d.pickerId === pickerId && d.victimId === victimId);
    if (idx < 0) return;
    s.discardPicks.splice(idx, 1);
    const victim = this.fighter(victimId);
    if (!victim || !victim.hand.length) return;
    let card = victim.hand.find((c) => c.id === cardId);
    if (!card) card = victim.hand[Math.floor(nextRandom(s) * victim.hand.length)];
    this.removeCards(pickerId, victim, [card]);
  }

  private removeCards(byId: string, victim: FighterState, cards: Card[]) {
    if (!cards.length) return;
    const ids = new Set(cards.map((c) => c.id));
    victim.hand = victim.hand.filter((c) => !ids.has(c.id));
    this.emit({ type: 'cardsRemoved', byId, victimId: victim.id, cards });
  }

  private damage(target: FighterState, amount: number, reflected: boolean, dealtBy: string) {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - amount);
    this.emit({ type: 'hit', attackerId: dealtBy, targetId: target.id, damage: amount, reflected });

    const giver = this.fighter(dealtBy);
    if (giver && giver !== target) {
      const dx = target.pos.x - giver.pos.x;
      const dz = target.pos.z - giver.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      target.vel.x = (dx / len) * CONFIG.combat.knockback;
      target.vel.z = (dz / len) * CONFIG.combat.knockback;
      target.staggerUntil = this.state.time + CONFIG.combat.staggerSeconds;
    }
    if (target.hp <= 0) this.eliminate(target, dealtBy === target.id ? null : dealtBy);
  }

  private eliminate(f: FighterState, byId: string | null) {
    f.alive = false;
    f.hand = [];
    f.buffs = [];
    f.queuedCards = [];
    f.eliminatedRound = this.state.round;
    this.state.pending = this.state.pending.filter((p) => p.targetId !== f.id && p.sourceId !== f.id);
    this.state.discardPicks = this.state.discardPicks.filter((d) => d.victimId !== f.id && d.pickerId !== f.id);
    this.emit({ type: 'eliminated', fighterId: f.id, byId });
    this.checkMatchOver();
  }

  private checkMatchOver(): boolean {
    const s = this.state;
    if (s.phase === 'over') return true;
    const alive = s.fighters.filter((f) => f.alive);
    if (alive.length > 1) return false;
    this.endMatch(alive[0]?.id ?? null);
    return true;
  }

  private endMatch(winnerId: string | null) {
    this.state.phase = 'over';
    this.state.winnerId = winnerId;
    this.clearRoundEffects();
    this.emit({ type: 'matchOver', winnerId });
  }

  // ------------------------------------------------------------------- round

  private startRound() {
    const s = this.state;
    s.round++;
    s.phase = 'round';
    s.phaseEndsAt = s.time + CONFIG.match.roundSeconds;
    for (const f of s.fighters) if (f.alive) f.hand = dealHand(s);
    this.emit({ type: 'roundStart', round: s.round });
  }

  /** Buffs, shields, skips, queued and in-flight cards all vanish at round end; unplayed cards are lost. */
  private clearRoundEffects() {
    const s = this.state;
    for (const f of s.fighters) {
      f.buffs = [];
      f.blockUntil = 0;
      f.reverseUntil = 0;
      f.skipped = false;
      f.queuedCards = [];
      f.hand = [];
    }
    s.pending = [];
    s.discardPicks = [];
  }

  private endRound() {
    const s = this.state;
    this.clearRoundEffects();
    this.emit({ type: 'roundEnd', round: s.round });
    if (s.round >= CONFIG.match.maxRounds) {
      const alive = s.fighters.filter((f) => f.alive).sort((a, b) => b.hp - a.hp);
      const tie = alive.length > 1 && alive[0].hp === alive[1].hp;
      this.endMatch(tie ? null : alive[0]?.id ?? null);
      return;
    }
    s.phase = 'intermission';
    s.phaseEndsAt = s.time + CONFIG.match.intermissionSeconds;
  }

  // -------------------------------------------------------------------- step

  step(dt: number): void {
    const s = this.state;
    if (s.phase === 'over') {
      this.integrate(dt);
      s.time += dt;
      return;
    }
    s.time += dt;

    if (s.phase === 'round') {
      for (const f of s.fighters) f.buffs = f.buffs.filter((b) => b.expiresAt > s.time);

      const due = s.pending.filter((p) => p.firesAt <= s.time);
      if (due.length) {
        s.pending = s.pending.filter((p) => p.firesAt > s.time);
        for (const p of due) {
          this.firePending(p);
          if (s.phase !== 'round') return;
        }
      }
      for (const d of [...s.discardPicks]) {
        if (d.expiresAt <= s.time) this.resolveDiscardPick(d.pickerId, d.victimId, null);
      }
    }

    this.integrate(dt);

    if (s.time >= s.phaseEndsAt) {
      if (s.phase === 'round') this.endRound();
      else if (s.phase === 'countdown' || s.phase === 'intermission') this.startRound();
    }
  }

  private integrate(dt: number) {
    const s = this.state;
    const { moveSpeed, turnSpeed, radius, fighterRadius } = CONFIG.arena;
    const canMove = s.phase === 'round' || s.phase === 'intermission' || s.phase === 'over';
    for (const f of s.fighters) {
      if (!f.alive) continue;
      const staggered = f.staggerUntil > s.time;
      const control = canMove && !staggered;
      const tx = control ? f.input.moveX * moveSpeed : 0;
      const tz = control ? f.input.moveZ * moveSpeed : 0;
      const blend = Math.min(1, dt * (staggered ? 3 : 12));
      f.vel.x += (tx - f.vel.x) * blend;
      f.vel.z += (tz - f.vel.z) * blend;
      f.pos.x += f.vel.x * dt;
      f.pos.z += f.vel.z * dt;
      f.facing += wrapAngle(f.input.aim - f.facing) * Math.min(1, dt * turnSpeed);
      f.facing = wrapAngle(f.facing);

      const d = Math.hypot(f.pos.x, f.pos.z);
      const max = radius - fighterRadius;
      if (d > max) {
        f.pos.x *= max / d;
        f.pos.z *= max / d;
      }
    }
    // Push overlapping fighters apart.
    const alive = s.fighters.filter((f) => f.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const dist = Math.hypot(dx, dz) || 0.0001;
        const overlap = fighterRadius * 2 - dist;
        if (overlap > 0) {
          const px = (dx / dist) * overlap * 0.5;
          const pz = (dz / dist) * overlap * 0.5;
          a.pos.x -= px;
          a.pos.z -= pz;
          b.pos.x += px;
          b.pos.z += pz;
        }
      }
    }
  }
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}


/**
 * Pure data types for the simulation. Nothing in src/core imports rendering or DOM
 * code, so the same rules can run on a server or in a lockstep/authoritative
 * multiplayer layer later.
 */

export type CardKind =
  | 'number'
  | 'multiplier'
  | 'block'
  | 'reverse'
  | 'skip'
  | 'discard'
  | 'discardAction'
  | 'discardAttack'
  | 'discardMultipliers';

export interface Card {
  id: string;
  kind: CardKind;
  /** Number value (1-9) for number cards, factor for multipliers, 0 otherwise. */
  value: number;
}

/** A card that hits another fighter and therefore goes through Block/Reverse. */
export type TargetedKind = 'skip' | 'discard' | 'discardAction' | 'discardAttack' | 'discardMultipliers';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Buff {
  id: string;
  kind: 'number' | 'multiplier';
  value: number;
  expiresAt: number;
}

export interface FighterState {
  id: string;
  name: string;
  isBot: boolean;
  color: number;
  hp: number;
  alive: boolean;
  pos: Vec2;
  vel: Vec2;
  /** Yaw in radians; 0 faces +z. */
  facing: number;
  hand: Card[];
  buffs: Buff[];
  blockUntil: number;
  reverseUntil: number;
  /** Next card played does nothing. Cleared when a card is used or the round ends. */
  skipped: boolean;
  punchReadyAt: number;
  /** Knocked back and not in control until this time. */
  staggerUntil: number;
  /** Time of the last punch thrown (for animation). */
  lastPunchAt: number;
  /** Fighter this one last landed a punch on. Skip/Discard target them. */
  lastPunchedId: string | null;
  /** Targeted cards played before landing any punch; they fire on the first punch. */
  queuedCards: Card[];
  /** Current movement intent, set by input commands. */
  input: { moveX: number; moveZ: number; aim: number };
  eliminatedRound: number | null;
}

/** A targeted card on its way to a target, giving them a short warning window. */
export interface PendingEffect {
  id: string;
  kind: TargetedKind;
  sourceId: string;
  targetId: string;
  firesAt: number;
}

/** Plain Discard that resolved: the picker sees the victim's hand and chooses a card. */
export interface DiscardPick {
  pickerId: string;
  victimId: string;
  expiresAt: number;
}

export type Phase = 'countdown' | 'round' | 'intermission' | 'over';

export interface GameState {
  time: number;
  phase: Phase;
  round: number;
  /** Time at which the current phase ends. */
  phaseEndsAt: number;
  fighters: FighterState[];
  pending: PendingEffect[];
  discardPicks: DiscardPick[];
  winnerId: string | null;
  rngState: number;
  nextId: number;
}

/**
 * Everything a client can ask the simulation to do. These are plain serialisable
 * objects: a network layer only needs to ship them to the authority.
 */
export type Command =
  | { type: 'input'; fighterId: string; moveX: number; moveZ: number; aim: number }
  | { type: 'punch'; fighterId: string }
  | { type: 'playCard'; fighterId: string; cardId: string }
  | { type: 'discardPick'; fighterId: string; victimId: string; cardId: string };

/** Things that happened during a step. Rendering, audio and UI subscribe to these. */
export type GameEvent =
  | { type: 'roundStart'; round: number }
  | { type: 'roundEnd'; round: number }
  | { type: 'punch'; fighterId: string }
  | { type: 'hit'; attackerId: string; targetId: string; damage: number; reflected: boolean }
  | { type: 'blocked'; sourceId: string; targetId: string; what: 'punch' | TargetedKind }
  | { type: 'reflected'; sourceId: string; reverserId: string; what: 'punch' | TargetedKind; bounce: number }
  | { type: 'cardPlayed'; fighterId: string; card: Card }
  | { type: 'cardSkipped'; fighterId: string; card: Card }
  | { type: 'cardQueued'; fighterId: string; card: Card }
  | { type: 'warning'; sourceId: string; targetId: string; kind: TargetedKind; firesAt: number }
  | { type: 'effectLanded'; sourceId: string; targetId: string; kind: TargetedKind }
  | { type: 'cardsRemoved'; byId: string; victimId: string; cards: Card[] }
  | { type: 'spy'; viewerId: string; victimId: string; kind: TargetedKind; cards: Card[] }
  | { type: 'discardPickStart'; pickerId: string; victimId: string; expiresAt: number }
  | { type: 'eliminated'; fighterId: string; byId: string | null }
  | { type: 'matchOver'; winnerId: string | null };

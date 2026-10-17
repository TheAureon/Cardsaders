/**
 * Single source of truth for the game's name and every tunable number.
 * Change GAME_NAME here to rebrand (e.g. "Cardsade").
 */
export const GAME_NAME = 'Cardsaders';

export const CONFIG = {
  match: {
    /** Fighters in a match, including the player. Brief: 4-5. */
    defaultFighters: 4,
    minFighters: 4,
    maxFighters: 5,
    maxHp: 100,
    /** Round length in seconds. Brief: 30-45. */
    roundSeconds: 35,
    /** Pause between rounds (no movement, no damage). */
    intermissionSeconds: 3,
    /** Safety net so a match can't stall forever: after this round, highest HP wins. */
    maxRounds: 12,
  },

  combat: {
    baseDamage: 1,
    punchCooldown: 0.5,
    /** Max distance between fighter centres for a punch to land. */
    punchRange: 2.0,
    /** Half-angle of the punch cone in radians (in front of the fighter). */
    punchArc: 0.75,
    /** Speed a hit shoves the target back with, and how long they lose control. */
    knockback: 9,
    staggerSeconds: 0.3,
  },

  cards: {
    handSize: 7,
    buffSeconds: 30,
    blockSeconds: 3,
    reverseSeconds: 3,
    reverseBounceCap: 3,
    /** Warning the target sees before Skip/Discard lands. */
    warningSeconds: 1,
    multiplierValue: 2,
    /** How long a plain Discard lets you pick before it picks randomly. */
    discardPickSeconds: 5,
    /** How long a spy reveal stays on screen. */
    spySeconds: 3,
    /**
     * Relative draw weights, most to least common. Per-card weights, so a tier with
     * several card kinds is the sum of its members.
     */
    weights: {
      number: 34,
      skip: 12,
      block: 10,
      multiplier: 6,
      discard: 5,
      discardAction: 5,
      discardAttack: 5,
      discardMultipliers: 5,
      reverse: 4,
    },
    /** Relative weights of number values 1..9; low numbers are more common. */
    numberValueWeights: [14, 13, 12, 11, 10, 8, 6, 4, 3],
    /** Minimum number cards per hand ("almost guaranteed to appear"). */
    minNumberCards: 1,
  },

  arena: {
    radius: 14,
    fighterRadius: 0.6,
    moveSpeed: 6,
    turnSpeed: 14,
  },

  bots: {
    names: ['Sir Brawlsworth', 'Dame Knuckla', 'Brother Jab', 'Lady Uppercut', 'Baron Haymaker', 'Friar Hook'],
  },
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotTuning {
  /** Delay before punching / reacting to a warning. */
  reaction: number;
  /** Max aim offset in radians; bigger means more whiffs. */
  aimError: number;
  /** Seconds between card decisions. */
  cardThink: number;
  /** Chance to answer a Skip/Discard warning with Block/Reverse. */
  defendChance: number;
  /** Average length of an aggressive burst, then of a wary circling phase. */
  engageSeconds: number;
  circleSeconds: number;
}

export const BOT_DIFFICULTY: Record<Difficulty, BotTuning> = {
  easy: { reaction: 0.6, aimError: 1.4, cardThink: 2.5, defendChance: 0.25, engageSeconds: 1.5, circleSeconds: 4 },
  normal: { reaction: 0.35, aimError: 1.05, cardThink: 1.4, defendChance: 0.55, engageSeconds: 2, circleSeconds: 3 },
  hard: { reaction: 0.2, aimError: 0.75, cardThink: 0.8, defendChance: 0.85, engageSeconds: 3, circleSeconds: 2 },
};

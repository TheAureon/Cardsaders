import { CONFIG } from '../config';
import { nextRandom } from './rng';
import type { Card, CardKind, GameState, TargetedKind } from './types';

export const ACTION_KINDS: readonly CardKind[] = [
  'block',
  'reverse',
  'skip',
  'discard',
  'discardAction',
  'discardAttack',
  'discardMultipliers',
];

export const TARGETED_KINDS: readonly TargetedKind[] = [
  'skip',
  'discard',
  'discardAction',
  'discardAttack',
  'discardMultipliers',
];

export function isTargeted(kind: CardKind): kind is TargetedKind {
  return (TARGETED_KINDS as readonly CardKind[]).includes(kind);
}

export function isAction(kind: CardKind): boolean {
  return ACTION_KINDS.includes(kind);
}

/** Which of the victim's cards a given discard card reveals and removes. */
export function discardFilter(kind: TargetedKind): (card: Card) => boolean {
  switch (kind) {
    case 'discardAction':
      return (c) => isAction(c.kind);
    case 'discardAttack':
      return (c) => c.kind === 'number';
    case 'discardMultipliers':
      return (c) => c.kind === 'multiplier';
    default:
      return () => true;
  }
}

export const CARD_INFO: Record<CardKind, { name: string; short: string; desc: string }> = {
  number: { name: 'Number', short: '+', desc: 'Adds its value to your punch damage for 30 sec.' },
  multiplier: { name: 'Multiplier', short: '×', desc: 'Multiplies your whole punch (base + numbers) for 30 sec.' },
  block: { name: 'Block', short: 'BLK', desc: 'Blocks every punch and card aimed at you for 3 sec.' },
  reverse: { name: 'Reverse', short: 'REV', desc: 'Reflects every punch and card aimed at you back at the attacker for 3 sec.' },
  skip: { name: 'Skip', short: 'SKIP', desc: "Your last punched foe's next card does nothing." },
  discard: { name: 'Discard', short: 'DISC', desc: 'Peek at your last punched foe\'s hand and remove one card.' },
  discardAction: { name: 'Discard Action', short: 'D-ACT', desc: 'Remove all action cards from your last punched foe.' },
  discardAttack: { name: 'Discard Attack', short: 'D-ATK', desc: 'Remove all number cards from your last punched foe.' },
  discardMultipliers: { name: 'Discard Multipliers', short: 'D-MUL', desc: 'Remove all multiplier cards from your last punched foe.' },
};

export function cardLabel(card: Card): string {
  if (card.kind === 'number') return `+${card.value}`;
  if (card.kind === 'multiplier') return `×${card.value}`;
  return CARD_INFO[card.kind].name;
}

function rollKind(state: GameState): CardKind {
  const weights = CONFIG.cards.weights;
  const entries = Object.entries(weights) as [CardKind, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = nextRandom(state) * total;
  for (const [kind, w] of entries) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return 'number';
}

function rollNumberValue(state: GameState): number {
  const weights = CONFIG.cards.numberValueWeights;
  let roll = nextRandom(state) * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i + 1;
  }
  return 1;
}

export function makeCard(state: GameState, kind: CardKind): Card {
  const value =
    kind === 'number' ? rollNumberValue(state) : kind === 'multiplier' ? CONFIG.cards.multiplierValue : 0;
  return { id: `c${state.nextId++}`, kind, value };
}

export function dealHand(state: GameState): Card[] {
  const hand: Card[] = [];
  for (let i = 0; i < CONFIG.cards.handSize; i++) hand.push(makeCard(state, rollKind(state)));
  // Number cards are "almost guaranteed": top up if the roll came out short.
  let numbers = hand.filter((c) => c.kind === 'number').length;
  for (let i = hand.length - 1; i >= 0 && numbers < CONFIG.cards.minNumberCards; i--) {
    if (hand[i].kind !== 'number') {
      hand[i] = makeCard(state, 'number');
      numbers++;
    }
  }
  return hand;
}

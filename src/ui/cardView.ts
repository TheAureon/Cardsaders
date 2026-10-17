import { CARD_INFO } from '../core/cards';
import type { Card } from '../core/types';

const NUMBER_COLORS = ['red', 'yellow', 'green', 'blue'] as const;

const ACTION_STYLE: Record<Exclude<Card['kind'], 'number'>, { color: string; glyph: string; label: string }> = {
  multiplier: { color: 'wild', glyph: '×2', label: 'MULTI' },
  block: { color: 'blue', glyph: '🛡', label: 'BLOCK' },
  reverse: { color: 'green', glyph: '⇄', label: 'REVERSE' },
  skip: { color: 'red', glyph: '⊘', label: 'SKIP' },
  discard: { color: 'yellow', glyph: '✋', label: 'DISCARD' },
  discardAction: { color: 'orange', glyph: '✋', label: 'D·ACTION' },
  discardAttack: { color: 'orange', glyph: '✋', label: 'D·ATTACK' },
  discardMultipliers: { color: 'orange', glyph: '✋', label: 'D·MULTI' },
};

export function cardStyle(card: Card): { color: string; glyph: string; label: string } {
  if (card.kind === 'number') {
    return { color: NUMBER_COLORS[(card.value - 1) % 4], glyph: String(card.value), label: `+${card.value} DMG` };
  }
  const s = ACTION_STYLE[card.kind];
  return card.kind === 'multiplier' ? { ...s, glyph: `×${card.value}` } : s;
}

/** Builds an Uno-style card element. */
export function renderCard(card: Card, size: 'hand' | 'mini' = 'hand'): HTMLDivElement {
  const s = cardStyle(card);
  const el = document.createElement('div');
  el.className = `card card-${s.color} card-${size}`;
  el.dataset.cardId = card.id;
  el.title = `${CARD_INFO[card.kind].name}: ${CARD_INFO[card.kind].desc}`;
  el.innerHTML = `
    <span class="corner tl">${s.glyph}</span>
    <div class="oval"><span class="glyph">${s.glyph}</span></div>
    <span class="label">${s.label}</span>
    <span class="corner br">${s.glyph}</span>`;
  return el;
}

export function renderCardBack(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'card-back';
  return el;
}

import { CONFIG } from '../config';
import { CARD_INFO, cardLabel } from '../core/cards';
import { attackDamage } from '../core/game';
import type { Card, FighterState, GameEvent, GameState } from '../core/types';
import type { ArenaRenderer } from '../render/arena';
import { renderCard, renderCardBack } from './cardView';

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

function hex(color: number) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function h(tag: string, cls = '', text = ''): HTMLElement {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
}

interface Warning {
  el: HTMLElement;
  firesAt: number;
}

/**
 * DOM heads-up display. Reads state each frame and listens to game events.
 * Card plays leave through the `onPlayCard` callback, which main wires to a
 * `playCard` command.
 */
export class Hud {
  onPlayCard: (cardId: string) => void = () => {};
  onDiscardPick: (victimId: string, cardId: string) => void = () => {};

  private root = $('#hud');
  private handEl = $('#hand');
  private enemiesEl = $('#enemies');
  private labelsEl = $('#labels');
  private floatersEl = $('#floaters');
  private feedEl = $('#feed');
  private bannerEl = $('#banner');
  private warningsEl = $('#warnings');
  private spyEl = $('#spy');
  private pickEl = $('#discard-pick');
  private handSig = '';
  private enemyRows = new Map<string, HTMLElement>();
  private labels = new Map<string, HTMLElement>();
  private warnings: Warning[] = [];
  private spyUntil = 0;
  private pick: { victimId: string; expiresAt: number } | null = null;
  private bannerUntil = 0;

  constructor(
    private readonly playerId: string,
    private readonly view: ArenaRenderer,
  ) {
    this.root.classList.remove('hidden');
    this.handEl.addEventListener('dblclick', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.card');
      if (el?.dataset.cardId) this.playFromHand(el);
    });
    window.addEventListener('keydown', (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const el = this.handEl.querySelectorAll<HTMLElement>('.card')[n - 1];
        if (el) this.playFromHand(el);
      }
    });
  }

  private playFromHand(el: HTMLElement) {
    this.onPlayCard(el.dataset.cardId!);
  }

  reset() {
    this.enemiesEl.innerHTML = '';
    this.labelsEl.innerHTML = '';
    this.floatersEl.innerHTML = '';
    this.feedEl.innerHTML = '';
    this.warningsEl.innerHTML = '';
    this.handEl.innerHTML = '';
    this.enemyRows.clear();
    this.labels.clear();
    this.warnings = [];
    this.handSig = '';
    this.closePick();
    this.spyEl.classList.add('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  // --------------------------------------------------------------- events

  handle(state: GameState, e: GameEvent) {
    const name = (id: string | null) => state.fighters.find((f) => f.id === id)?.name ?? '?';
    const me = this.playerId;
    switch (e.type) {
      case 'roundStart':
        this.showBanner(`Round ${e.round}`, 'Fight!', 1.6, state.time);
        break;
      case 'roundEnd':
        this.showBanner('Round over', 'Buffs fade, hands are lost', 2.5, state.time);
        this.clearWarnings();
        this.closePick();
        break;
      case 'hit': {
        const t = state.fighters.find((f) => f.id === e.targetId)!;
        this.floater(t, `-${e.damage}`, e.reflected ? 'dmg reflected' : e.targetId === me ? 'dmg mine' : 'dmg');
        break;
      }
      case 'blocked': {
        const t = state.fighters.find((f) => f.id === e.targetId)!;
        this.floater(t, 'BLOCKED', 'status block');
        if (e.what !== 'punch') this.log(`${name(e.targetId)} blocked ${CARD_INFO[e.what].name} from ${name(e.sourceId)}`);
        break;
      }
      case 'reflected': {
        const t = state.fighters.find((f) => f.id === e.reverserId)!;
        this.floater(t, e.bounce > 1 ? `REVERSE ×${e.bounce}` : 'REVERSE', 'status reverse');
        if (e.what !== 'punch') this.log(`${name(e.reverserId)} reversed ${CARD_INFO[e.what].name} back at ${name(e.sourceId)}`);
        break;
      }
      case 'cardPlayed':
        if (e.fighterId !== me) this.log(`${name(e.fighterId)} played ${cardLabel(e.card)}`, 'dim');
        break;
      case 'cardSkipped': {
        const f = state.fighters.find((x) => x.id === e.fighterId)!;
        this.floater(f, 'SKIPPED', 'status skip');
        this.log(`${name(e.fighterId)}'s ${cardLabel(e.card)} was skipped!`);
        break;
      }
      case 'cardQueued':
        if (e.fighterId === me) this.log(`${CARD_INFO[e.card.kind].name} is waiting for your first punch`, 'mine');
        break;
      case 'warning':
        if (e.targetId === me) this.addWarning(name(e.sourceId), e.kind, e.firesAt);
        else if (e.sourceId === me) this.log(`${CARD_INFO[e.kind].name} flying at ${name(e.targetId)}…`, 'mine');
        break;
      case 'effectLanded':
        this.log(`${CARD_INFO[e.kind].name}: ${name(e.sourceId)} → ${name(e.targetId)}`, e.targetId === me ? 'bad' : '');
        break;
      case 'cardsRemoved':
        if (e.victimId === me) this.log(`${name(e.byId)} discarded your ${e.cards.map(cardLabel).join(', ')}`, 'bad');
        else if (e.byId === me) this.log(`You discarded ${e.cards.length} card(s) from ${name(e.victimId)}`, 'mine');
        break;
      case 'spy':
        if (e.viewerId === me) this.showSpy(name(e.victimId), e.kind, e.cards, state.time);
        break;
      case 'discardPickStart':
        if (e.pickerId === me) this.openPick(state, e.victimId, e.expiresAt);
        break;
      case 'eliminated':
        this.log(
          e.byId ? `☠ ${name(e.byId)} knocked out ${name(e.fighterId)}` : `☠ ${name(e.fighterId)} is out`,
          e.fighterId === me ? 'bad' : '',
        );
        if (e.fighterId === me) this.showBanner('Knocked out!', 'Spectating…', 3, state.time);
        break;
    }
  }

  private log(text: string, cls = '') {
    const el = h('div', `feed-item ${cls}`, text);
    this.feedEl.prepend(el);
    while (this.feedEl.children.length > 6) this.feedEl.lastElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 4500);
    setTimeout(() => el.remove(), 5500);
  }

  private showBanner(title: string, sub: string, seconds: number, now: number) {
    this.bannerEl.innerHTML = `<div class="banner-title">${title}</div><div class="banner-sub">${sub}</div>`;
    this.bannerEl.classList.remove('hidden', 'pop');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('pop');
    this.bannerUntil = now + seconds;
  }

  private floater(f: FighterState, text: string, cls: string) {
    const p = this.view.project(f.pos.x, 2.6, f.pos.z);
    if (!p.visible) return;
    const el = h('div', `floater ${cls}`, text);
    el.style.left = `${p.x + (Math.random() - 0.5) * 30}px`;
    el.style.top = `${p.y}px`;
    this.floatersEl.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  private addWarning(from: string, kind: Card['kind'], firesAt: number) {
    const el = h('div', 'warning');
    el.innerHTML = `<b>⚠ ${CARD_INFO[kind].name}</b> incoming from ${from}! <span class="hint">Block or Reverse!</span><div class="warn-bar"><div></div></div>`;
    this.warningsEl.appendChild(el);
    this.warnings.push({ el, firesAt });
  }

  private clearWarnings() {
    for (const w of this.warnings) w.el.remove();
    this.warnings = [];
  }

  private showSpy(victim: string, kind: Card['kind'], cards: Card[], now: number) {
    this.spyEl.innerHTML = '';
    const title = kind === 'discard' ? `${victim}'s hand` : `${victim}'s ${spyNoun(kind)}`;
    this.spyEl.appendChild(h('div', 'spy-title', `👁 ${title}`));
    const row = h('div', 'spy-row');
    if (!cards.length) row.appendChild(h('div', 'spy-empty', 'none!'));
    for (const c of cards) row.appendChild(renderCard(c, 'mini'));
    this.spyEl.appendChild(row);
    this.spyEl.classList.remove('hidden');
    this.spyUntil = now + CONFIG.cards.spySeconds;
  }

  private openPick(state: GameState, victimId: string, expiresAt: number) {
    const victim = state.fighters.find((f) => f.id === victimId);
    if (!victim) return;
    this.pick = { victimId, expiresAt };
    this.spyEl.classList.add('hidden');
    this.pickEl.innerHTML = '';
    this.pickEl.appendChild(h('div', 'pick-title', `Discard: pick one of ${victim.name}'s cards`));
    const row = h('div', 'pick-row');
    for (const c of victim.hand) {
      const el = renderCard(c, 'hand');
      el.addEventListener('click', () => {
        this.onDiscardPick(victimId, c.id);
        this.closePick();
      });
      row.appendChild(el);
    }
    this.pickEl.appendChild(row);
    this.pickEl.appendChild(h('div', 'pick-timer'));
    this.pickEl.classList.remove('hidden');
  }

  private closePick() {
    this.pick = null;
    this.pickEl.classList.add('hidden');
  }

  // ---------------------------------------------------------------- frame

  update(state: GameState) {
    const t = state.time;
    const me = state.fighters.find((f) => f.id === this.playerId)!;

    // Timer + round.
    const left = Math.max(0, state.phaseEndsAt - t);
    $('#round-label').textContent =
      state.phase === 'countdown' ? 'Get ready' : state.phase === 'intermission' ? `Round ${state.round + 1} in` : `Round ${state.round}`;
    const timer = $('#round-timer');
    timer.textContent = state.phase === 'over' ? '—' : String(Math.ceil(left));
    timer.classList.toggle('urgent', state.phase === 'round' && left < 6);

    if (t > this.bannerUntil) this.bannerEl.classList.add('hidden');
    if (t > this.spyUntil) this.spyEl.classList.add('hidden');

    this.updateHand(me);
    this.updatePlayerPanel(me, state);
    this.updateEnemies(state);
    this.updateLabels(state);

    this.warnings = this.warnings.filter((w) => {
      const remain = w.firesAt - t;
      if (remain <= -0.2 || state.phase !== 'round') {
        w.el.remove();
        return false;
      }
      const bar = w.el.querySelector<HTMLElement>('.warn-bar > div')!;
      bar.style.width = `${Math.max(0, remain / CONFIG.cards.warningSeconds) * 100}%`;
      return true;
    });

    if (this.pick) {
      const still = state.discardPicks.some((d) => d.pickerId === this.playerId && d.victimId === this.pick!.victimId);
      if (!still) this.closePick();
      else {
        const remain = Math.max(0, this.pick.expiresAt - t);
        this.pickEl.querySelector('.pick-timer')!.textContent = `${remain.toFixed(1)}s, then a random card goes`;
      }
    }
  }

  private updateHand(me: FighterState) {
    const sig = me.hand.map((c) => c.id).join(',') + (me.alive ? '' : 'x');
    if (sig === this.handSig) return;
    this.handSig = sig;
    this.handEl.innerHTML = '';
    me.hand.forEach((c, i) => {
      const el = renderCard(c, 'hand');
      el.style.setProperty('--i', String(i));
      el.appendChild(h('span', 'hotkey', String(i + 1)));
      this.handEl.appendChild(el);
    });
    $('#hand-count').textContent = `${me.hand.length} card${me.hand.length === 1 ? '' : 's'}`;
  }

  private updatePlayerPanel(me: FighterState, state: GameState) {
    const t = state.time;
    const hpPct = (me.hp / CONFIG.match.maxHp) * 100;
    $('#player-hp-fill').style.width = `${hpPct}%`;
    $('#player-hp-fill').classList.toggle('low', hpPct < 30);
    $('#player-hp-text').textContent = `${Math.ceil(me.hp)} HP`;

    const add = me.buffs.filter((b) => b.kind === 'number').reduce((s, b) => s + b.value, CONFIG.combat.baseDamage);
    const mults = me.buffs.filter((b) => b.kind === 'multiplier').map((b) => b.value);
    const formula = mults.length ? `(${add}) × ${mults.join(' × ')}` : `${add}`;
    $('#player-dmg').innerHTML = `👊 <b>${attackDamage(me)}</b> <span class="formula">${formula === String(attackDamage(me)) ? '' : `= ${formula}`}</span>`;

    const statusEl = $('#player-status');
    const chips: string[] = [];
    if (me.blockUntil > t) chips.push(`<span class="chip chip-block">🛡 Block ${(me.blockUntil - t).toFixed(1)}</span>`);
    if (me.reverseUntil > t) chips.push(`<span class="chip chip-reverse">⇄ Reverse ${(me.reverseUntil - t).toFixed(1)}</span>`);
    if (me.skipped) chips.push(`<span class="chip chip-skip">⊘ Next card skipped</span>`);
    for (const c of me.queuedCards) chips.push(`<span class="chip chip-queued">⏳ ${CARD_INFO[c.kind].name}: land a punch</span>`);
    for (const b of me.buffs) {
      const remain = b.expiresAt - t;
      const pct = (remain / CONFIG.cards.buffSeconds) * 100;
      chips.push(
        `<span class="chip chip-${b.kind}" style="--pct:${pct}%">${b.kind === 'number' ? '+' : '×'}${b.value} <small>${Math.ceil(remain)}s</small></span>`,
      );
    }
    const html = chips.join('');
    if (statusEl.innerHTML !== html) statusEl.innerHTML = html;

    const target = state.fighters.find((f) => f.id === me.lastPunchedId && f.alive);
    $('#player-target').textContent = target
      ? `🎯 Skip/Discard hit: ${target.name}`
      : '🎯 No target: punch someone first';
  }

  private updateEnemies(state: GameState) {
    const t = state.time;
    for (const f of state.fighters) {
      if (f.id === this.playerId) continue;
      let row = this.enemyRows.get(f.id);
      if (!row) {
        row = h('div', 'enemy');
        row.innerHTML = `
          <div class="enemy-head"><span class="dot" style="background:${hex(f.color)}"></span><span class="enemy-name">${f.name}</span><span class="enemy-icons"></span></div>
          <div class="hpbar"><div class="hpfill"></div></div>
          <div class="enemy-cards"></div>`;
        this.enemiesEl.appendChild(row);
        this.enemyRows.set(f.id, row);
      }
      row.classList.toggle('dead', !f.alive);
      row.classList.toggle('targeted', state.fighters.find((x) => x.id === this.playerId)?.lastPunchedId === f.id);
      $('.hpfill', row).style.width = `${(f.hp / CONFIG.match.maxHp) * 100}%`;
      const icons: string[] = [];
      if (!f.alive) icons.push('☠');
      if (f.blockUntil > t) icons.push('🛡');
      if (f.reverseUntil > t) icons.push('⇄');
      if (f.skipped) icons.push('⊘');
      const dmg = attackDamage(f);
      if (dmg > 1) icons.push(`👊${dmg}`);
      $('.enemy-icons', row).textContent = icons.join(' ');
      const cardsEl = $('.enemy-cards', row);
      if (cardsEl.childElementCount !== f.hand.length || cardsEl.dataset.n !== String(f.hand.length)) {
        cardsEl.innerHTML = '';
        cardsEl.dataset.n = String(f.hand.length);
        for (let i = 0; i < f.hand.length; i++) cardsEl.appendChild(renderCardBack());
        const n = h('span', 'enemy-count', `${f.hand.length}`);
        cardsEl.appendChild(n);
      }
    }
  }

  private updateLabels(state: GameState) {
    for (const f of state.fighters) {
      let el = this.labels.get(f.id);
      if (!el) {
        el = h('div', f.id === this.playerId ? 'nameplate me' : 'nameplate');
        el.innerHTML = `<div class="nameplate-name">${f.id === this.playerId ? 'You' : f.name}</div><div class="hpbar small"><div class="hpfill"></div></div>`;
        this.labelsEl.appendChild(el);
        this.labels.set(f.id, el);
      }
      const p = this.view.project(f.pos.x, 2.75, f.pos.z);
      el.style.display = f.alive && p.visible ? '' : 'none';
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
      $('.hpfill', el).style.width = `${(f.hp / CONFIG.match.maxHp) * 100}%`;
    }
  }
}

function spyNoun(kind: Card['kind']): string {
  if (kind === 'discardAction') return 'action cards';
  if (kind === 'discardAttack') return 'number cards';
  if (kind === 'discardMultipliers') return 'multipliers';
  return 'cards';
}

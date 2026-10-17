import './style.css';
import { BotBrain } from './ai/bot';
import { CONFIG, GAME_NAME, type Difficulty } from './config';
import { Game, type FighterSetup } from './core/game';
import type { GameEvent } from './core/types';
import { Controls } from './input/controls';
import { LocalTransport, type CommandSink } from './net/transport';
import { ArenaRenderer } from './render/arena';
import { Sfx } from './ui/audio';
import { Hud } from './ui/hud';

const PLAYER_ID = 'player';
const FIGHTER_COLORS = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047, 0x8e24aa];
const TICK = 1 / 60;

const $ = (id: string) => document.getElementById(id)!;

document.title = GAME_NAME;
for (const el of document.querySelectorAll('[data-game-name]')) el.textContent = GAME_NAME;

const view = new ArenaRenderer($('scene'));
const controls = new Controls(view);
const sfx = new Sfx();

const settings = { fighters: CONFIG.match.defaultFighters as number, difficulty: 'normal' as Difficulty };

interface Session {
  game: Game;
  sink: CommandSink;
  bots: BotBrain[];
  hud: Hud;
  acc: number;
  overShown: boolean;
}

let session: Session | null = null;
let paused = false;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startMatch() {
  view.dispose();
  const names = shuffle(CONFIG.bots.names);
  const setups: FighterSetup[] = Array.from({ length: settings.fighters }, (_, i) => ({
    id: i === 0 ? PLAYER_ID : `bot${i}`,
    name: i === 0 ? 'You' : names[i - 1],
    isBot: i !== 0,
    color: FIGHTER_COLORS[i],
  }));
  const game = new Game(setups);
  const hud = session?.hud ?? new Hud(PLAYER_ID, view);
  hud.reset();
  const sink = new LocalTransport(game);
  hud.onPlayCard = (cardId) => sink.send({ type: 'playCard', fighterId: PLAYER_ID, cardId });
  hud.onDiscardPick = (victimId, cardId) => sink.send({ type: 'discardPick', fighterId: PLAYER_ID, victimId, cardId });
  const bots = setups.filter((s) => s.isBot).map((s) => new BotBrain(s.id, settings.difficulty));
  session = { game, sink, bots, hud, acc: 0, overShown: false };

  const me = game.state.fighters[0];
  view.cameraYaw = me.facing;
  $('menu').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('pause').classList.add('hidden');
  $('hud').classList.remove('hidden');
  paused = false;
  controls.enabled = true;
}

function playEventSounds(s: Session, e: GameEvent) {
  switch (e.type) {
    case 'punch':
      if (e.fighterId === PLAYER_ID) sfx.whoosh();
      view.onPunch(e.fighterId);
      break;
    case 'hit': {
      const big = e.damage >= 10;
      const involved = e.targetId === PLAYER_ID || e.attackerId === PLAYER_ID;
      if (involved) sfx.hit(big);
      view.onHit(e.targetId, s.game.state.time, big, e.targetId === PLAYER_ID);
      break;
    }
    case 'blocked':
      if (e.targetId === PLAYER_ID || e.sourceId === PLAYER_ID) sfx.block();
      break;
    case 'reflected':
      if (e.reverserId === PLAYER_ID || e.sourceId === PLAYER_ID) sfx.reverse();
      break;
    case 'cardPlayed':
      if (e.fighterId === PLAYER_ID) sfx.card();
      break;
    case 'cardSkipped':
    case 'cardsRemoved':
      if (('fighterId' in e ? e.fighterId : e.victimId) === PLAYER_ID) sfx.bad();
      break;
    case 'warning':
      if (e.targetId === PLAYER_ID) sfx.warning();
      break;
    case 'roundStart':
      sfx.bell();
      break;
    case 'eliminated':
      sfx.ko();
      break;
  }
}

function showGameOver(s: Session) {
  const { winnerId } = s.game.state;
  const winner = s.game.fighter(winnerId);
  const won = winnerId === PLAYER_ID;
  $('gameover-title').textContent = won ? 'Victory!' : winner ? `${winner.name} wins` : 'Draw';
  $('gameover-sub').textContent = won
    ? 'Last crusader standing. The arena is yours.'
    : `You were knocked out${s.game.state.fighters[0].eliminatedRound ? ` in round ${s.game.state.fighters[0].eliminatedRound}` : ''}.`;
  $('gameover').classList.remove('hidden');
  controls.enabled = false;
}

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const s = session;
  if (s && !paused) {
    s.acc += dt;
    while (s.acc >= TICK) {
      s.acc -= TICK;
      const me = s.game.state.fighters[0];
      if (me.alive) for (const cmd of controls.poll(PLAYER_ID, me.pos, me.facing, TICK)) s.sink.send(cmd);
      const events = s.game.drainEvents();
      s.game.step(TICK);
      events.push(...s.game.drainEvents());
      for (const bot of s.bots) for (const cmd of bot.think(s.game.state, events)) s.sink.send(cmd);
      for (const e of events) {
        s.hud.handle(s.game.state, e);
        playEventSounds(s, e);
      }
    }
    view.update(s.game.state, PLAYER_ID, dt);
    s.hud.update(s.game.state);
    if (s.game.state.phase === 'over' && !s.overShown) {
      s.overShown = true;
      setTimeout(() => showGameOver(s), 1500);
    }
  } else if (s) {
    view.update(s.game.state, PLAYER_ID, 0);
  } else {
    // Idle menu: slowly orbit the empty arena.
    view.cameraYaw += dt * 0.15;
    view.update({ time: now / 1000, fighters: [] } as never, PLAYER_ID, dt);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setPaused(p: boolean) {
  if (!session || session.game.state.phase === 'over') return;
  paused = p;
  $('pause').classList.toggle('hidden', !p);
  controls.enabled = !p;
}

function toMenu() {
  session?.hud.hide();
  session = null;
  view.dispose();
  paused = false;
  $('pause').classList.add('hidden');
  $('gameover').classList.add('hidden');
  $('menu').classList.remove('hidden');
}

// ----------------------------------------------------------------- menu

function bindToggle(groupId: string, onPick: (value: string) => void) {
  const group = $(groupId);
  group.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-value]');
    if (!btn) return;
    for (const b of group.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    onPick(btn.dataset.value!);
  });
}
bindToggle('opt-fighters', (v) => (settings.fighters = Number(v)));
bindToggle('opt-difficulty', (v) => (settings.difficulty = v as Difficulty));
$('btn-play').addEventListener('click', startMatch);
$('btn-again').addEventListener('click', startMatch);
$('btn-menu').addEventListener('click', toMenu);
$('btn-resume').addEventListener('click', () => setPaused(false));
$('btn-quit').addEventListener('click', toMenu);
$('btn-howto').addEventListener('click', () => $('howto').classList.remove('hidden'));
$('btn-howto-close').addEventListener('click', () => $('howto').classList.add('hidden'));
$('btn-mute').addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  $('btn-mute').textContent = sfx.muted ? '🔇' : '🔊';
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && session) setPaused(!paused);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session && !paused) setPaused(true);
});

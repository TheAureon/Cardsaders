import { CONFIG } from '../config';
import { wrapAngle } from '../core/game';
import type { Command, FighterState } from '../core/types';
import type { ArenaRenderer } from '../render/arena';

const SENSITIVITY = 0.0025;

/**
 * Turns keyboard and mouse into commands for the local fighter, battlegrounds
 * style: the mouse is locked and steers an over-the-shoulder camera, the
 * fighter always faces where the camera looks (shift-lock), WASD moves
 * relative to it, left click punches, Space jumps, Q dashes. Hold Alt (or
 * press Tab) to free the cursor and double-click cards.
 */
export class Controls {
  private keys = new Set<string>();
  private punchQueued = false;
  private jumpQueued = false;
  private dashQueued = false;
  private dragging = false;
  private lockUnavailable = false;
  private lastDrag = { x: 0, y: 0 };
  /** Set while the mouse should stay free (cards, menus). */
  enabled = true;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private readonly view: ArenaRenderer) {
    const canvas = view.canvas;
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        if (!e.repeat) this.jumpQueued = true;
        e.preventDefault();
      }
      if (e.code === 'KeyQ' && !e.repeat) this.dashQueued = true;
      if ((e.code === 'AltLeft' || e.code === 'AltRight' || e.code === 'Tab') && this.locked) {
        document.exitPointerLock();
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('mousemove', (e) => {
      // Browsers occasionally report a huge bogus jump under pointer lock; ignore those.
      if (this.locked && Math.abs(e.movementX) < 300 && Math.abs(e.movementY) < 300) this.turn(e.movementX, e.movementY);
      else if (this.dragging) {
        this.turn((e.clientX - this.lastDrag.x) * 1.5, (e.clientY - this.lastDrag.y) * 1.5);
        this.lastDrag = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        if (this.locked || this.lockUnavailable) this.punchQueued = true;
        else this.lock();
      }
      if (e.button === 2) {
        this.dragging = true;
        this.lastDrag = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.onLockChange(this.locked));
    // No pointer lock (e.g. a sandboxed iframe): fall back to click-to-punch + right-drag camera.
    document.addEventListener('pointerlockerror', () => {
      this.lockUnavailable = true;
      this.onLockChange(true);
    });
  }

  get locked(): boolean {
    return document.pointerLockElement === this.view.canvas;
  }

  lock() {
    if (this.locked || this.lockUnavailable) return;
    // Some browsers return a promise that rejects (e.g. right after an unlock); that's fine.
    const r = this.view.canvas.requestPointerLock() as unknown;
    if (r instanceof Promise) r.catch(() => {});
  }

  unlock() {
    if (this.locked) document.exitPointerLock();
  }

  private turn(dx: number, dy: number) {
    this.view.cameraYaw -= dx * SENSITIVITY;
    this.view.cameraPitch = Math.max(-0.5, Math.min(1.2, this.view.cameraPitch + dy * SENSITIVITY));
  }

  poll(me: FighterState, fighters: FighterState[]): Command[] {
    const id = me.id;
    if (!this.enabled) {
      this.punchQueued = this.jumpQueued = this.dashQueued = false;
      return [{ type: 'input', fighterId: id, moveX: 0, moveZ: 0, aim: me.facing }];
    }
    const yaw = this.view.cameraYaw;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    let f = 0;
    let r = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) f += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) f -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) r += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) r -= 1;
    const moveX = fwd.x * f + right.x * r;
    const moveZ = fwd.z * f + right.z * r;

    // Face where the camera looks; when punching, nudge onto a foe right in front (aim assist).
    let aim = yaw;
    if (this.punchQueued) {
      let best = Infinity;
      for (const o of fighters) {
        if (o.id === id || !o.alive) continue;
        const dx = o.pos.x - me.pos.x;
        const dz = o.pos.z - me.pos.z;
        const dist = Math.hypot(dx, dz);
        const off = Math.abs(wrapAngle(Math.atan2(dx, dz) - yaw));
        if (dist < CONFIG.combat.punchRange + 1.5 && off < 0.7 && dist + off * 3 < best) {
          best = dist + off * 3;
          aim = Math.atan2(dx, dz);
        }
      }
    }

    const out: Command[] = [{ type: 'input', fighterId: id, moveX, moveZ, aim }];
    if (this.jumpQueued) out.push({ type: 'jump', fighterId: id });
    if (this.dashQueued) out.push({ type: 'dash', fighterId: id, dirX: moveX, dirZ: moveZ });
    if (this.punchQueued) out.push({ type: 'punch', fighterId: id });
    this.punchQueued = this.jumpQueued = this.dashQueued = false;
    return out;
  }
}

import type { Command } from '../core/types';
import type { ArenaRenderer } from '../render/arena';

/**
 * Turns keyboard and mouse into commands for the local fighter.
 * WASD moves relative to the camera, the fighter faces the mouse cursor,
 * left click punches, Q/E or right-drag orbit the camera.
 */
export class Controls {
  private keys = new Set<string>();
  private mouse = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  private punchQueued = false;
  private dragging = false;
  private lastDragX = 0;
  enabled = true;

  constructor(private readonly view: ArenaRenderer) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        this.punchQueued = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.dragging) {
        this.view.cameraYaw -= (e.clientX - this.lastDragX) * 0.006;
        this.lastDragX = e.clientX;
      }
    });
    const canvas = view.canvas;
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.punchQueued = true;
      if (e.button === 2) {
        this.dragging = true;
        this.lastDragX = e.clientX;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.dragging = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  poll(fighterId: string, pos: { x: number; z: number }, facing: number, dt: number): Command[] {
    if (!this.enabled) {
      this.punchQueued = false;
      return [{ type: 'input', fighterId, moveX: 0, moveZ: 0, aim: facing }];
    }
    if (this.keys.has('KeyQ')) this.view.cameraYaw += dt * 2.2;
    if (this.keys.has('KeyE')) this.view.cameraYaw -= dt * 2.2;

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

    let aim = facing;
    const p = this.view.groundPoint(this.mouse.x, this.mouse.y);
    if (p && Math.hypot(p.x - pos.x, p.z - pos.z) > 0.3) aim = Math.atan2(p.x - pos.x, p.z - pos.z);

    const out: Command[] = [{ type: 'input', fighterId, moveX, moveZ, aim }];
    if (this.punchQueued) {
      out.push({ type: 'punch', fighterId });
      this.punchQueued = false;
    }
    return out;
  }
}

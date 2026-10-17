import * as THREE from 'three';
import { CONFIG } from '../config';
import { attackDamage } from '../core/game';
import type { FighterState, GameEvent, GameState } from '../core/types';
import { Vfx } from './vfx';

/** Blocky R6-style rig: every limb is a box on a pivot at its joint. */
interface Rig {
  root: THREE.Group; // world position (incl. height)
  yaw: THREE.Group; // facing
  hips: THREE.Group; // whole-body tilt / ragdoll pivot
  torso: THREE.Group; // twist + lean above the hips
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  cape: THREE.Mesh;
  shield: THREE.Mesh;
  reverseRing: THREE.Mesh;
  aura: THREE.Mesh;
  mats: THREE.MeshStandardMaterial[];
  flashUntil: number;
  runPhase: number;
  spin: number;
  lastDashFx: number;
  lastDustFx: number;
  color: number;
}

const SKIN = 0xf2c94c; // classic blocky-avatar yellow

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function box(w: number, h: number, d: number, mat: THREE.Material, y = 0, x = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * Three.js presentation. Reads GameState each frame and reacts to GameEvents
 * for effects; never mutates game state.
 */
export class ArenaRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 250);
  /** Shift-lock style camera angles, driven by the mouse. */
  cameraYaw = 0;
  cameraPitch = 0.38;
  readonly vfx: Vfx;
  private rigs = new Map<string, Rig>();
  private torches: THREE.PointLight[] = [];
  private pivot = new THREE.Vector3();
  private shake = 0;
  private fovKick = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
    this.vfx = new Vfx(this.scene, this.camera);
    this.buildArena();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildArena() {
    const s = this.scene;
    s.background = new THREE.Color(0x7fb2e5);
    s.fog = new THREE.Fog(0x9cc4ea, 40, 90);

    s.add(new THREE.HemisphereLight(0xfff4dd, 0x6b5a45, 1.4));
    const sun = new THREE.DirectionalLight(0xfff1d0, 2.2);
    sun.position.set(12, 24, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -26;
    sc.right = sc.top = 26;
    s.add(sun);

    const R = CONFIG.arena.radius;

    // Sand floor with a painted Uno-style ring.
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(R + 0.2, 64),
      new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const ringColors = [0xe53935, 0xfdd835, 0x43a047, 0x1e88e5];
    ringColors.forEach((c, i) => {
      const seg = new THREE.Mesh(
        new THREE.RingGeometry(R * 0.32, R * 0.36, 32, 1, (i * Math.PI) / 2 + 0.05, Math.PI / 2 - 0.1),
        new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }),
      );
      seg.rotation.x = -Math.PI / 2;
      seg.position.y = 0.01;
      s.add(seg);
    });

    // Outer ground.
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(R + 0.2, 80, 64),
      new THREE.MeshStandardMaterial({ color: 0x6f9a4a, roughness: 1 }),
    );
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    s.add(outer);

    // Stone wall made of blocks with crenellations.
    const stone = new THREE.MeshStandardMaterial({ color: 0xb9ab94, roughness: 0.95 });
    const segs = Math.round(R * 3);
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry((2 * Math.PI * (R + 0.8)) / segs + 0.05, 1.6, 1), stone);
      wall.position.set(Math.sin(a) * (R + 0.8), 0.8, Math.cos(a) * (R + 0.8));
      wall.rotation.y = a;
      wall.castShadow = wall.receiveShadow = true;
      s.add(wall);
      if (i % 2 === 0) {
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(1, 0.6, 1), stone);
        merlon.position.set(Math.sin(a) * (R + 0.8), 1.9, Math.cos(a) * (R + 0.8));
        merlon.rotation.y = a;
        merlon.castShadow = true;
        s.add(merlon);
      }
    }

    // Towers with banners and torches.
    const bannerColors = [0xe53935, 0x1e88e5, 0xfdd835, 0x43a047];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 10;
      const x = Math.sin(a) * (R + 1.2);
      const z = Math.cos(a) * (R + 1.2);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 4.5, 12), stone);
      tower.position.set(x, 2.25, z);
      tower.castShadow = true;
      s.add(tower);
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(1.4, 1.8, 12),
        new THREE.MeshStandardMaterial({ color: bannerColors[i % 4], roughness: 0.7 }),
      );
      roof.position.set(x, 5.4, z);
      s.add(roof);

      const banner = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 2),
        new THREE.MeshStandardMaterial({ map: bannerTexture(bannerColors[i % 4]), side: THREE.DoubleSide, alphaTest: 0.5 }),
      );
      const ia = a;
      banner.position.set(Math.sin(ia) * (R + 0.05), 2.6, Math.cos(ia) * (R + 0.05));
      banner.rotation.y = ia + Math.PI;
      s.add(banner);

      const torch = new THREE.PointLight(0xffa040, 6, 9, 1.5);
      torch.position.set(Math.sin(a + 0.2) * (R + 0.2), 2.4, Math.cos(a + 0.2) * (R + 0.2));
      s.add(torch);
      this.torches.push(torch);
      const flame = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xffc040 }),
      );
      flame.position.copy(torch.position);
      s.add(flame);
    }
  }


  // ------------------------------------------------------------------ rig

  private makeRig(f: FighterState): Rig {
    const team = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.55 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x3b3f4a, roughness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.6, roughness: 0.35 });
    const face = new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.55 });
    const tabard = new THREE.MeshStandardMaterial({ map: tabardTexture(f.color), roughness: 0.6 });
    const mats = [team, skin, pants, steel, face, tabard];

    const root = new THREE.Group();
    const yaw = new THREE.Group();
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    const torso = new THREE.Group();
    root.add(yaw);
    yaw.add(hips);
    hips.add(torso);

    // Torso: tabard front, team colour elsewhere.
    const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.95, 0.46), [team, team, team, team, tabard, team]);
    torsoMesh.position.y = 0.475;
    torsoMesh.castShadow = true;
    torso.add(torsoMesh);
    torso.add(box(0.96, 0.12, 0.5, steel, 0.06)); // belt

    const head = new THREE.Group();
    head.position.y = 0.95;
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.56, 0.56), [skin, skin, skin, skin, face, skin]));
    (head.children[0] as THREE.Mesh).position.y = 0.3;
    (head.children[0] as THREE.Mesh).castShadow = true;
    head.add(box(0.62, 0.16, 0.62, steel, 0.56)); // helm cap
    head.add(box(0.12, 0.2, 0.12, team, 0.72)); // crest
    torso.add(head);

    const makeArm = (side: number) => {
      const g = new THREE.Group();
      g.position.set(0.68 * side, 0.85, 0);
      g.add(box(0.44, 0.5, 0.44, team, -0.18)); // sleeve
      g.add(box(0.42, 0.5, 0.42, skin, -0.62));
      g.add(box(0.48, 0.2, 0.48, steel, -0.8)); // gauntlet
      torso.add(g);
      return g;
    };
    const makeLeg = (side: number) => {
      const g = new THREE.Group();
      g.position.set(0.23 * side, 0, 0);
      g.add(box(0.45, 0.95, 0.45, pants, -0.475));
      g.add(box(0.47, 0.18, 0.5, steel, -0.86, 0, 0.02));
      hips.add(g);
      return g;
    };

    const cape = new THREE.Mesh(
      new THREE.PlaneGeometry(0.85, 1.25).translate(0, -0.62, 0),
      new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.8, side: THREE.DoubleSide }),
    );
    cape.position.set(0, 0.9, -0.26);
    cape.castShadow = true;
    torso.add(cape);
    mats.push(cape.material as THREE.MeshStandardMaterial);

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.3, 24, 16),
      new THREE.MeshStandardMaterial({
        color: 0xffd54f,
        emissive: 0xffb300,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    shield.position.y = 1.15;
    shield.visible = false;
    root.add(shield);

    const reverseRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.1, 0.07, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xab47bc, emissive: 0x8e24aa, emissiveIntensity: 1.2 }),
    );
    reverseRing.rotation.x = Math.PI / 2;
    reverseRing.visible = false;
    root.add(reverseRing);

    const aura = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 1.0, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7043, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.04;
    root.add(aura);

    this.scene.add(root);
    return {
      root,
      yaw,
      hips,
      torso,
      head,
      armL: makeArm(-1),
      armR: makeArm(1),
      legL: makeLeg(-1),
      legR: makeLeg(1),
      cape,
      shield,
      reverseRing,
      aura,
      mats,
      flashUntil: 0,
      runPhase: 0,
      spin: 0,
      lastDashFx: 0,
      lastDustFx: 0,
      color: f.color,
    };
  }

  /** Spawn effects for a batch of game events. */
  onEvents(state: GameState, events: GameEvent[], playerId: string) {
    const byId = (id: string) => state.fighters.find((f) => f.id === id);
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          const t = byId(e.targetId);
          const a = byId(e.attackerId);
          if (!t) break;
          const rig = this.rigs.get(t.id);
          if (rig) rig.flashUntil = state.time + 0.1;
          const dir = new THREE.Vector3(t.pos.x - (a?.pos.x ?? t.pos.x), 0, t.pos.z - (a?.pos.z ?? t.pos.z));
          if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
          dir.normalize();
          const at = new THREE.Vector3(t.pos.x - dir.x * 0.4, t.y + 1.45, t.pos.z - dir.z * 0.4);
          const power = Math.min(1.5, 0.3 + e.damage / 25);
          if (e.finisher) this.vfx.finisher(at, dir);
          else this.vfx.hit(at, dir, power, e.reflected ? 0xce93d8 : 0xffffff);
          const involved = e.targetId === playerId || e.attackerId === playerId;
          if (involved) {
            this.shake = Math.max(this.shake, e.finisher ? 0.7 : 0.18 + power * 0.15);
            if (e.finisher) this.fovKick = 10;
          }
          break;
        }
        case 'blocked': {
          const t = byId(e.targetId);
          if (t && e.what === 'punch') this.vfx.hit(new THREE.Vector3(t.pos.x, t.y + 1.3, t.pos.z), new THREE.Vector3(0, 1, 0), 0.4, 0xffd54f);
          break;
        }
        case 'dash': {
          const f = byId(e.fighterId);
          if (f) this.vfx.dust(new THREE.Vector3(f.pos.x, 0, f.pos.z), 5, 0.6, 0.3);
          break;
        }
        case 'jump': {
          const f = byId(e.fighterId);
          if (f) this.vfx.dust(new THREE.Vector3(f.pos.x, 0, f.pos.z), 4, 0.5, 0.25);
          break;
        }
        case 'land': {
          const f = byId(e.fighterId);
          if (!f) break;
          const at = new THREE.Vector3(f.pos.x, 0, f.pos.z);
          if (e.hard) {
            this.vfx.crater(at, 1.3);
            if (f.id === playerId) this.shake = Math.max(this.shake, 0.5);
          } else this.vfx.dust(at, 3, 0.5, 0.25);
          break;
        }
        case 'wallSlam': {
          const f = byId(e.fighterId);
          if (!f) break;
          const at = new THREE.Vector3(f.pos.x, f.y + 1, f.pos.z);
          this.vfx.hit(at, at.clone().setY(0).normalize().negate(), 1.2, 0xbcaaa4);
          this.vfx.dust(at, 12, 1.5, 0.6);
          this.shake = Math.max(this.shake, 0.35);
          break;
        }
      }
    }
  }

  update(state: GameState, playerId: string, dt: number) {
    const t = state.time;
    for (const f of state.fighters) {
      let rig = this.rigs.get(f.id);
      if (!rig) {
        rig = this.makeRig(f);
        this.rigs.set(f.id, rig);
      }
      this.animate(rig, f, t, dt);
    }
    this.vfx.update(dt);

    for (let i = 0; i < this.torches.length; i++) {
      this.torches[i].intensity = 5 + Math.sin(t * 13 + i * 1.7) * 0.8 + Math.sin(t * 7.3 + i) * 0.6;
    }
    this.updateCamera(state.fighters.find((f) => f.id === playerId), dt);
    this.renderer.render(this.scene, this.camera);
  }

  private animate(r: Rig, f: FighterState, t: number, dt: number) {
    r.root.position.set(f.pos.x, f.y, f.pos.z);
    r.yaw.rotation.y = f.facing;
    const k = Math.min(1, dt * 18); // pose smoothing
    const flashing = t < r.flashUntil;
    for (const m of r.mats) m.emissive.setHex(flashing ? 0xffffff : 0x000000);

    // Pose targets (radians). Arms hang along -y; negative x swings them forward.
    let hipsX = 0;
    let hipsY = 0.95;
    let torsoX = 0.08;
    let torsoY = 0;
    let headX = 0;
    let aLx = -1.25, aLz = 0.25, aRx = -1.25, aRz = -0.25; // guard: fists up
    let lLx = 0, lRx = 0, lLz = 0, lRz = 0;
    let capeX = 0.15;

    const speed = Math.hypot(f.vel.x, f.vel.z);
    const down = f.knockdownUntil > t;
    const stunned = f.stunUntil > t && !down;
    const airborne = f.y > 0.05;

    if (!f.alive) {
      // Lie face down.
      hipsX = Math.PI / 2;
      hipsY = 0.25;
      aLx = aRx = -2.9;
      aLz = 0.3;
      aRz = -0.3;
    } else if (down) {
      const left = f.knockdownUntil - t;
      if (airborne) {
        // Ragdoll tumble while flying.
        r.spin += dt * 11;
        hipsX = -r.spin;
        aLz = 1.6;
        aRz = -1.6;
        aLx = aRx = -0.4;
        lLz = 0.5;
        lRz = -0.5;
      } else if (left > 0.35) {
        r.spin = 0;
        hipsX = -Math.PI / 2; // flat on the back
        hipsY = 0.25;
        aLz = 1.3;
        aRz = -1.3;
        aLx = aRx = 0;
        lLz = 0.35;
        lRz = -0.35;
      } else {
        // Getting up.
        const g = 1 - left / 0.35;
        hipsX = lerp(-Math.PI / 2, 0, g);
        hipsY = lerp(0.25, 0.95, g);
        aLx = aRx = lerp(0, -1.25, g);
      }
      if (airborne && t - r.lastDustFx > 0.05 && f.y < 2.5) {
        r.lastDustFx = t;
        this.vfx.dust(new THREE.Vector3(f.pos.x, 0, f.pos.z), 1, 0.4, 0.3);
      }
    } else if (stunned) {
      const wob = Math.sin(t * 30) * 0.05;
      torsoX = -0.35 + wob;
      headX = -0.3;
      aLx = aRx = 0.35;
      aLz = 0.7;
      aRz = -0.7;
      lLx = 0.25;
      lRx = -0.15;
    } else if (f.dashUntil > t) {
      torsoX = 0.6;
      aLx = aRx = 0.9;
      aLz = 0.2;
      aRz = -0.2;
      lLx = -0.9;
      lRx = 0.6;
      capeX = 1.1;
      if (t - r.lastDashFx > 0.03) {
        r.lastDashFx = t;
        this.vfx.dashTrail(new THREE.Vector3(f.pos.x, f.y, f.pos.z), new THREE.Vector3(f.dashDir.x, 0, f.dashDir.z), r.color);
      }
    } else {
      // Locomotion.
      const run = Math.min(1, speed / CONFIG.arena.moveSpeed);
      r.runPhase += dt * speed * 1.6;
      const sw = Math.sin(r.runPhase) * run;
      lLx = sw * 0.9;
      lRx = -sw * 0.9;
      torsoX = 0.08 + run * 0.18;
      aLx = -1.25 + sw * 0.35;
      aRx = -1.25 - sw * 0.35;
      capeX = 0.15 + run * 0.6 + Math.sin(t * 9) * 0.05 * run;
      if (airborne) {
        lLx = -0.9;
        lRx = 0.3;
        capeX = 0.9;
      }

      // Punch animation overrides the arms: alternating jabs, then a big finisher.
      const since = t - f.lastPunchAt;
      const finisher = f.comboCount === 0 && since < 0.45 && f.punchReadyAt - f.lastPunchAt > CONFIG.combat.punchCooldown + 0.01;
      if (finisher) {
        // Overhead hammer: wind up, then slam down-forward.
        const p = since / 0.45;
        const swing = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
        aRx = lerp(-1.25, p < 0.3 ? -3.0 : -1.0, swing);
        aLx = aRx;
        aLz = 0.15;
        aRz = -0.15;
        torsoX = p < 0.3 ? -0.3 * swing : 0.55 * swing;
      } else if (since < 0.26) {
        const p = Math.sin((since / 0.26) * Math.PI);
        const right = f.comboCount % 2 === 1;
        if (right) {
          aRx = lerp(-1.25, -1.6, p);
          aRz = lerp(-0.25, 0.25, p);
          torsoY = -0.55 * p;
        } else {
          aLx = lerp(-1.25, -1.6, p);
          aLz = lerp(0.25, -0.25, p);
          torsoY = 0.55 * p;
        }
        torsoX += 0.15 * p;
      }
    }

    // Smoothly approach the pose (tumbling uses the raw spin).
    const set = (o: THREE.Object3D, axis: 'x' | 'y' | 'z', v: number, snap = false) => {
      o.rotation[axis] = snap ? v : lerp(o.rotation[axis], v, k);
    };
    const tumbling = down && airborne;
    set(r.hips, 'x', hipsX, tumbling);
    r.hips.position.y = lerp(r.hips.position.y, hipsY, k);
    set(r.torso, 'x', torsoX);
    set(r.torso, 'y', torsoY, true);
    set(r.head, 'x', headX);
    set(r.armL, 'x', aLx, true);
    set(r.armL, 'z', aLz);
    set(r.armR, 'x', aRx, true);
    set(r.armR, 'z', aRz);
    set(r.legL, 'x', lLx);
    set(r.legR, 'x', lRx);
    set(r.legL, 'z', lLz);
    set(r.legR, 'z', lRz);
    set(r.cape, 'x', capeX);

    // Card effects.
    const alive = f.alive;
    r.shield.visible = alive && f.blockUntil > t;
    if (r.shield.visible) r.shield.scale.setScalar(1 + Math.sin(t * 12) * 0.03);
    r.reverseRing.visible = alive && f.reverseUntil > t;
    if (r.reverseRing.visible) {
      r.reverseRing.rotation.z += dt * 6;
      r.reverseRing.position.y = 1.15 + Math.sin(t * 6) * 0.6;
    }
    const dmg = attackDamage(f);
    const auraMat = r.aura.material as THREE.MeshBasicMaterial;
    auraMat.opacity = alive && dmg > 1 ? Math.min(0.85, 0.25 + dmg / 40) : 0;
    auraMat.color.setHex(f.buffs.some((b) => b.kind === 'multiplier') ? 0xff1744 : 0xff9800);
    r.aura.scale.setScalar(1 + Math.sin(t * 5) * 0.06 + Math.min(1, dmg / 30) * 0.4);
    r.aura.position.y = 0.04 - f.y;
  }

  // ---------------------------------------------------------------- camera

  /** Over-the-shoulder camera locked behind the player, like shift-lock. */
  private updateCamera(me: FighterState | undefined, dt: number) {
    if (me) {
      const goal = new THREE.Vector3(me.pos.x, me.y + 2.5, me.pos.z);
      if (this.pivot.lengthSq() === 0) this.pivot.copy(goal);
      this.pivot.lerp(goal, Math.min(1, dt * 14));
    } else {
      this.pivot.lerp(new THREE.Vector3(0, 2, 0), Math.min(1, dt * 2));
    }
    const yaw = this.cameraYaw;
    const pitch = this.cameraPitch;
    const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    const shoulder = me ? 1.3 : 0;
    let dist = me ? 8.5 : 22;

    // Keep the camera inside the arena wall and above the floor.
    // When the wall pushes the camera in, it also rises so the view stays open.
    const maxR = CONFIG.arena.radius - 1.2;
    const fullDist = dist;
    const pos = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      pos.copy(this.pivot).addScaledVector(fwd, -dist).addScaledVector(right, shoulder);
      pos.y += (fullDist - dist) * 0.45;
      if (Math.hypot(pos.x, pos.z) <= maxR || dist < 2) break;
      dist -= 0.3;
    }
    pos.y = Math.max(0.5, pos.y);
    this.camera.position.copy(pos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.camera.position.z += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2.8);
    }
    // Look at a nearer point when squeezed, so the player stays in frame.
    const look = 12 * Math.max(0.15, dist / fullDist);
    this.camera.lookAt(this.pivot.clone().addScaledVector(right, shoulder).addScaledVector(fwd, look));
    this.fovKick = Math.max(0, this.fovKick - dt * 25);
    const fov = 70 + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Screen position of a world point, for DOM labels. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((1 - v.y) / 2) * window.innerHeight,
      visible: v.z < 1 && v.z > -1,
    };
  }

  dispose() {
    for (const r of this.rigs.values()) this.scene.remove(r.root);
    this.rigs.clear();
    this.vfx.clear();
    this.pivot.set(0, 0, 0);
  }
}

function faceTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c94c';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#1b1b1b';
  g.fillRect(18, 22, 7, 11);
  g.fillRect(39, 22, 7, 11);
  g.lineWidth = 4;
  g.strokeStyle = '#1b1b1b';
  g.beginPath();
  g.arc(32, 36, 13, 0.2 * Math.PI, 0.8 * Math.PI);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function tabardTexture(color: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(27, 8, 10, 48);
  g.fillRect(14, 20, 36, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sandTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9b77c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2500; i++) {
    const l = 60 + Math.random() * 25;
    g.fillStyle = `hsl(36, 45%, ${l}%)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bannerTexture(color: number): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(64, 0);
  g.lineTo(64, 110);
  g.lineTo(32, 128);
  g.lineTo(0, 110);
  g.fill();
  g.fillStyle = '#fff';
  g.fillRect(26, 18, 12, 70);
  g.fillRect(12, 38, 40, 12);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

import * as THREE from 'three';
import { CONFIG } from '../config';
import { attackDamage } from '../core/game';
import type { FighterState, GameState } from '../core/types';

interface FighterView {
  root: THREE.Group;
  body: THREE.Group;
  fistL: THREE.Mesh;
  fistR: THREE.Mesh;
  shield: THREE.Mesh;
  reverseRing: THREE.Mesh;
  aura: THREE.Mesh;
  flashUntil: number;
  bodyMats: THREE.MeshStandardMaterial[];
  punchSide: number;
  deathAt: number | null;
}

/**
 * Three.js presentation. Reads GameState each frame; never mutates it.
 */
export class ArenaRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  /** Camera orbit around the player, controlled by input. */
  cameraYaw = 0;
  private views = new Map<string, FighterView>();
  private torches: THREE.PointLight[] = [];
  private camTarget = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private shake = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
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
    sc.left = sc.bottom = -20;
    sc.right = sc.top = 20;
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
    const segs = 40;
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
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
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

  private makeFighter(f: FighterState): FighterView {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);

    const tabard = new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.6 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, metalness: 0.7, roughness: 0.35 });
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x222222 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.6, 4, 12), tabard);
    torso.position.y = 0.95;
    body.add(torso);
    // Crusader cross on the chest.
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.05), white);
    crossV.position.set(0, 1.05, 0.44);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.05), white);
    crossH.position.set(0, 1.12, 0.44);
    body.add(crossV, crossH);

    const helm = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.5, 14), steel);
    helm.position.y = 1.85;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.1), dark);
    visor.position.set(0, 1.88, 0.28);
    const plume = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8), tabard);
    plume.position.y = 2.25;
    body.add(helm, visor, plume);

    const legGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.55, 8);
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, steel);
      leg.position.set(0.2 * side, 0.28, 0);
      body.add(leg);
    }

    const fistGeo = new THREE.SphereGeometry(0.2, 12, 10);
    const fistL = new THREE.Mesh(fistGeo, steel);
    const fistR = new THREE.Mesh(fistGeo, steel);
    body.add(fistL, fistR);

    body.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });

    const shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 24, 16),
      new THREE.MeshStandardMaterial({
        color: 0xffd54f,
        emissive: 0xffb300,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      }),
    );
    shield.position.y = 1.1;
    shield.visible = false;
    root.add(shield);

    const reverseRing = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.07, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xab47bc, emissive: 0x8e24aa, emissiveIntensity: 1.2 }),
    );
    reverseRing.rotation.x = Math.PI / 2;
    reverseRing.position.y = 1.1;
    reverseRing.visible = false;
    root.add(reverseRing);

    // Glow on the ground that grows with punch power.
    const aura = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.95, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7043, transparent: true, opacity: 0.0, side: THREE.DoubleSide }),
    );
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.03;
    root.add(aura);

    this.scene.add(root);
    return {
      root,
      body,
      fistL,
      fistR,
      shield,
      reverseRing,
      aura,
      flashUntil: 0,
      bodyMats: [tabard],
      punchSide: 1,
      deathAt: null,
    };
  }

  onHit(targetId: string, time: number, big: boolean, isPlayer: boolean) {
    const v = this.views.get(targetId);
    if (v) v.flashUntil = time + 0.15;
    if (isPlayer) this.shake = Math.max(this.shake, big ? 0.5 : 0.2);
  }

  onPunch(fighterId: string) {
    const v = this.views.get(fighterId);
    if (v) v.punchSide = -v.punchSide;
  }

  update(state: GameState, playerId: string, dt: number) {
    const t = state.time;
    for (const f of state.fighters) {
      let v = this.views.get(f.id);
      if (!v) {
        v = this.makeFighter(f);
        this.views.set(f.id, v);
      }
      v.root.position.set(f.pos.x, 0, f.pos.z);
      v.root.rotation.y = f.facing;

      if (!f.alive) {
        if (v.deathAt === null) v.deathAt = t;
        const k = Math.min(1, (t - v.deathAt) / 0.6);
        v.body.rotation.x = -k * (Math.PI / 2);
        v.body.position.y = 0.3 * k;
        v.shield.visible = v.reverseRing.visible = false;
        (v.aura.material as THREE.MeshBasicMaterial).opacity = 0;
        continue;
      }

      // Idle bob + walk wobble.
      const speed = Math.hypot(f.vel.x, f.vel.z);
      v.body.position.y = Math.abs(Math.sin(t * 10)) * 0.08 * Math.min(1, speed / 3);
      v.body.rotation.z = Math.sin(t * 10) * 0.05 * Math.min(1, speed / 3);

      // Punch: the active fist jabs forward and returns.
      const since = t - f.lastPunchAt;
      const jab = since < 0.25 ? Math.sin((since / 0.25) * Math.PI) : 0;
      const guard = (fist: THREE.Mesh, side: number) => {
        const active = side === v!.punchSide ? jab : 0;
        fist.position.set(0.42 * side * (1 - active * 0.6), 1.15 + active * 0.1, 0.35 + active * 0.95);
      };
      guard(v.fistL, -1);
      guard(v.fistR, 1);

      const flashing = t < v.flashUntil;
      for (const m of v.bodyMats) m.emissive.setHex(flashing ? 0xffffff : 0x000000);

      const blocking = f.blockUntil > t;
      v.shield.visible = blocking;
      if (blocking) v.shield.scale.setScalar(1 + Math.sin(t * 12) * 0.03);
      const reversing = f.reverseUntil > t;
      v.reverseRing.visible = reversing;
      if (reversing) {
        v.reverseRing.rotation.z += dt * 6;
        v.reverseRing.position.y = 1.1 + Math.sin(t * 6) * 0.5;
      }
      const dmg = attackDamage(f);
      const auraMat = v.aura.material as THREE.MeshBasicMaterial;
      auraMat.opacity = dmg > 1 ? Math.min(0.85, 0.25 + dmg / 40) : 0;
      auraMat.color.setHex(f.buffs.some((b) => b.kind === 'multiplier') ? 0xff1744 : 0xff9800);
      v.aura.scale.setScalar(1 + Math.sin(t * 5) * 0.06 + Math.min(1, dmg / 30) * 0.4);
    }

    for (let i = 0; i < this.torches.length; i++) {
      this.torches[i].intensity = 5 + Math.sin(t * 13 + i * 1.7) * 0.8 + Math.sin(t * 7.3 + i) * 0.6;
    }

    const me = state.fighters.find((f) => f.id === playerId);
    if (me) {
      const goal = new THREE.Vector3(me.pos.x, 1.2, me.pos.z);
      this.camTarget.lerp(goal, Math.min(1, dt * 8));
      if (this.camTarget.lengthSq() === 0) this.camTarget.copy(goal);
    }
    // Pull the camera in when it would end up behind the arena wall.
    const height = 7.5;
    const maxR = CONFIG.arena.radius - 0.5;
    let dist = 10;
    for (let i = 0; i < 12; i++) {
      const cx = this.camTarget.x - Math.sin(this.cameraYaw) * dist;
      const cz = this.camTarget.z - Math.cos(this.cameraYaw) * dist;
      if (Math.hypot(cx, cz) <= maxR || dist <= 5.5) break;
      dist -= 0.4;
    }
    // ...and look down more steeply instead, so the view stays wide.
    const h = height + (10 - dist) * 0.9;
    this.camera.position.set(
      this.camTarget.x - Math.sin(this.cameraYaw) * dist,
      this.camTarget.y + h,
      this.camTarget.z - Math.cos(this.cameraYaw) * dist,
    );
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    this.camera.lookAt(this.camTarget);
    this.renderer.render(this.scene, this.camera);
  }

  /** World point on the arena floor under a screen position. */
  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, hit) ? { x: hit.x, z: hit.z } : null;
  }

  /** Screen position of a point above a fighter, for DOM labels. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((1 - v.y) / 2) * window.innerHeight,
      visible: v.z < 1,
    };
  }

  dispose() {
    for (const v of this.views.values()) this.scene.remove(v.root);
    this.views.clear();
  }
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

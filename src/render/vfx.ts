import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  grow: number;
  baseScale: number;
  fade: boolean;
  /** Stretch along velocity (sparks). */
  streak: boolean;
}

const additive = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

/**
 * Hit sparks, shockwave rings, dust, craters and dash streaks. Pure eye candy:
 * everything is fire-and-forget and driven from GameEvents.
 */
export class Vfx {
  private particles: Particle[] = [];
  private sparkGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
  private sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private discGeo = new THREE.CircleGeometry(1, 24);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  private add(p: Omit<Particle, 'maxLife' | 'baseScale'> & { scale?: number }) {
    const baseScale = p.scale ?? 1;
    p.mesh.scale.setScalar(baseScale);
    this.scene.add(p.mesh);
    this.particles.push({ ...p, maxLife: p.life, baseScale });
  }

  /** Burst of sparks + flash + a ring facing the camera. */
  hit(at: THREE.Vector3, dir: THREE.Vector3, power: number, color = 0xffffff) {
    const n = Math.round(6 + power * 10);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(0.6)
        .add(dir)
        .normalize()
        .multiplyScalar(8 + Math.random() * 10 * (0.6 + power));
      this.add({
        mesh: new THREE.Mesh(this.sparkGeo, additive(i % 3 ? 0xfff3c4 : color)),
        vel: v,
        life: 0.18 + Math.random() * 0.2,
        gravity: 12,
        grow: 0,
        fade: true,
        streak: true,
        scale: 0.5 + power * 0.6,
      });
    }
    const flash = new THREE.Mesh(this.sphereGeo, additive(0xffffff, 0.9));
    flash.position.copy(at);
    this.add({ mesh: flash, vel: new THREE.Vector3(), life: 0.09, gravity: 0, grow: 10, fade: true, streak: false, scale: 0.25 + power * 0.25 });

    const ring = new THREE.Mesh(this.ringGeo, additive(color, 0.9));
    ring.material.side = THREE.DoubleSide;
    ring.position.copy(at);
    ring.lookAt(this.camera.position);
    this.add({ mesh: ring, vel: new THREE.Vector3(), life: 0.22, gravity: 0, grow: 9 + power * 10, fade: true, streak: false, scale: 0.2 });
  }

  /** Finisher: hit burst plus a big shockwave perpendicular to the launch. */
  finisher(at: THREE.Vector3, dir: THREE.Vector3) {
    this.hit(at, dir, 1.6, 0xffd54f);
    const wave = new THREE.Mesh(this.ringGeo, additive(0xffffff, 0.8));
    wave.material.side = THREE.DoubleSide;
    wave.position.copy(at);
    wave.lookAt(at.clone().add(dir));
    this.add({ mesh: wave, vel: dir.clone().multiplyScalar(4), life: 0.35, gravity: 0, grow: 14, fade: true, streak: false, scale: 0.4 });
    this.groundWave(new THREE.Vector3(at.x, 0.05, at.z), 1.2);
  }

  groundWave(at: THREE.Vector3, size: number) {
    const ring = new THREE.Mesh(this.ringGeo, additive(0xfff0c0, 0.7));
    ring.material.side = THREE.DoubleSide;
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at);
    this.add({ mesh: ring, vel: new THREE.Vector3(), life: 0.4, gravity: 0, grow: 8 * size, fade: true, streak: false, scale: 0.3 });
  }

  dust(at: THREE.Vector3, count: number, spread = 1, size = 0.35) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        this.sphereGeo,
        new THREE.MeshBasicMaterial({ color: 0xd8c39a, transparent: true, opacity: 0.55, depthWrite: false }),
      );
      m.position.set(at.x + (Math.random() - 0.5) * spread, at.y + 0.2, at.z + (Math.random() - 0.5) * spread);
      const a = Math.random() * Math.PI * 2;
      this.add({
        mesh: m,
        vel: new THREE.Vector3(Math.cos(a) * 3, 0.8 + Math.random(), Math.sin(a) * 3),
        life: 0.5 + Math.random() * 0.4,
        gravity: -0.5,
        grow: 1.6,
        fade: true,
        streak: false,
        scale: size * (0.6 + Math.random() * 0.8),
      });
    }
  }

  crater(at: THREE.Vector3, size: number) {
    const m = new THREE.Mesh(
      this.discGeo,
      new THREE.MeshBasicMaterial({ color: 0x5a4630, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, 0.02, at.z);
    this.add({ mesh: m, vel: new THREE.Vector3(), life: 4, gravity: 0, grow: 0, fade: true, streak: false, scale: size });
    this.dust(at, 10, 1.5, 0.5);
    this.groundWave(at, size);
  }

  /** Translucent afterimage + speed streaks for dashes. */
  dashTrail(at: THREE.Vector3, dir: THREE.Vector3, color: number) {
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.9, 0.45),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    ghost.position.set(at.x, at.y + 1.15, at.z);
    ghost.rotation.y = Math.atan2(dir.x, dir.z);
    this.add({ mesh: ghost, vel: new THREE.Vector3(), life: 0.22, gravity: 0, grow: 0, fade: true, streak: false });
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Mesh(this.sparkGeo, additive(0xffffff, 0.7));
      line.position.set(at.x + (Math.random() - 0.5) * 1.2, at.y + 0.3 + Math.random() * 1.8, at.z + (Math.random() - 0.5) * 1.2);
      this.add({ mesh: line, vel: dir.clone().multiplyScalar(-2), life: 0.2, gravity: 0, grow: 0, fade: true, streak: true, scale: 2.5 });
    }
  }

  update(dt: number) {
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      const m = p.mesh;
      if (p.life <= 0) {
        this.scene.remove(m);
        (m.material as THREE.Material).dispose();
        if (m.geometry !== this.sparkGeo && m.geometry !== this.sphereGeo && m.geometry !== this.ringGeo && m.geometry !== this.discGeo) {
          m.geometry.dispose();
        }
        return false;
      }
      p.vel.y -= p.gravity * dt;
      m.position.addScaledVector(p.vel, dt);
      const k = p.life / p.maxLife;
      if (p.grow) m.scale.multiplyScalar(1 + p.grow * dt);
      if (p.streak && p.vel.lengthSq() > 0.01) {
        m.lookAt(m.position.clone().add(p.vel));
        m.scale.set(p.baseScale, p.baseScale, p.baseScale * (0.3 + k));
      }
      if (p.fade) (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k * 1.5) * ((m.userData.o0 ??= (m.material as THREE.MeshBasicMaterial).opacity) as number);
      return true;
    });
  }

  clear() {
    for (const p of this.particles) this.scene.remove(p.mesh);
    this.particles = [];
  }
}

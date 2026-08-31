import * as THREE from "three";

const CYAN = new THREE.Color(0x7fe8de);
const ORANGE = new THREE.Color(0xff9b4d);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Maps a sub-range of an overall 0..1 progress onto its own full 0..1. */
const stage = (t: number, from: number, to: number): number => clamp01((t - from) / (to - from));

/** Soft radial sprite so points read as glowing nodes rather than hard squares. */
function glowSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class HologramBall {
  readonly root = new THREE.Group();
  /**
   * Everything that implodes. Split from `root` because the shockwave has to
   * expand while the ball shrinks, and a child of the scaled group would be
   * dragged to nothing along with it.
   */
  private body = new THREE.Group();
  private shockwave: THREE.Mesh;
  private core: THREE.Mesh;
  private glow: THREE.Mesh;
  private shells: THREE.LineSegments[] = [];
  private nodes: THREE.Points;
  private rings: THREE.Mesh[] = [];
  private particles: THREE.Points;
  private sprite = glowSprite();
  /**
   * Authored opacity of every material, captured once at construction. The
   * materialise and collapse passes scale these rather than assigning absolute
   * values, so the tuned look stays the single source of truth and repeated
   * summons cannot walk the opacities away from where they started.
   */
  private baseOpacity = new Map<THREE.Material, number>();

  constructor() {
    const coreMat = new THREE.MeshPhysicalMaterial({
      color: 0x0a2b33,
      emissive: CYAN.clone(),
      emissiveIntensity: 0.55,
      metalness: 0.85,
      roughness: 0.18,
      transparent: true,
      opacity: 0.72,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.62, 48, 48), coreMat);
    this.body.add(this.core);

    this.glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.78, 32, 32),
      new THREE.MeshBasicMaterial({
        color: CYAN.clone(),
        transparent: true,
        opacity: 0.09,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.body.add(this.glow);

    // Icosahedron, not a UV sphere: the triangulated facets are what produce the
    // node-mesh look in the reference image. A UV sphere gives a quad grid.
    for (const [radius, detail, opacity] of [
      [1.0, 2, 0.55],
      [0.82, 1, 0.32],
    ] as const) {
      const geo = new THREE.IcosahedronGeometry(radius, detail);
      const shell = new THREE.LineSegments(
        new THREE.WireframeGeometry(geo),
        new THREE.LineBasicMaterial({
          color: CYAN.clone(),
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.shells.push(shell);
      this.body.add(shell);
    }

    const nodeGeo = new THREE.IcosahedronGeometry(1.0, 2);
    this.nodes = new THREE.Points(
      nodeGeo,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.055,
        map: this.sprite,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.body.add(this.nodes);

    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.25 + i * 0.16, 0.006, 8, 128),
        new THREE.MeshBasicMaterial({
          color: CYAN.clone(),
          transparent: true,
          opacity: 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.rings.push(ring);
      this.body.add(ring);
    }

    const count = 1200;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 1.05 + Math.random() * 0.75;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const cloudGeo = new THREE.BufferGeometry();
    cloudGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.particles = new THREE.Points(
      cloudGeo,
      new THREE.PointsMaterial({
        color: CYAN.clone(),
        size: 0.022,
        map: this.sprite,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.body.add(this.particles);
    this.root.add(this.body);

    // Torus geometry lies in the XY plane, so this faces the camera as a flat
    // ring. Hidden until a collapse needs it.
    this.shockwave = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.018, 8, 96),
      new THREE.MeshBasicMaterial({
        color: CYAN.clone(),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.shockwave.visible = false;
    this.root.add(this.shockwave);

    this.root.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (mat && "opacity" in mat) this.baseOpacity.set(mat, mat.opacity);
    });
  }

  /**
   * User-commanded orientation. Applied to the body rather than to `root`,
   * which is already carrying the position and the shockwave's palm-axis
   * alignment, and would fight it.
   */
  setSpin(q: { x: number; y: number; z: number; w: number }): void {
    this.body.quaternion.set(q.x, q.y, q.z, q.w);
  }

  /** Uniform scale of the ball itself. The shockwave scales independently. */
  setScale(v: number): void {
    this.body.scale.setScalar(Math.max(0.0001, v));
  }

  private fade(object: THREE.Object3D, amount: number): void {
    const mat = (object as THREE.Mesh).material as THREE.Material;
    const base = this.baseOpacity.get(mat);
    if (base !== undefined) mat.opacity = base * clamp01(amount);
  }

  /**
   * Assembles the ball out of its own particle cloud. 0 is dispersed and
   * invisible, 1 is fully formed.
   *
   * The parts arrive in an order rather than all fading up together: the cloud
   * rushes in first, the wireframe skeleton snaps on next, and the solid core
   * skins over last. That staging is the whole effect. A single uniform fade
   * over the same duration reads as the ball simply becoming less transparent,
   * which is what it used to do.
   */
  setFormation(t: number): void {
    const e = clamp01(t);
    this.shockwave.visible = false;

    // The cloud starts wide and rushes inward, so the ball looks gathered from
    // the air around it rather than scaled up from a point.
    const gather = Math.pow(1 - e, 2);
    this.particles.scale.setScalar(1 + gather * 2.4);
    this.fade(this.particles, Math.min(1, e * 2.6) * (0.45 + 0.55 * e));

    const skeleton = stage(e, 0.06, 0.55);
    for (const shell of this.shells) this.fade(shell, skeleton);
    this.fade(this.nodes, skeleton);
    for (const shell of this.shells) shell.scale.setScalar(0.72 + 0.28 * skeleton);
    this.nodes.scale.setScalar(0.72 + 0.28 * skeleton);

    // Core last, so the skeleton is visible through it before it solidifies.
    const skin = stage(e, 0.32, 1);
    this.fade(this.core, skin);
    this.fade(this.glow, skin);
    this.core.scale.setScalar(0.8 + 0.2 * skin);

    const sweep = stage(e, 0.18, 1);
    for (const ring of this.rings) {
      ring.scale.setScalar(0.15 + 0.85 * sweep);
      this.fade(ring, sweep * sweep);
    }
  }

  /**
   * Implodes the ball and throws a shockwave off it. 0 is intact, 1 is gone.
   *
   * Uniform scale, deliberately. The previous collapse squashed along the line
   * between your palms and bulged across it, which grew to a 1.4 aspect ratio on
   * the way down and then spent one frame at 72:1 as a vertical line, because
   * the across axis was floored at 0.05 and the along axis was not. Scaling one
   * number cannot distort, so that whole class of problem is gone rather than
   * retuned.
   *
   * The energy comes from the ring instead: everything on the ball is pulled
   * inward, and a single wave expands outward through where it used to be.
   */
  setCollapse(t: number): void {
    const e = clamp01(t);

    // The cloud is drawn in rather than blown out, so the whole body reads as
    // one implosion and the shockwave is the only thing travelling outward.
    this.particles.scale.setScalar(1 - 0.55 * e);
    this.fade(this.particles, Math.pow(1 - e, 1.1));

    const solid = Math.pow(1 - e, 1.4);
    this.fade(this.core, solid);
    this.fade(this.glow, solid);
    this.core.scale.setScalar(1);

    // The lattice outlives the core slightly, so the last thing to go is the
    // wireframe rather than a solid ball winking out.
    const lattice = Math.pow(1 - e, 0.85);
    for (const shell of this.shells) {
      this.fade(shell, lattice);
      shell.scale.setScalar(1);
    }
    this.fade(this.nodes, lattice);
    this.nodes.scale.setScalar(1);

    for (const ring of this.rings) {
      ring.scale.setScalar(1 - 0.7 * e);
      this.fade(ring, Math.pow(1 - e, 1.2));
    }

    // Slightly taller than it is wide, and `root` is rotated onto the palm axis,
    // so the wave escapes across the squeeze rather than along it.
    this.shockwave.visible = e > 0.002 && e < 0.999;
    const r = 0.45 + e * 2.9;
    this.shockwave.scale.set(r * 0.92, r * 1.18, r);
    this.fade(this.shockwave, Math.min(1, e * 5) * Math.pow(1 - e, 1.5));
  }

  setPower(t: number): void {
    const blended = CYAN.clone().lerp(ORANGE, Math.max(0, Math.min(1, t)));
    (this.core.material as THREE.MeshPhysicalMaterial).emissive.copy(blended);
    (this.glow.material as THREE.MeshBasicMaterial).color.copy(blended);
    for (const s of this.shells) (s.material as THREE.LineBasicMaterial).color.copy(blended);
    for (const r of this.rings) (r.material as THREE.MeshBasicMaterial).color.copy(blended);
    (this.particles.material as THREE.PointsMaterial).color.copy(blended);
    (this.shockwave.material as THREE.MeshBasicMaterial).color.copy(blended);
  }

  /** `spin` scales the idle rotation, so a summon can spin up and settle. */
  update(dt: number, spin = 1): void {
    const d = dt * spin;
    this.shells[0].rotation.y += d * 0.18;
    this.shells[0].rotation.x += d * 0.05;
    this.shells[1].rotation.y -= d * 0.26;
    this.nodes.rotation.copy(this.shells[0].rotation);
    this.particles.rotation.y += d * 0.07;
    this.rings[0].rotation.x += d * 0.5;
    this.rings[1].rotation.y += d * 0.42;
    this.rings[2].rotation.z += d * 0.36;
  }
}

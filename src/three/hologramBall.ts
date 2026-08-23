import * as THREE from "three";

const CYAN = new THREE.Color(0x7fe8de);
const ORANGE = new THREE.Color(0xff9b4d);

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
  private core: THREE.Mesh;
  private glow: THREE.Mesh;
  private shells: THREE.LineSegments[] = [];
  private nodes: THREE.Points;
  private rings: THREE.Mesh[] = [];
  private particles: THREE.Points;
  private sprite = glowSprite();

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
    this.root.add(this.core);

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
    this.root.add(this.glow);

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
      this.root.add(shell);
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
    this.root.add(this.nodes);

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
      this.root.add(ring);
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
    this.root.add(this.particles);
  }

  setPower(t: number): void {
    const blended = CYAN.clone().lerp(ORANGE, Math.max(0, Math.min(1, t)));
    (this.core.material as THREE.MeshPhysicalMaterial).emissive.copy(blended);
    (this.glow.material as THREE.MeshBasicMaterial).color.copy(blended);
    for (const s of this.shells) (s.material as THREE.LineBasicMaterial).color.copy(blended);
    for (const r of this.rings) (r.material as THREE.MeshBasicMaterial).color.copy(blended);
    (this.particles.material as THREE.PointsMaterial).color.copy(blended);
  }

  update(dt: number): void {
    this.shells[0].rotation.y += dt * 0.18;
    this.shells[0].rotation.x += dt * 0.05;
    this.shells[1].rotation.y -= dt * 0.26;
    this.nodes.rotation.copy(this.shells[0].rotation);
    this.particles.rotation.y += dt * 0.07;
    this.rings[0].rotation.x += dt * 0.5;
    this.rings[1].rotation.y += dt * 0.42;
    this.rings[2].rotation.z += dt * 0.36;
  }
}

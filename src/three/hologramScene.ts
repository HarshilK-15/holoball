import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { FOLLOW, TIMING } from "../state/types";
import { runtime, useHologramStore } from "../state/hologramStore";
import { tickStateMachine } from "../state/stateMachine";
import { HologramBall } from "./hologramBall";
import { worldPosition } from "./worldMapping";

const FOV = 55;
const BALL_DEPTH = 6;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Base glow strength. The materialise and the crush both flash above it. */
const BLOOM_BASE = 0.85;

/**
 * Ease out with a slight overshoot past 1 before settling. This is what makes
 * the summon read as snappy rather than merely quick: the ball arrives a touch
 * larger than its resting size and eases back, which the eye reads as impact.
 * The overshoot is deliberately small, since the ball is often near the hand.
 */
const easeOutBack = (t: number): number => {
  const c = 1.42;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** Rebases a per-frame-at-60fps easing rate onto the actual frame time. */
const frameRateSafe = (rate: number, dt: number): number =>
  1 - Math.pow(1 - rate, Math.min(dt, 0.1) * 60);

export class HologramScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private ball = new HologramBall();
  private keyLight: THREE.PointLight;
  private clock = new THREE.Clock();
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    // alpha true plus a fully transparent clear colour is what lets the camera
    // feed show through. Getting this wrong is how the old app went black.
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.z = BALL_DEPTH;

    this.keyLight = new THREE.PointLight(0x7fe8de, 60, 40);
    this.keyLight.position.set(2.5, 2.5, 4);
    this.scene.add(this.keyLight);
    this.scene.add(new THREE.PointLight(0x3a6f8a, 18, 40).translateX(-3).translateY(-2));
    this.scene.add(new THREE.AmbientLight(0x18313a, 1.2));

    this.ball.root.visible = false;
    this.scene.add(this.ball.root);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_BASE, 0.55, 0.2);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.resize();
    window.addEventListener("resize", this.resize);
  }

  private resize = (): void => {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  };

  start(): void {
    const loop = (): void => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
  }

  private frame(): void {
    const dt = this.clock.getDelta();
    // Must match the clock the camera loop stamps modeStart with. THREE.Clock
    // starts at zero on construction, so mixing the two makes animation
    // progress start at a large negative number and crawl.
    const now = performance.now() / 1000;
    tickStateMachine(now);

    const mode = useHologramStore.getState().mode;
    this.ball.root.visible = mode !== "hidden";
    this.ball.setPower(mode === "trapped" ? 1 : runtime.powerMode);
    this.ball.setSpin(runtime.spin);
    let flash = 0;

    const viewAspect = this.camera.aspect;
    const target = worldPosition(
      runtime.targetPosition,
      viewAspect,
      runtime.imageAspect,
      BALL_DEPTH,
      THREE.MathUtils.degToRad(FOV),
    );

    if (mode === "spawning") {
      const t = clamp01((now - runtime.modeStart) / TIMING.spawnDuration);
      const eased = 1 - Math.pow(1 - t, 3);

      // Driven by time alone, deliberately. An earlier version ratcheted this
      // against live hand openness so the ball would follow your fingers, but
      // the hand finishes opening about 100ms after the trigger fires, which
      // drove the bloom to full in roughly three frames and left the staged
      // materialise no time to play. Responsiveness comes from the trigger
      // firing promptly, not from the ball chasing the finger position.
      const p = eased;

      // Overshoot applies to scale, not to progress, so the ball can settle back
      // from its overshoot without the animation running backwards. Fed the raw
      // t rather than `eased`: easeOutBack is itself an ease-out, and composing
      // the two front-loads the curve so hard that the ball is at four fifths of
      // full size 40ms in, which is the pop this is meant to remove.
      runtime.currentScale = easeOutBack(t) * runtime.targetScale;
      runtime.currentPosition = runtime.targetPosition;
      this.ball.setFormation(p);
      // Spins up hard and settles, so the ball looks like it is coming online.
      this.ball.update(dt, 1 + 5 * (1 - p) * (1 - p));
      // Raw t, so the glow peaks with the ball's arrival at mid-animation. Fed
      // `eased` it peaked at 67ms, flaring before there was anything to flare at.
      flash = Math.sin(Math.PI * t) * 0.9;
      this.ball.root.rotation.z = 0;
      this.ball.root.position.set(target.x, target.y, 0);
      this.ball.setScale(runtime.currentScale);
    } else if (mode === "active") {
      // Converted from a per-frame rate to a time-based one, so tracking feels
      // the same at 30fps as at 60. A raw per-frame lerp halves its speed when
      // the frame rate halves, which is exactly when it is already lagging.
      const posK = frameRateSafe(FOLLOW.position, dt);
      const scaleK = frameRateSafe(FOLLOW.scale, dt);
      runtime.currentPosition = {
        x: runtime.currentPosition.x + (runtime.targetPosition.x - runtime.currentPosition.x) * posK,
        y: runtime.currentPosition.y + (runtime.targetPosition.y - runtime.currentPosition.y) * posK,
      };
      runtime.currentScale += (runtime.targetScale - runtime.currentScale) * scaleK;
      this.ball.setFormation(1);
      this.ball.update(dt);
      const pos = worldPosition(
        runtime.currentPosition,
        viewAspect,
        runtime.imageAspect,
        BALL_DEPTH,
        THREE.MathUtils.degToRad(FOV),
      );
      this.ball.root.rotation.z = 0;
      this.ball.root.position.set(pos.x, pos.y, 0);
      this.ball.setScale(runtime.currentScale);
    } else if (mode === "trapped") {
      const p = clamp01((now - runtime.modeStart) / TIMING.trapDuration);

      // The ball is flung into the point where the palms actually met before it
      // collapses, so the clap looks like it caught something rather than like
      // the ball happened to fold up nearby.
      const rush = clamp01(p / TIMING.trapRushFraction);
      const rushed = 1 - Math.pow(1 - rush, 3);
      const from = runtime.trapStartPosition;
      const to = runtime.trapPoint;
      const contact = worldPosition(
        {
          x: from.x + (to.x - from.x) * rushed,
          y: from.y + (to.y - from.y) * rushed,
        },
        viewAspect,
        runtime.imageAspect,
        BALL_DEPTH,
        THREE.MathUtils.degToRad(FOV),
      );
      this.ball.root.position.set(contact.x, contact.y, 0);

      // Aligns local x with the line between your palms. The ball itself is
      // scaled uniformly and so is unaffected, but it orients the shockwave,
      // which is taller than it is wide and therefore escapes across the
      // squeeze rather than along it.
      this.ball.root.rotation.z = Math.atan2(runtime.trapAxis.y, runtime.trapAxis.x);

      // No lead-in. The collapse used to wait out `trapRushFraction * 0.5`,
      // which left the first 67ms with nothing happening at all: the ball hung
      // at full size and then snapped. It now shrinks while it flies in, which
      // is also what makes it read as being pulled into your hands.
      const collapse = p;

      // Smoothstep, so the shrink eases in and eases out. The endpoints are
      // where an implosion is most easily caught looking abrupt, and this has
      // zero rate of change at both of them.
      const shrink = 1 - collapse * collapse * (3 - 2 * collapse);
      this.ball.setScale(runtime.trapStartScale * shrink);
      this.ball.setCollapse(collapse);
      // Spins down as it is pinned, then the glow spikes at the moment it goes.
      this.ball.update(dt, 1 - 0.7 * collapse);
      flash = Math.pow(collapse, 2) * 1.5;
    } else {
      this.ball.update(dt);
    }

    this.bloomPass.strength = BLOOM_BASE + flash;

    this.keyLight.color.copy(
      new THREE.Color(0x7fe8de).lerp(new THREE.Color(0xff9b4d), runtime.powerMode),
    );
    this.composer.render();
  }
}

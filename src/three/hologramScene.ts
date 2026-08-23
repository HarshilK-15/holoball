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

/** Rebases a per-frame-at-60fps easing rate onto the actual frame time. */
const frameRateSafe = (rate: number, dt: number): number =>
  1 - Math.pow(1 - rate, Math.min(dt, 0.1) * 60);

export class HologramScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
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
    this.composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.55, 0.2),
    );
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
    this.ball.update(dt);
    this.ball.setPower(mode === "trapped" ? 1 : runtime.powerMode);

    const viewAspect = this.camera.aspect;
    const target = worldPosition(
      runtime.targetPosition,
      viewAspect,
      runtime.imageAspect,
      BALL_DEPTH,
      THREE.MathUtils.degToRad(FOV),
    );

    if (mode === "spawning") {
      const p = clamp01((now - runtime.modeStart) / TIMING.spawnDuration);
      const eased = 1 - Math.pow(1 - p, 3);
      runtime.currentScale = eased * runtime.targetScale;
      runtime.currentPosition = runtime.targetPosition;
      this.ball.root.position.set(target.x, target.y, 0);
      this.ball.root.scale.setScalar(Math.max(0.001, runtime.currentScale));
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
      const pos = worldPosition(
        runtime.currentPosition,
        viewAspect,
        runtime.imageAspect,
        BALL_DEPTH,
        THREE.MathUtils.degToRad(FOV),
      );
      this.ball.root.position.set(pos.x, pos.y, 0);
      this.ball.root.scale.setScalar(Math.max(0.001, runtime.currentScale));
    } else if (mode === "trapped") {
      const p = clamp01((now - runtime.modeStart) / TIMING.trapDuration);
      const s = runtime.trapStartScale;
      this.ball.root.scale.set(
        Math.max(0.001, s * (1 - p * 0.75)),
        Math.max(0.001, s * (1 + p * 0.35)),
        Math.max(0.001, s * (1 + p * 0.2)),
      );
      this.ball.root.position.set(target.x, target.y, 0);
    }

    this.keyLight.color.copy(
      new THREE.Color(0x7fe8de).lerp(new THREE.Color(0xff9b4d), runtime.powerMode),
    );
    this.composer.render();
  }
}

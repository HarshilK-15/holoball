import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { GESTURE, type Vec2 } from "../state/types";
import { runtime, useHologramStore } from "../state/hologramStore";
import { triggerHandClap } from "../state/stateMachine";
import { ClapDetector } from "./clapDetector";
import {
  fistCurlScore,
  isFist,
  palmCenter,
  pinchDistance,
  pinchToScale,
  smooth,
  smoothScalar,
  type Hand,
} from "./handGeometry";
import { classifyClap, isClassifierReady } from "./gestureClassifier";

export interface FeatureFrame {
  spread: number;
  closingVelocity: number;
  pinch: number;
  curl: number;
}

const BUFFER_FRAMES = 20;

export class CameraController {
  private detector = new ClapDetector();
  private smoothedPalms: (Vec2 | null)[] = [null, null];
  private smoothedPinch: number | null = null;
  private featureBuffer: FeatureFrame[] = [];
  private prevSpread = 0;
  private prevTime = 0;
  private frameTimes: number[] = [];

  constructor(
    private landmarker: HandLandmarker,
    private video: HTMLVideoElement,
  ) {}

  /** Mirrored preview means landmark x must be flipped to match what the user sees. */
  private mirrorX(v: Vec2): Vec2 {
    return { x: 1 - v.x, y: v.y };
  }

  getFeatureBuffer(): FeatureFrame[] {
    return this.featureBuffer;
  }

  processFrame(nowMs: number): void {
    const now = nowMs / 1000;
    const store = useHologramStore.getState();

    this.frameTimes.push(now);
    while (this.frameTimes.length > 30) this.frameTimes.shift();
    if (this.frameTimes.length > 1) {
      const span = this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0];
      if (span > 0) store.patch({ fps: Math.round((this.frameTimes.length - 1) / span) });
    }

    if (this.video.readyState < 2) return;
    runtime.imageAspect = this.video.videoWidth / this.video.videoHeight || 16 / 9;

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    const hands = (result.landmarks ?? []) as Hand[];

    // Sort by x so left/right slots stay stable; tracking order is not guaranteed.
    const sorted = [...hands].sort((a, b) => palmCenter(a).x - palmCenter(b).x);
    const handCount = sorted.length;

    let palmA: Vec2 | null = null;
    let palmB: Vec2 | null = null;
    if (handCount >= 1) {
      this.smoothedPalms[0] = smooth(
        this.smoothedPalms[0],
        this.mirrorX(palmCenter(sorted[0])),
        GESTURE.palmSmoothing,
      );
      palmA = this.smoothedPalms[0];
    }
    if (handCount >= 2) {
      this.smoothedPalms[1] = smooth(
        this.smoothedPalms[1],
        this.mirrorX(palmCenter(sorted[1])),
        GESTURE.palmSmoothing,
      );
      palmB = this.smoothedPalms[1];
    }

    const dt = Math.max(1e-3, now - this.prevTime);
    const clapCandidate = this.detector.update({
      time: now,
      handCount,
      palmA,
      palmB,
      imageAspect: runtime.imageAspect,
    });

    const spread = this.detector.spread;
    this.featureBuffer.push({
      spread,
      closingVelocity: (this.prevSpread - spread) / dt,
      pinch: this.smoothedPinch ?? 0,
      curl: handCount >= 1 ? fistCurlScore(sorted[0], runtime.imageAspect) : 0,
    });
    while (this.featureBuffer.length > BUFFER_FRAMES) this.featureBuffer.shift();
    this.prevSpread = spread;
    this.prevTime = now;

    if (clapCandidate) {
      // The classifier confirms candidates; until it is trained the geometric
      // detector stands on its own.
      const confirmed = isClassifierReady() ? classifyClap(this.featureBuffer) : true;
      if (confirmed) triggerHandClap(now);
    }

    if (handCount >= 1) {
      const primary = sorted[0];
      const palm = palmA!;
      const mid =
        handCount >= 2 && palmB
          ? { x: (palm.x + palmB.x) / 2, y: (palm.y + palmB.y) / 2 }
          : palm;
      runtime.lastHandMidpoint = mid;

      if (store.mode === "active") {
        runtime.targetPosition = mid;
        const fisted = isFist(primary, runtime.imageAspect);
        if (fisted) {
          runtime.powerMode += (1 - runtime.powerMode) * GESTURE.powerRamp;
        } else {
          runtime.powerMode += (0 - runtime.powerMode) * GESTURE.powerRamp;
          const raw = pinchDistance(primary, runtime.imageAspect);
          this.smoothedPinch = smoothScalar(this.smoothedPinch, raw, GESTURE.pinchSmoothing);
          runtime.targetScale = pinchToScale(this.smoothedPinch);
        }
        store.patch({ gestureLabel: fisted ? "POWER" : "TRACK" });
      } else {
        store.patch({ gestureLabel: handCount >= 2 ? "READY" : "IDLE" });
      }
    } else {
      store.patch({ gestureLabel: "IDLE" });
    }

    store.patch({
      handCount,
      armed: this.detector.isArmed,
      spreadReadout: spread,
      pinchReadout: this.smoothedPinch ?? 0,
      scaleReadout: runtime.currentScale,
      powerReadout: runtime.powerMode,
    });
  }
}

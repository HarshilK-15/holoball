import { GESTURE, type Vec2 } from "../state/types";
import { separation } from "./handGeometry";

export interface ClapFrame {
  time: number;
  handCount: number;
  palmA: Vec2 | null;
  palmB: Vec2 | null;
  imageAspect: number;
}

/**
 * Geometric clap detector, ported from the old CameraManager.swift.
 * Runs as the fast first pass; candidates it emits are confirmed by the
 * TFJS classifier before a clap actually fires.
 */
export class ClapDetector {
  private armed = false;
  private lastSpread = Number.POSITIVE_INFINITY;
  private lastSpreadTime = 0;
  private lastClapTime = -Infinity;
  private lastTwoHandTime = -Infinity;

  reset(): void {
    this.armed = false;
    this.lastSpread = Number.POSITIVE_INFINITY;
    this.lastClapTime = -Infinity;
    this.lastTwoHandTime = -Infinity;
  }

  get spread(): number {
    return Number.isFinite(this.lastSpread) ? this.lastSpread : 0;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /** Returns true when this frame produces a clap candidate. */
  update(frame: ClapFrame): boolean {
    const { time, handCount, palmA, palmB, imageAspect } = frame;
    const sinceLastClap = time - this.lastClapTime;

    if (handCount >= 2 && palmA && palmB) {
      const spread = separation(palmA, palmB, imageAspect);
      const dt = Math.max(1e-3, time - this.lastSpreadTime);
      const closingSpeed = (this.lastSpread - spread) / dt;

      if (spread > GESTURE.clapOpenThreshold) this.armed = true;

      const closedFromArmed = this.armed && spread < GESTURE.clapCloseThreshold;
      const closingFast =
        Number.isFinite(this.lastSpread) && closingSpeed > GESTURE.clapClosingVelocity;

      this.lastSpread = spread;
      this.lastSpreadTime = time;
      this.lastTwoHandTime = time;

      if ((closedFromArmed || closingFast) && sinceLastClap > GESTURE.clapDebounce) {
        this.armed = false;
        this.lastClapTime = time;
        return true;
      }
      return false;
    }

    // Fast claps blur and hands overlap, so the tracker often drops one or both
    // mid-motion. Without this branch the most deliberate claps are exactly the
    // ones that never register.
    const droppedMidClap =
      this.armed &&
      this.lastSpread < GESTURE.clapOpenThreshold * 0.85 &&
      time - this.lastTwoHandTime < 0.5 &&
      sinceLastClap > GESTURE.clapDebounce;

    if (droppedMidClap) {
      this.armed = false;
      this.lastClapTime = time;
      return true;
    }
    return false;
  }
}

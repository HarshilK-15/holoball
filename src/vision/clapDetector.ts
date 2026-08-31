import { CLAP_TIGHT, type ClapTuning, type Vec2 } from "../state/types";
import { separation } from "./handGeometry";

export interface ClapFrame {
  time: number;
  handCount: number;
  palmA: Vec2 | null;
  palmB: Vec2 | null;
  imageAspect: number;
  /**
   * Consecutive clean two-hand frames. Resets whenever a hand is lost or
   * re-acquired somewhere else, because a teleported landmark looks identical
   * to an extremely fast clap.
   */
  stableFrames: number;
  /** Both hands closed. That is the carry grab, and it must never clap. */
  bothFisted: boolean;
}

export interface ClapCandidate {
  time: number;
  /** Where the palms met, so the collapse can play between your hands. */
  contact: Vec2;
  /** Screen-space palm-to-palm direction, for orienting the squash. */
  axis: Vec2;
  closingSpeed: number;
  reason: "contact" | "crossing" | "dropped";
}

interface Sample {
  time: number;
  spread: number;
}

/**
 * Geometric clap detector. Originally a port of the old CameraManager.swift,
 * rewritten because the port fired on things that were not claps and reported
 * the ones that were too late to feel connected to the gesture.
 *
 * Three ideas carry the rewrite:
 *   - speed is measured over a short span, not one frame, so tracker noise
 *     cannot manufacture a clap
 *   - a clap fires on predicted contact rather than on arrival, which is what
 *     puts it on the beat instead of trailing behind it
 *   - every path needs real closing speed, so slowly bringing your hands
 *     together is a gesture in its own right rather than an accidental clap
 */
export class ClapDetector {
  private tuning: ClapTuning = CLAP_TIGHT;
  private armed = false;
  private samples: Sample[] = [];
  private lastSpread = Number.POSITIVE_INFINITY;
  private lastClapTime = -Infinity;
  private lastTwoHandTime = -Infinity;
  private lastSpeed = 0;
  private lastMidpoint: Vec2 = { x: 0.5, y: 0.5 };
  private lastAxis: Vec2 = { x: 1, y: 0 };

  setTuning(tuning: ClapTuning): void {
    this.tuning = tuning;
  }

  reset(): void {
    this.armed = false;
    this.samples = [];
    this.lastSpread = Number.POSITIVE_INFINITY;
    this.lastClapTime = -Infinity;
    this.lastTwoHandTime = -Infinity;
    this.lastSpeed = 0;
  }

  get spread(): number {
    return Number.isFinite(this.lastSpread) ? this.lastSpread : 0;
  }

  get closingSpeed(): number {
    return this.lastSpeed;
  }

  get isArmed(): boolean {
    return this.armed;
  }

  /**
   * Closing speed across the tuning window rather than across one frame. A
   * single frame at 30fps is a 33ms sample of a noisy signal; the windowed
   * version is what makes the velocity thresholds mean anything.
   */
  private speedOver(now: number, spread: number): number {
    const cutoff = now - this.tuning.speedWindow;
    let oldest: Sample | null = null;
    for (const s of this.samples) {
      if (s.time >= cutoff) {
        oldest = s;
        break;
      }
    }
    if (!oldest) oldest = this.samples[0] ?? null;
    if (!oldest) return 0;
    const dt = now - oldest.time;
    if (dt < 1e-3) return 0;
    return (oldest.spread - spread) / dt;
  }

  /** Returns a candidate on the frame a clap is detected, otherwise null. */
  update(frame: ClapFrame): ClapCandidate | null {
    const { time, handCount, palmA, palmB, imageAspect, stableFrames, bothFisted } = frame;
    const t = this.tuning;
    const sinceLastClap = time - this.lastClapTime;

    if (handCount >= 2 && palmA && palmB) {
      const spread = separation(palmA, palmB, imageAspect);

      this.samples.push({ time, spread });
      const keepFrom = time - t.speedWindow * 2;
      while (this.samples.length > 2 && this.samples[0].time < keepFrom) this.samples.shift();

      const speed = this.speedOver(time, spread);
      this.lastSpread = spread;
      this.lastSpeed = speed;
      this.lastTwoHandTime = time;
      this.lastMidpoint = { x: (palmA.x + palmB.x) / 2, y: (palmA.y + palmB.y) / 2 };

      // Screen space, not normalized space: x is stretched by the image aspect
      // and y runs the other way, so the renderer can use this angle directly.
      const ax = (palmB.x - palmA.x) * imageAspect;
      const ay = -(palmB.y - palmA.y);
      const len = Math.hypot(ax, ay) || 1;
      this.lastAxis = { x: ax / len, y: ay / len };

      if (spread > t.openThreshold) this.armed = true;

      // A grab is two fists coming together deliberately. Keep measuring so the
      // speed history stays continuous, but disarm so it cannot fire here or on
      // the drop branch a few frames later.
      if (bothFisted) {
        this.armed = false;
        return null;
      }

      const trusted = stableFrames >= t.minStableFrames;
      const timeToContact = speed > 1e-3 ? spread / speed : Infinity;

      // Predictive: the palms are closing fast and are about to meet. Firing
      // here rather than on arrival is what removes the lag behind the clap.
      const contactFire = trusted && speed > t.fastClosingVelocity && timeToContact < t.timeToContact;

      // Fallback for a clap that started from close range and never built up
      // much speed. It still has to be moving: crossing the threshold slowly is
      // a carry, not a clap.
      const crossingFire =
        trusted && this.armed && spread < t.closeThreshold && speed > t.minClosingVelocity;

      if ((contactFire || crossingFire) && sinceLastClap > t.debounce) {
        this.armed = false;
        this.lastClapTime = time;
        return {
          time,
          contact: this.lastMidpoint,
          axis: this.lastAxis,
          closingSpeed: speed,
          reason: contactFire ? "contact" : "crossing",
        };
      }
      return null;
    }

    // Hands blur and overlap at speed, so the tracker often drops one or both
    // right at contact. Without this branch the most committed claps are the
    // ones that never register. It used to fire on any hand leaving frame while
    // armed, which is ordinary behaviour and was the main source of the ball
    // closing at random; now the hands must have been genuinely rushing
    // together in the moments before the drop.
    const droppedMidClap =
      this.armed &&
      this.lastSpread < this.tuning.closeThreshold * 1.15 &&
      time - this.lastTwoHandTime < t.dropWindow &&
      this.lastSpeed > t.dropClosingVelocity &&
      sinceLastClap > t.debounce;

    if (droppedMidClap) {
      this.armed = false;
      this.lastClapTime = time;
      return {
        time,
        contact: this.lastMidpoint,
        axis: this.lastAxis,
        closingSpeed: this.lastSpeed,
        reason: "dropped",
      };
    }
    return null;
  }
}

import { APPROACH, type Vec2 } from "../state/types";
import { separation } from "./handGeometry";

export interface ApproachFrame {
  time: number;
  handCount: number;
  palmA: Vec2 | null;
  palmB: Vec2 | null;
  imageAspect: number;
}

export interface ApproachEvent {
  time: number;
  /** Where the palms came together, matching ClapCandidate's shape. */
  contact: Vec2;
  axis: Vec2;
  /** The widest the hands were before closing. The approach's starting point. */
  openSpread: number;
  /** How close the palms actually came. This is what separates a clap from a near miss. */
  minSpread: number;
  /** Fastest closing speed reached on the way in. */
  closingSpeed: number;
  reason: "reversal" | "merge" | "hold";
}

interface Sample {
  time: number;
  spread: number;
}

/**
 * Two-hand convergence detector for the dataset recorder.
 *
 * The recorder used to auto-capture off `ClapDetector`, which cannot work for
 * two independent reasons:
 *
 *   - a near miss is by definition an approach the clap detector rejects, so
 *     that label could never capture a single clip no matter the thresholds
 *   - the clap thresholds are absolute distances that never matched this
 *     camera, so `armed` rarely opened and claps went uncaptured too
 *
 * This detector answers a deliberately weaker question: did the hands come
 * together and then stop coming together? Clap, near miss and everything
 * between all answer yes, and the human at the keyboard supplies the label.
 * That is the correct division of labour for building a training set, and it is
 * why the class this detector cannot distinguish is exactly the class the model
 * is being trained to learn.
 *
 * It calibrates against the widest opening it has actually seen rather than a
 * fixed number, so it adapts to your camera distance instead of needing to be
 * retuned for it.
 */
export class ApproachDetector {
  private phase: "idle" | "closing" = "idle";
  private openSpread = 0;
  private minSpread = Number.POSITIVE_INFINITY;
  private peakSpeed = 0;
  private samples: Sample[] = [];
  private lastSpread = Number.POSITIVE_INFINITY;
  private lastTwoHandTime = -Infinity;
  private startTime = -Infinity;
  private minTime = -Infinity;
  private lastEventTime = -Infinity;
  private lastMidpoint: Vec2 = { x: 0.5, y: 0.5 };
  private lastAxis: Vec2 = { x: 1, y: 0 };
  /** Why the last frame did not fire. Surfaced in the recorder's telemetry. */
  private blocked = "waiting for two hands";

  get state(): string {
    return this.phase;
  }
  get widestOpening(): number {
    return this.openSpread;
  }
  get closestApproach(): number {
    return Number.isFinite(this.minSpread) ? this.minSpread : 0;
  }
  get blockReason(): string {
    return this.blocked;
  }

  reset(): void {
    this.phase = "idle";
    this.openSpread = 0;
    this.minSpread = Number.POSITIVE_INFINITY;
    this.peakSpeed = 0;
    this.samples = [];
    this.lastSpread = Number.POSITIVE_INFINITY;
    this.lastEventTime = -Infinity;
    this.blocked = "waiting for two hands";
  }

  /** Closing speed across the tuning window, so one noisy frame cannot fake it. */
  private speedOver(now: number, spread: number): number {
    const cutoff = now - APPROACH.speedWindow;
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

  private emit(time: number, reason: ApproachEvent["reason"]): ApproachEvent {
    const event: ApproachEvent = {
      time,
      contact: this.lastMidpoint,
      axis: this.lastAxis,
      openSpread: this.openSpread,
      minSpread: this.closestApproach,
      closingSpeed: this.peakSpeed,
      reason,
    };
    this.phase = "idle";
    this.lastEventTime = time;
    // Recalibrate from where the hands are now rather than carrying the old
    // opening forward, or one wide gesture would arm every twitch after it.
    // The history goes too, or the windowed max would immediately hand back the
    // pre-gesture opening and re-arm on the spot.
    this.samples = [];
    this.openSpread = Number.isFinite(this.lastSpread) ? this.lastSpread : 0;
    this.minSpread = Number.POSITIVE_INFINITY;
    this.peakSpeed = 0;
    this.blocked = "captured";
    return event;
  }

  /** True once the approach is substantial enough and old enough to be real. */
  private qualifies(time: number): boolean {
    if (time - this.lastEventTime <= APPROACH.debounce) {
      this.blocked = "debounce";
      return false;
    }
    if (time - this.startTime < APPROACH.minApproachTime) {
      this.blocked = "approach too brief";
      return false;
    }
    if (this.openSpread - this.closestApproach < APPROACH.minTravel) {
      this.blocked = "hands did not travel far enough";
      return false;
    }
    return true;
  }

  update(frame: ApproachFrame): ApproachEvent | null {
    const { time, handCount, palmA, palmB, imageAspect } = frame;

    if (handCount >= 2 && palmA && palmB) {
      const spread = separation(palmA, palmB, imageAspect);

      // Retained for the full opening window. `speedOver` still reads only the
      // samples inside its own shorter window, so one buffer serves both.
      this.samples.push({ time, spread });
      const keepFrom = time - Math.max(APPROACH.speedWindow * 2, APPROACH.openWindow);
      while (this.samples.length > 2 && this.samples[0].time < keepFrom) this.samples.shift();

      const speed = this.speedOver(time, spread);
      this.lastTwoHandTime = time;
      this.lastMidpoint = { x: (palmA.x + palmB.x) / 2, y: (palmA.y + palmB.y) / 2 };

      // Screen space, matching ClapDetector: x stretched by aspect, y flipped.
      const ax = (palmB.x - palmA.x) * imageAspect;
      const ay = -(palmB.y - palmA.y);
      const len = Math.hypot(ax, ay) || 1;
      this.lastAxis = { x: ax / len, y: ay / len };

      if (this.phase === "idle") {
        // The widest opening within the window. Recomputed while idle and then
        // frozen for the duration of an approach, so the whole approach is
        // measured against where it actually started from.
        let widest = spread;
        for (const s of this.samples) if (s.spread > widest) widest = s.spread;
        this.openSpread = widest;

        if (this.openSpread < APPROACH.minOpenSpread) {
          this.blocked = `hands never far enough apart (${this.openSpread.toFixed(2)} < ${APPROACH.minOpenSpread})`;
        } else if (spread < this.openSpread * APPROACH.closeRatio) {
          this.phase = "closing";
          this.startTime = time;
          this.minSpread = spread;
          this.minTime = time;
          this.peakSpeed = speed;
          this.blocked = "closing";
        } else {
          this.blocked = "hands not closing";
        }
        this.lastSpread = spread;
        return null;
      }

      this.peakSpeed = Math.max(this.peakSpeed, speed);
      if (spread < this.minSpread) {
        this.minSpread = spread;
        this.minTime = time;
      }
      this.lastSpread = spread;

      // The hands turned around: either they touched and bounced, or they came
      // close and pulled back. Both are events worth a clip, and which one it
      // was is precisely the label being collected.
      if (spread > this.minSpread + APPROACH.reboundMargin) {
        if (this.qualifies(time)) return this.emit(time, "reversal");
        this.phase = "idle";
        this.openSpread = spread;
        return null;
      }

      // Palms met and stayed together. No rebound is coming, so fire on the dwell.
      if (time - this.minTime > APPROACH.holdTime && this.qualifies(time)) {
        return this.emit(time, "hold");
      }
      return null;
    }

    // Fewer than two hands. Hands blur into one blob at contact and the tracker
    // routinely drops one exactly then, so a hand vanishing mid-approach is a
    // strong contact signal rather than something to discard.
    if (this.phase === "closing" && time - this.lastTwoHandTime < APPROACH.mergeWindow) {
      if (this.qualifies(time)) return this.emit(time, "merge");
      return null;
    }

    if (time - this.lastTwoHandTime > APPROACH.loseTimeout) {
      this.phase = "idle";
      this.openSpread = 0;
      this.minSpread = Number.POSITIVE_INFINITY;
      this.lastSpread = Number.POSITIVE_INFINITY;
      this.samples = [];
      this.blocked = "waiting for two hands";
    }
    return null;
  }
}

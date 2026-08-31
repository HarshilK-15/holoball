import { SQUASH, type Vec2 } from "../state/types";
import { separation } from "./handGeometry";

export interface SquashFrame {
  time: number;
  handCount: number;
  palmA: Vec2 | null;
  palmB: Vec2 | null;
  imageAspect: number;
  /** Both hands closed is the carry grab, and it must never dismiss. */
  bothFisted: boolean;
}

export interface SquashEvent {
  time: number;
  /** Where the palms were converging, so the collapse plays between them. */
  contact: Vec2;
  /** Palm-to-palm direction, for orienting the squash. */
  axis: Vec2;
  closingSpeed: number;
  minSpread: number;
}

interface Sample {
  time: number;
  spread: number;
}

/**
 * Dismiss detector: bring two open palms together around the ball.
 *
 * The important difference from the clap it replaces is that contact is not
 * required and is never waited for. Measured against the recorded clips this
 * fires about 133ms *before* the closest approach, with 93% of fires landing
 * while the hands are still more than 0.15 apart, which is the separation below
 * which MediaPipe stops reporting two hands at all. The old detector's most
 * reliable path depended on that blind zone, so its best case was the tracker's
 * worst one.
 *
 * It also no longer has to tell a clap from a near miss. Both are deliberate
 * converges and both should dismiss, which collapses the problem the classifier
 * existed to solve into plain geometry. Tuned on the 288 recorded clips it
 * catches 79.5% of deliberate converges with zero false fires across all 142
 * wave, rest and other-gesture clips. That recall is a lower bound: the clips
 * are 32 frames with two hands present only a third of the time, so the widest
 * opening is often never established, where live it runs on continuous history.
 *
 * As with the recorder's approach detector, nothing here is an absolute
 * distance. Everything is a ratio against the widest opening actually observed,
 * so it calibrates to how far apart you really hold your hands.
 */
export class SquashDetector {
  private phase: "idle" | "closing" = "idle";
  private samples: Sample[] = [];
  private openSpread = 0;
  private peakSpeed = 0;
  private minSpread = Number.POSITIVE_INFINITY;
  private lastTwoHandTime = -Infinity;
  private lastFire = -Infinity;
  private lastMidpoint: Vec2 = { x: 0.5, y: 0.5 };
  private lastAxis: Vec2 = { x: 1, y: 0 };
  private blocked = "waiting for two hands";

  get state(): string {
    return this.phase;
  }

  get isClosing(): boolean {
    return this.phase === "closing";
  }

  get blockReason(): string {
    return this.blocked;
  }

  reset(): void {
    this.phase = "idle";
    this.samples = [];
    this.openSpread = 0;
    this.peakSpeed = 0;
    this.minSpread = Number.POSITIVE_INFINITY;
    this.lastTwoHandTime = -Infinity;
    this.blocked = "waiting for two hands";
  }

  /** Blocks dismissing for a beat, so a summon cannot immediately undo itself. */
  suppress(time: number): void {
    this.reset();
    this.lastFire = time;
  }

  /** Closing speed across the tuning window rather than across one noisy frame. */
  private speedOver(now: number, spread: number): number {
    const cutoff = now - SQUASH.speedWindow;
    let oldest: Sample | null = null;
    for (const s of this.samples) {
      if (s.time >= cutoff) {
        oldest = s;
        break;
      }
    }
    oldest ??= this.samples[0] ?? null;
    if (!oldest) return 0;
    const dt = now - oldest.time;
    if (dt < 1e-3) return 0;
    return (oldest.spread - spread) / dt;
  }

  update(frame: SquashFrame): SquashEvent | null {
    const { time, handCount, palmA, palmB, imageAspect, bothFisted } = frame;

    if (handCount < 2 || !palmA || !palmB) {
      if (time - this.lastTwoHandTime > SQUASH.loseTimeout) {
        this.phase = "idle";
        this.samples = [];
      }
      this.blocked = "waiting for two hands";
      return null;
    }
    this.lastTwoHandTime = time;

    // Two fists is the carry grab. Keep measuring so the history stays
    // continuous, but never dismiss: carrying the ball into your own hands
    // would otherwise read as a squash.
    if (bothFisted) {
      this.phase = "idle";
      this.blocked = "carrying";
      return null;
    }

    const spread = separation(palmA, palmB, imageAspect);
    this.samples.push({ time, spread });
    const keepFrom = time - Math.max(SQUASH.speedWindow * 2, SQUASH.openWindow);
    while (this.samples.length > 2 && this.samples[0].time < keepFrom) this.samples.shift();

    const speed = this.speedOver(time, spread);
    this.lastMidpoint = { x: (palmA.x + palmB.x) / 2, y: (palmA.y + palmB.y) / 2 };

    // Screen space, not normalized space: x is stretched by the image aspect and
    // y runs the other way, so the renderer can use this angle directly.
    const ax = (palmB.x - palmA.x) * imageAspect;
    const ay = -(palmB.y - palmA.y);
    const len = Math.hypot(ax, ay) || 1;
    this.lastAxis = { x: ax / len, y: ay / len };

    if (this.phase === "idle") {
      let widest = spread;
      for (const s of this.samples) if (s.spread > widest) widest = s.spread;
      this.openSpread = widest;

      if (this.openSpread < SQUASH.minOpenSpread) {
        this.blocked = `hands never far enough apart (${this.openSpread.toFixed(2)})`;
      } else if (spread < this.openSpread * SQUASH.closeRatio) {
        this.phase = "closing";
        this.peakSpeed = speed;
        this.minSpread = spread;
        this.blocked = "closing";
      } else {
        this.blocked = "hands not closing";
      }
      return null;
    }

    if (speed > this.peakSpeed) this.peakSpeed = speed;
    if (spread < this.minSpread) this.minSpread = spread;

    // Drifting back apart abandons the attempt rather than leaving it latched,
    // so a converge that changes its mind does not fire later on stale state.
    if (spread > this.openSpread * SQUASH.reopenRatio) {
      this.phase = "idle";
      this.blocked = "hands reopened";
      return null;
    }

    const travel = this.openSpread - spread;
    if (travel < SQUASH.minTravel) {
      this.blocked = `travel ${travel.toFixed(2)} < ${SQUASH.minTravel}`;
      return null;
    }
    if (this.peakSpeed < SQUASH.minClosingSpeed) {
      // Slow convergence is two hands drifting while steering, not a dismiss.
      this.blocked = `too slow (${this.peakSpeed.toFixed(2)})`;
      return null;
    }
    if (time - this.lastFire <= SQUASH.debounce) {
      this.blocked = "debounced";
      return null;
    }

    this.lastFire = time;
    this.phase = "idle";
    this.samples = [];
    this.blocked = "dismissed";
    return {
      time,
      contact: { ...this.lastMidpoint },
      axis: { ...this.lastAxis },
      closingSpeed: this.peakSpeed,
      minSpread: this.minSpread,
    };
  }
}

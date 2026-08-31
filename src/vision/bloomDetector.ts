import { BLOOM } from "../state/types";

export interface BloomFrame {
  time: number;
  handCount: number;
  /**
   * Whether hand 0 passes `isFist`. Deliberately the same predicate that drives
   * power mode rather than a threshold on `fistCurlScore`: the curl score tops
   * out around 0.45 on a real fist and reaches 0.30 on an open hand, so any
   * threshold between them is thin. Sharing `isFist` also means the summon and
   * the power gesture can never disagree about what a fist is.
   */
  fisted: boolean;
  /** Continuous 0..1 curl of hand 0, used only for the openness ramp. */
  curl: number;
}

export interface BloomEvent {
  time: number;
}

/**
 * Summon detector: hold a fist, then open your hand.
 *
 * This replaces the clap, which could not work. Two hands are only tracked 6.6%
 * of the time while touching, so a gesture that ends in contact is invisible to
 * the tracker at the exact instant it carries its meaning. One hand is tracked
 * 93.8% of the time and `curl` is the least noisy signal available (0.65%
 * frame-to-frame jitter against 1.23% for palm separation).
 *
 * Nothing here collides with power mode. `charging` is evaluated only inside the
 * active-mode block, so while the ball is hidden a fist means nothing at all;
 * by the time a fist means power, this detector has already stopped running.
 */
export class BloomDetector {
  private fistStart: number | null = null;
  private armed = false;
  private releaseStart: number | null = null;
  private lastHandTime = -Infinity;
  private suppressUntil = -Infinity;
  private blocked = "show one hand";
  private currentOpenness = 0;

  get isArmed(): boolean {
    return this.armed;
  }

  get openness(): number {
    return this.currentOpenness;
  }

  get blockReason(): string {
    return this.blocked;
  }

  reset(): void {
    this.fistStart = null;
    this.armed = false;
    this.releaseStart = null;
    this.lastHandTime = -Infinity;
    this.blocked = "show one hand";
  }

  /** Blocks summoning for a beat, so a dismiss cannot bounce straight back. */
  suppress(time: number): void {
    this.reset();
    this.suppressUntil = time + BLOOM.debounce;
  }

  /** 1 when the hand is fully open, 0 when it is closed. */
  private toOpenness(curl: number): number {
    const t = (BLOOM.closedCurl - curl) / (BLOOM.closedCurl - BLOOM.openCurl);
    return Math.max(0, Math.min(1, t));
  }

  update(frame: BloomFrame): BloomEvent | null {
    const { time, handCount, fisted, curl } = frame;

    if (handCount < 1) {
      // A hand blinking out for a frame or two must not throw away a held fist,
      // or the gesture would have to be restarted every time tracking hiccups.
      if (time - this.lastHandTime > BLOOM.loseTimeout) {
        this.fistStart = null;
        this.armed = false;
        this.releaseStart = null;
      }
      this.blocked = "no hand";
      return null;
    }
    this.lastHandTime = time;
    this.currentOpenness = this.toOpenness(curl);

    if (time < this.suppressUntil) {
      this.blocked = "settling after dismiss";
      return null;
    }

    if (fisted) {
      this.fistStart ??= time;
      this.releaseStart = null;
      if (time - this.fistStart >= BLOOM.armDwell) {
        this.armed = true;
        this.blocked = "armed, open your hand";
      } else {
        this.blocked = "hold the fist";
      }
      return null;
    }

    this.fistStart = null;
    if (!this.armed) {
      this.blocked = "make a fist first";
      return null;
    }

    // The hand has left the fist. It now has a limited window to actually open,
    // so that a fist relaxing slowly into a neutral hand is not a summon.
    this.releaseStart ??= time;
    if (time - this.releaseStart > BLOOM.releaseWindow) {
      this.armed = false;
      this.releaseStart = null;
      this.blocked = "opened too slowly";
      return null;
    }

    if (curl > BLOOM.openCurl) {
      this.blocked = "opening";
      return null;
    }

    this.armed = false;
    this.releaseStart = null;
    this.blocked = "summoned";
    return { time };
  }
}

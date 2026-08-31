import { ROTATION } from "./types";
import { runtime } from "./hologramStore";
import {
  IDENTITY,
  conj,
  mul,
  normalize,
  slerp,
  toAxisAngle,
  type Quat,
} from "./orientation";

export interface RotationCommand {
  time: number;
  /** Seconds since the previous camera frame. */
  dt: number;
  /** The gripping hand's 3D orientation, or null when nothing has hold. */
  hand: Quat | null;
}

/** Rebases a per-frame-at-60fps rate onto the actual frame time. */
const frameRateSafe = (rate: number, dt: number): number =>
  1 - Math.pow(1 - rate, Math.min(dt, 0.1) * 60);

/**
 * The ball copies your hand.
 *
 * Taking hold records both the hand's orientation and the ball's. From then on
 * the ball is set to `handNow * handAtGrip⁻¹` applied to where the ball was,
 * which is the whole idea: the ball undergoes exactly the rotation your hand
 * has, in every axis at once. Not a gain on an angle, not an accumulation of
 * per-frame deltas, both of which drift away from the hand and were why it read
 * as proportional rather than aligned.
 *
 * There is no momentum. The ball holds still the instant you let go, because a
 * flywheel here fought the point of the gesture: the orientation you released
 * it at is the orientation you chose, and coasting past it on an estimated
 * angular velocity threw that away and read as the ball spasming.
 *
 * Because it is anchored rather than accumulated, losing tracking is harmless.
 * The anchor is simply retaken: the ball keeps the orientation it had and your
 * current hand pose becomes the new reference, so a dropout can neither jerk it
 * nor lose the turn. A short grace keeps the original anchor across the frame or
 * two the tracker usually drops, so an uninterrupted turn stays uninterrupted.
 */
export class RotationController {
  private gripHand: Quat | null = null;
  private gripBall: Quat = IDENTITY;
  private smoothedHand: Quat | null = null;
  private lastHandTime = -Infinity;

  reset(): void {
    runtime.spin = { ...IDENTITY };
    this.gripHand = null;
    this.gripBall = { ...IDENTITY };
    this.smoothedHand = null;
  }

  /** Drops the anchor so the next held frame takes a fresh one. */
  private release(): void {
    this.gripHand = null;
    this.smoothedHand = null;
  }

  update(input: RotationCommand): void {
    const { time, dt, hand } = input;

    if (!hand) {
      if (time - this.lastHandTime > ROTATION.regripGrace) this.release();
      return;
    }
    this.lastHandTime = time;

    // Landmark noise turns into orientation jitter, and a ball that shivers in
    // your hand reads as broken however accurate it is on average.
    const k = frameRateSafe(ROTATION.smoothing, dt);
    this.smoothedHand = this.smoothedHand ? slerp(this.smoothedHand, hand, k) : hand;

    if (!this.gripHand) {
      this.gripHand = this.smoothedHand;
      this.gripBall = { ...runtime.spin };
      return;
    }

    const moved = toAxisAngle(mul(this.smoothedHand, conj(this.gripHand)));
    // A hand re-acquired in a different pose arrives as an enormous rotation.
    // Re-anchoring there is free and correct; applying it would fling the ball.
    if (Math.hypot(moved.x, moved.y, moved.z) > ROTATION.maxGripRotation) {
      this.gripHand = this.smoothedHand;
      this.gripBall = { ...runtime.spin };
      return;
    }

    runtime.spin = normalize(mul(mul(this.smoothedHand, conj(this.gripHand)), this.gripBall));
  }
}

/** One camera loop, one ball, one orientation. */
export const rotationController = new RotationController();

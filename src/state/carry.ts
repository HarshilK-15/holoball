import { GESTURE, type Vec2 } from "./types";
import { runtime } from "./hologramStore";
import { separation } from "../vision/handGeometry";

export interface CarryInput {
  time: number;
  handCount: number;
  /** Smoothed, mirrored anchors: palm centres that slide to the fingers on a pinch. */
  anchors: (Vec2 | null)[];
  /** Smoothed, mirrored palm centres. Carrying rides these, not the anchors. */
  palms: (Vec2 | null)[];
  fists: boolean[];
  imageAspect: number;
}

const copy = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });

/**
 * Decides where the ball wants to be, given what your hands are doing.
 *
 *   follow   one hand has it and it tracks along
 *   carried  both fists have hold of it and it rides between them
 *   parked   you let go, so it stays put until a hand comes back for it
 *
 * The timers are the whole point. Fist detection flickers, hands drop out of
 * frame for a frame or two, and a hand hovering at the edge of the pickup
 * radius would otherwise make the ball twitch between parked and follow.
 * Every transition has to hold for a beat before it counts.
 */
export class CarryController {
  private grabSince: number | null = null;
  private releaseSince: number | null = null;
  private pickupSince: number | null = null;
  private lostSince: number | null = null;
  private nearestDistance = Infinity;

  /** Distance from the parked ball to the closest hand, for the HUD. */
  get reach(): number {
    return Number.isFinite(this.nearestDistance) ? this.nearestDistance : 0;
  }

  /** Called when the ball is summoned: it starts in your hands, as before. */
  reset(position: Vec2): void {
    runtime.carry = "follow";
    runtime.followHand = null;
    runtime.parkedPosition = copy(position);
    this.grabSince = null;
    this.releaseSince = null;
    this.pickupSince = null;
    this.lostSince = null;
    this.nearestDistance = Infinity;
  }

  /** Radius grows with the ball, so a big one is easier to reach for. */
  private pickupRadius(): number {
    return GESTURE.pickupRadius + runtime.currentScale * GESTURE.pickupRadiusPerScale;
  }

  private nearest(points: (Vec2 | null)[], to: Vec2, imageAspect: number): number | null {
    let best: number | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (!p) continue;
      const d = separation(p, to, imageAspect);
      if (d < bestDistance) {
        bestDistance = d;
        best = i;
      }
    }
    this.nearestDistance = bestDistance;
    return best;
  }

  private park(at: Vec2): void {
    runtime.carry = "parked";
    runtime.parkedPosition = copy(at);
    runtime.followHand = null;
    this.grabSince = null;
    this.releaseSince = null;
    this.pickupSince = null;
    this.lostSince = null;
  }

  /** Returns the ball's target position for this frame. */
  update(input: CarryInput): Vec2 {
    const { time, handCount, anchors, palms, fists, imageAspect } = input;
    const bothFisted = handCount >= 2 && fists[0] === true && fists[1] === true;

    if (bothFisted) {
      this.grabSince ??= time;
    } else {
      this.grabSince = null;
    }
    const grabHeld = this.grabSince !== null && time - this.grabSince >= GESTURE.grabDwell;

    if (runtime.carry === "carried") {
      if (bothFisted && palms[0] && palms[1]) {
        this.releaseSince = null;
        return { x: (palms[0].x + palms[1].x) / 2, y: (palms[0].y + palms[1].y) / 2 };
      }
      // Opening a hand or losing one is a release, but only once it sticks.
      this.releaseSince ??= time;
      if (time - this.releaseSince >= GESTURE.releaseGrace) {
        this.park(runtime.currentPosition);
        return copy(runtime.parkedPosition);
      }
      return copy(runtime.targetPosition);
    }

    if (runtime.carry === "parked") {
      const parked = runtime.parkedPosition;
      const radius = this.pickupRadius();

      if (grabHeld && palms[0] && palms[1]) {
        const mid = { x: (palms[0].x + palms[1].x) / 2, y: (palms[0].y + palms[1].y) / 2 };
        if (separation(mid, parked, imageAspect) < radius * 1.6) {
          runtime.carry = "carried";
          this.releaseSince = null;
          return mid;
        }
      }

      const near = this.nearest(anchors, parked, imageAspect);
      if (near !== null && this.nearestDistance < radius) {
        this.pickupSince ??= time;
        if (time - this.pickupSince >= GESTURE.pickupDwell) {
          runtime.carry = "follow";
          runtime.followHand = near;
          this.lostSince = null;
          this.pickupSince = null;
          return copy(anchors[near]!);
        }
      } else {
        this.pickupSince = null;
      }
      return copy(parked);
    }

    // follow
    if (grabHeld && palms[0] && palms[1]) {
      runtime.carry = "carried";
      runtime.followHand = null;
      this.releaseSince = null;
      this.lostSince = null;
      return { x: (palms[0].x + palms[1].x) / 2, y: (palms[0].y + palms[1].y) / 2 };
    }

    if (handCount === 0) {
      this.lostSince ??= time;
      if (time - this.lostSince >= GESTURE.carryLostGrace) {
        this.park(runtime.currentPosition);
        return copy(runtime.parkedPosition);
      }
      return copy(runtime.targetPosition);
    }
    this.lostSince = null;

    // Two open hands steer from the midpoint, which is how the ball has always
    // behaved and is steadier than picking one of two hands that keep swapping
    // places in the sorted order.
    if (handCount >= 2 && anchors[0] && anchors[1]) {
      runtime.followHand = null;
      return { x: (anchors[0].x + anchors[1].x) / 2, y: (anchors[0].y + anchors[1].y) / 2 };
    }

    const single = anchors[0] ?? anchors[1];
    if (!single) return copy(runtime.targetPosition);
    runtime.followHand = anchors[0] ? 0 : 1;
    return copy(single);
  }
}

/** One camera loop, one carry state. The state machine resets it on summon. */
export const carryController = new CarryController();

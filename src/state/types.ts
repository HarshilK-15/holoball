import type { Quat } from "./orientation";

export type HologramMode = "hidden" | "spawning" | "active" | "trapped";

/**
 * How the ball is currently bound to your hands.
 * `follow`  the ball tracks one hand
 * `carried` both fists have hold of it and it rides between them
 * `parked`  it was released and sits still until a hand reaches for it
 */
export type CarryState = "follow" | "carried" | "parked";

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * High-frequency fields written by the camera loop and read by the render loop.
 * Deliberately kept out of the Zustand store: at 60fps these would either cause
 * a React re-render storm or be read stale.
 */
export interface RuntimeState {
  imageAspect: number;
  currentPosition: Vec2;
  targetPosition: Vec2;
  currentScale: number;
  targetScale: number;
  powerMode: number;
  lastHandMidpoint: Vec2;
  modeStart: number;
  trapStartScale: number;
  /** Where the ball sat when the trap began, so it can be flung to the hands. */
  trapStartPosition: Vec2;
  /** Where the palms actually met. The collapse plays here, not at a stale target. */
  trapPoint: Vec2;
  /** Palm-to-palm direction at contact, so the squash flattens along the clap. */
  trapAxis: Vec2;
  carry: CarryState;
  parkedPosition: Vec2;
  followHand: number | null;
  /** Ball orientation, applied to the body group. */
  spin: Quat;
}

export const TIMING = {
  spawnDuration: 0.4,
  trapDuration: 0.3,
  /** Fraction of the trap spent flying into the hands before the collapse. */
  trapRushFraction: 0.4,
} as const;

/**
 * Per-frame easing rates, expressed as "fraction of the remaining gap closed
 * in one frame at 60fps". They are converted to be frame-rate independent at
 * use, so a 30fps machine tracks at the same speed rather than half of it.
 */
export const FOLLOW = {
  position: 0.42,
  scale: 0.28,
} as const;

export const GESTURE = {
  palmSmoothing: 0.6,
  /**
   * Fingertips jitter more than palm centres, so the anchor is smoothed a
   * little harder than the palm it blends out of.
   */
  anchorSmoothing: 0.55,
  pinchSmoothing: 0.45,

  /** Pinch distance that reads as fully pinched, for the fingertip anchor. */
  pinchAnchorTight: 0.1,
  /** Pinch distance at which the anchor has returned entirely to the palm. */
  pinchAnchorOpen: 0.22,

  /** Separate from the anchor thresholds so size mapping stays as tuned. */
  pinchMinDistance: 0.05,
  pinchMaxDistance: 0.32,
  scaleBase: 0.5,
  scaleRange: 2.6,

  powerRamp: 0.15,
  smoothingJumpCutoff: 0.8,

  /** Reach radius for picking a parked ball back up, before the scale term. */
  pickupRadius: 0.1,
  pickupRadiusPerScale: 0.055,
  /** Hold inside the radius this long before latching, so it cannot flicker. */
  pickupDwell: 0.12,
  /** Both fists held this long before the ball is considered carried. */
  grabDwell: 0.08,
  /** Hands must stay open this long to count as a release, not a tracking blip. */
  releaseGrace: 0.12,
  /** Losing the followed hand for longer than this parks the ball. */
  carryLostGrace: 0.4,
} as const;

/**
 * Clap thresholds come in two sets. Without a trained model the geometric pass
 * is the only thing standing between you and a false dismiss, so it runs tight.
 * Once the classifier is loaded it supplies the precision, and the geometric
 * pass is free to widen out and stop missing real claps.
 */
const CLAP_BASE = {
  openThreshold: 0.55,
  closeThreshold: 0.42,
  debounce: 0.45,
  /** Fire once contact is this close in time, rather than waiting for arrival. */
  timeToContact: 0.06,
  /** Closing speed is measured across this span, not one noisy frame. */
  speedWindow: 0.1,
  /** Consecutive clean two-hand frames required before velocity is trusted. */
  minStableFrames: 3,
} as const;

export const CLAP_TIGHT = {
  ...CLAP_BASE,
  minClosingVelocity: 0.7,
  fastClosingVelocity: 2.0,
  dropWindow: 0.18,
  dropClosingVelocity: 2.0,
} as const;

export const CLAP_LOOSE = {
  ...CLAP_BASE,
  minClosingVelocity: 0.45,
  fastClosingVelocity: 1.4,
  dropWindow: 0.3,
  dropClosingVelocity: 1.2,
} as const;

/**
 * The shape both tuning sets share. Declared with `number` rather than as
 * `typeof CLAP_TIGHT`, which pinned every field to CLAP_TIGHT's exact literal
 * (`minClosingVelocity: 0.7`) and so made CLAP_LOOSE unassignable to it. These
 * are tunable values, not constants, and the type should say so.
 */
export interface ClapTuning {
  openThreshold: number;
  closeThreshold: number;
  debounce: number;
  timeToContact: number;
  speedWindow: number;
  minStableFrames: number;
  minClosingVelocity: number;
  fastClosingVelocity: number;
  dropWindow: number;
  dropClosingVelocity: number;
}

/**
 * Thresholds for the recorder's approach detector, which exists because
 * recording and playing need opposite things from a detector.
 *
 * Live, a false clap costs you the ball, so `CLAP_TIGHT` optimises for
 * precision and stays silent when unsure. While recording, silence is the
 * failure: a near miss is *defined* as hands that approach and do not clap, so
 * the clap detector is guaranteed never to propose one, and a clap it declines
 * is exactly the example the model most needs to see. Recording therefore wants
 * recall, and asks a human for the label.
 *
 * Nothing here is an absolute distance. The previous thresholds were absolute,
 * ported from a different coordinate space, and never matched this camera or
 * these hands. Everything below is a ratio against the widest opening actually
 * observed, so the detector calibrates itself to how far apart you really hold
 * your hands.
 */
export const APPROACH = {
  /** Closing to this fraction of the widest recent opening starts an approach. */
  closeRatio: 0.6,
  /** Under this, the widest opening is tracker noise rather than held-apart hands. */
  minOpenSpread: 0.18,
  /** An approach must cover at least this much ground to be a gesture at all. */
  minTravel: 0.12,
  /** Hands moving back apart by this much ends the approach and fires. */
  reboundMargin: 0.05,
  /**
   * The widest opening is the highest spread seen over this many seconds.
   *
   * This was a decay rate, which was wrong: it shrank the remembered opening
   * while the hands were still closing, so a slow approach could never satisfy
   * `closeRatio` against it and no near miss under way for longer than about a
   * second would ever fire. A window forgets stale openings without eroding the
   * one the current approach started from.
   */
  openWindow: 2.0,
  /** Closing speed is measured over this span, matching the clap detector. */
  speedWindow: 0.1,
  /** Below this duration it is a tracking glitch, not an approach. */
  minApproachTime: 0.08,
  /** Hands resting this long at their closest point fire without needing a rebound. */
  holdTime: 0.25,
  /** Losing a hand within this long of the last clean pair reads as palms merging. */
  mergeWindow: 0.2,
  /** Two hands gone this long abandons the approach and restarts calibration. */
  loseTimeout: 0.5,
  debounce: 0.5,
} as const;

/**
 * Rotational dynamics: the ball copies your hand.
 *
 * Pinch to take hold and the ball takes on your hand's own 3D orientation,
 * every axis at once, one to one. Pronate and it rolls, tilt and it tilts, turn
 * and it turns.
 *
 * The previous version read a single in-plane angle off flat image
 * coordinates, which is blind to pronation, the palm rolling about the forearm
 * and the exact motion the gesture is made of. No gain or threshold could fix
 * that, because the signal was not there. MediaPipe returns metric 3D
 * landmarks on every frame and always has; the orientation is built from those.
 *
 * There is no `rollGain` any more. A multiplier is what makes a rotation
 * proportional to your hand rather than aligned with it, and alignment is the
 * point. There is no momentum either: the orientation you let go at is the one
 * you chose, and coasting past it on an estimated angular velocity threw that
 * away and read as the ball spasming.
 */
export const ROTATION = {
  /** Pinch strength that takes hold of the ball. */
  gripEnter: 0.3,
  /**
   * Pinch strength below which it is let go. Far below `gripEnter` on purpose:
   * turning your hand changes how the thumb and finger project, so the measured
   * pinch moves while you twist even though your fingers have not.
   */
  gripExit: 0.12,
  /**
   * Fraction of the way to the hand's live orientation per frame at 60fps.
   * Landmark noise becomes orientation jitter, and a ball shivering in your
   * hand reads as broken however accurate it is on average.
   */
  smoothing: 0.55,
  /** A grip may lapse this long without giving up its anchor. */
  regripGrace: 0.2,
  /**
   * Rotation from the anchor pose beyond which the anchor is retaken instead of
   * applied. A hand re-acquired in a different pose arrives as an enormous
   * rotation; re-anchoring is free, applying it would fling the ball.
   */
  maxGripRotation: 2.6,
} as const;

/**
 * Summon: hold a fist, then open your hand.
 *
 * A clap could not be made to work. Two hands are reported only 6.6% of the
 * time while they are touching, so the moment that carries the gesture's
 * meaning is the moment the tracker goes blind. One hand is reported 93.8% of
 * the time, and curl is the steadiest signal in the feature set.
 *
 * This never contends with power mode. `charging` is evaluated only inside the
 * active-mode block, so a fist means nothing at all while the ball is hidden,
 * which is the only time this detector runs.
 */
export const BLOOM = {
  /** A fist must be held this long before opening it counts as a summon. */
  armDwell: 0.15,
  /** Curl at or below this is an open hand. Open hands measured at most 0.30. */
  openCurl: 0.25,
  /** Curl at or above this is a closed hand, for the openness ramp. */
  closedCurl: 0.5,
  /**
   * Curl of a fully splayed hand. The summon fires at `openCurl`, so a ramp
   * that ended there would already read 1.0 on the firing frame and the bloom
   * would have nowhere left to travel. This is what the animation ramps toward
   * instead, so opening further than the trigger demands pushes the bloom ahead
   * of its clock rather than being clipped away.
   */
  splayCurl: 0.0,
  /** The hand must finish opening this soon after leaving the fist. */
  releaseWindow: 0.5,
  /** A hand may blink out this long without losing a held fist. */
  loseTimeout: 0.3,
  /** No summon for this long after a dismiss, so it cannot bounce back. */
  debounce: 0.6,
} as const;

/**
 * Dismiss: bring two open palms together around the ball, without touching.
 *
 * Tuned by sweep against the 288 recorded clips, scoring every deliberate
 * converge as a dismiss (both claps and near misses, since both should now
 * dismiss) and every wave, rest and other gesture as a miss. These values catch
 * 79.5% of deliberate converges with zero false fires across all 142 negatives,
 * and fire around 133ms before the closest approach.
 *
 * `minClosingSpeed` is the one carrying safety margin rather than measured
 * need: no recorded negative comes close to it, but two open hands steering the
 * ball can drift together slowly, and that drift must never dismiss.
 */
export const SQUASH = {
  /** Closing to this fraction of the widest recent opening starts a converge. */
  closeRatio: 0.8,
  /** Under this, the widest opening is tracker noise rather than held-apart hands. */
  minOpenSpread: 0.15,
  /** A converge must cover at least this much ground to be a gesture at all. */
  minTravel: 0.12,
  /** Below this the hands are drifting while steering, not squashing. */
  minClosingSpeed: 0.5,
  /** The widest opening is the highest spread seen over this many seconds. */
  openWindow: 2.0,
  /** Closing speed is measured over this span, not one noisy frame. */
  speedWindow: 0.1,
  /** Drifting back out to this fraction of the opening abandons the converge. */
  reopenRatio: 0.95,
  /** Two hands gone this long abandons the converge and restarts calibration. */
  loseTimeout: 0.5,
  debounce: 0.6,
} as const;

/**
 * The single definition of the classifier's input shape. The recorder, the
 * inference path and the exported clips all read from here, and the clip files
 * carry a copy so `train.py` can never drift out of sync with the browser.
 */
export const CLASSIFIER = {
  window: 32,
  /** Frames captured after a candidate so a clip holds the clap's tail too. */
  postRoll: 12,
  /** Ring buffer length. Needs headroom over `window` for the post-roll. */
  bufferFrames: 48,
  features: ["spread", "closingVelocity", "pinch", "curl", "curlB", "handCount"] as const,
  confidenceThreshold: 0.55,
} as const;

/** MediaPipe's fixed 21-point hand topology. */
export const LM = {
  wrist: 0,
  thumbTip: 4,
  indexMCP: 5,
  indexTip: 8,
  middleMCP: 9,
  middleTip: 12,
  ringMCP: 13,
  ringTip: 16,
  littleMCP: 17,
  littleTip: 20,
} as const;

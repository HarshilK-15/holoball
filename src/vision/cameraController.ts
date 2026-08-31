import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { BLOOM, CLAP_TIGHT, CLASSIFIER, GESTURE, ROTATION, type Vec2 } from "../state/types";
import { runtime, useHologramStore } from "../state/hologramStore";
import { handOrientation, type Vec3 } from "../state/orientation";
import { triggerDismiss, triggerSummon } from "../state/stateMachine";
import { carryController } from "../state/carry";
import { rotationController } from "../state/rotation";
import { ClapDetector } from "./clapDetector";
import { ApproachDetector, type ApproachEvent } from "./approachDetector";
import { BloomDetector } from "./bloomDetector";
import { SquashDetector } from "./squashDetector";
import {
  fistCurlScore,
  handAnchor,
  isFist,
  isSnap,
  palmCenter,
  pinchDistance,
  pinchStrength,
  pinchToScale,
  smooth,
  smoothScalar,
  type Hand,
} from "./handGeometry";
import type { FeatureFrame } from "./gestureClassifier";

export type { FeatureFrame } from "./gestureClassifier";

/**
 * What a capture was fired by, in a shape both detectors can produce, so the
 * recorder does not care which one is driving it.
 */
export interface CaptureInfo {
  time: number;
  reason: string;
  /** Peak closing speed on the way in. */
  closingSpeed: number;
  /** How close the palms came. Near zero is a contact, larger is a near miss. */
  minSpread: number;
}

export interface CameraControllerOptions {
  /** Off in the recorder, so collecting clips never drives the live ball. */
  emitTriggers?: boolean;
  /**
   * Which detector proposes captures.
   *
   * `clap` is the live path: only confirmed claps. `approach` is the recorder
   * path: any two-hand convergence, clap or not. The recorder must use
   * `approach`, because a near miss is one the clap detector is designed to
   * reject and so could never be captured by it.
   */
  captureTrigger?: "clap" | "approach";
  /** Fires once the post-roll after a candidate has been captured. */
  onCandidate?: (window: FeatureFrame[], info: CaptureInfo) => void;
}

export class CameraController {
  private detector = new ClapDetector();
  private approach = new ApproachDetector();
  private bloom = new BloomDetector();
  private squash = new SquashDetector();
  private smoothedPalms: (Vec2 | null)[] = [null, null];
  private smoothedAnchors: (Vec2 | null)[] = [null, null];
  private smoothedPinch: number | null = null;
  private featureBuffer: FeatureFrame[] = [];
  private frameTimes: number[] = [];
  private stableFrames = 0;
  private lastFrameTime: number | null = null;
  private gripped = false;
  private pending: { left: number; info: CaptureInfo } | null = null;

  constructor(
    private landmarker: HandLandmarker,
    private video: HTMLVideoElement,
    private options: CameraControllerOptions = {},
  ) {
    this.detector.setTuning(CLAP_TIGHT);
  }

  /** Mirrored preview means landmark x must be flipped to match what the user sees. */
  private mirrorX(v: Vec2): Vec2 {
    return { x: 1 - v.x, y: v.y };
  }

  getFeatureBuffer(): FeatureFrame[] {
    return this.featureBuffer;
  }

  /** The trailing window in the exact shape the classifier and trainer expect. */
  snapshotWindow(): FeatureFrame[] {
    return this.featureBuffer.slice(-CLASSIFIER.window).map((f) => ({ ...f }));
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
    const aspect = runtime.imageAspect;

    const result = this.landmarker.detectForVideo(this.video, nowMs);
    const hands = (result.landmarks ?? []) as Hand[];
    const world = (result.worldLandmarks ?? []) as Vec3[][];

    // Sort by x so left/right slots stay stable; tracking order is not
    // guaranteed. The order is taken over indices rather than the array itself
    // so the metric landmarks stay paired with the hand they belong to.
    const order = hands
      .map((_, i) => i)
      .sort((a, b) => palmCenter(hands[a]).x - palmCenter(hands[b]).x);
    const sorted = order.map((i) => hands[i]);
    const worldSorted = order.map((i) => world[i]);
    const handCount = sorted.length;

    const fists: boolean[] = [];
    const curls: number[] = [];
    const palms: (Vec2 | null)[] = [null, null];
    const anchors: (Vec2 | null)[] = [null, null];
    let snapped = false;

    for (let i = 0; i < Math.min(handCount, 2); i++) {
      const hand = sorted[i];
      const fisted = isFist(hand, aspect);
      fists[i] = fisted;
      curls[i] = fistCurlScore(hand, aspect);

      const rawPalm = this.mirrorX(palmCenter(hand));
      if (isSnap(this.smoothedPalms[i], rawPalm)) snapped = true;
      this.smoothedPalms[i] = smooth(this.smoothedPalms[i], rawPalm, GESTURE.palmSmoothing);
      palms[i] = this.smoothedPalms[i];

      const rawAnchor = this.mirrorX(handAnchor(hand, aspect, fisted));
      this.smoothedAnchors[i] = smooth(
        this.smoothedAnchors[i],
        rawAnchor,
        GESTURE.anchorSmoothing,
      );
      anchors[i] = this.smoothedAnchors[i];
    }
    for (let i = handCount; i < 2; i++) {
      this.smoothedPalms[i] = null;
      this.smoothedAnchors[i] = null;
    }

    // A hand that was lost and re-acquired somewhere else produces an enormous
    // apparent closing speed. Counting clean frames lets the detector ignore
    // velocity until the tracking has settled again.
    if (handCount >= 2 && !snapped) this.stableFrames += 1;
    else this.stableFrames = 0;

    const bothFisted = handCount >= 2 && fists[0] === true && fists[1] === true;

    // Measured unconditionally, and before the feature buffer is written.
    // This used to live inside the `mode === "active"` block below, which meant
    // the recorder never runs it at all: the recorder never enters `active`, so
    // every clip recorded so far carried a permanently zero `pinch` column and
    // the model would have trained against a dead feature.
    if (handCount >= 1) {
      const rawPinch = pinchDistance(sorted[0], aspect);
      this.smoothedPinch = smoothScalar(this.smoothedPinch, rawPinch, GESTURE.pinchSmoothing);
    }

    const candidate = this.detector.update({
      time: now,
      handCount,
      palmA: palms[0],
      palmB: palms[1],
      imageAspect: aspect,
      stableFrames: this.stableFrames,
      bothFisted,
    });

    this.featureBuffer.push({
      spread: this.detector.spread,
      closingVelocity: this.detector.closingSpeed,
      pinch: this.smoothedPinch ?? 0,
      curl: curls[0] ?? 0,
      curlB: curls[1] ?? 0,
      handCount: handCount / 2,
    });
    while (this.featureBuffer.length > CLASSIFIER.bufferFrames) this.featureBuffer.shift();

    // The recorder watches for any convergence, not just claps the live
    // detector would accept, so near misses and rejected claps are capturable.
    let approachEvent: ApproachEvent | null = null;
    if (this.options.captureTrigger === "approach") {
      approachEvent = this.approach.update({
        time: now,
        handCount,
        palmA: palms[0],
        palmB: palms[1],
        imageAspect: aspect,
      });
      store.patch({
        approachPhase: this.approach.state,
        approachOpen: this.approach.widestOpening,
        approachMin: this.approach.closestApproach,
        captureBlockReason: this.approach.blockReason,
      });
    }

    // Clips are captured a post-roll after the candidate so they contain the
    // approach, the contact and the tail. Recording only the lead-in is why the
    // old spacebar flow could not produce a usable dataset.
    if (this.pending) {
      this.pending.left -= 1;
      if (this.pending.left <= 0) {
        this.options.onCandidate?.(this.snapshotWindow(), this.pending.info);
        this.pending = null;
      }
    }

    const capture: CaptureInfo | null = approachEvent
      ? {
          time: approachEvent.time,
          reason: approachEvent.reason,
          closingSpeed: approachEvent.closingSpeed,
          minSpread: approachEvent.minSpread,
        }
      : candidate && this.options.captureTrigger !== "approach"
        ? {
            time: candidate.time,
            reason: candidate.reason,
            closingSpeed: candidate.closingSpeed,
            minSpread: this.detector.spread,
          }
        : null;

    if (capture) {
      store.patch({
        candidateCount: store.candidateCount + 1,
        lastCandidateReason: capture.reason,
      });
      if (this.options.onCandidate && !this.pending) {
        this.pending = { left: CLASSIFIER.postRoll, info: capture };
      }
    }

    // Computed before the triggers rather than after, so a summon this frame
    // spawns the ball where your hand is now instead of where it was last frame.
    if (handCount >= 1) {
      const mid =
        handCount >= 2 && anchors[0] && anchors[1]
          ? { x: (anchors[0].x + anchors[1].x) / 2, y: (anchors[0].y + anchors[1].y) / 2 }
          : (anchors[0] ?? anchors[1])!;
      runtime.lastHandMidpoint = mid;
    }

    // Reported for the HUD only. The bloom is timed rather than driven from
    // this, but seeing how open the tracker thinks your hand is remains the
    // fastest way to tell a missed summon from a mis-tracked one.
    const openness =
      handCount >= 1
        ? Math.max(
            0,
            Math.min(
              1,
              (BLOOM.closedCurl - (curls[0] ?? 0)) / (BLOOM.closedCurl - BLOOM.splayCurl),
            ),
          )
        : 0;

    // Live triggers. Each runs only in the mode where its gesture means
    // anything, which is also what keeps the summon's fist clear of power mode:
    // by the time a fist means power, the bloom detector has stopped running.
    if (this.options.emitTriggers !== false) {
      if (store.mode === "hidden") {
        const bloomEvent = this.bloom.update({
          time: now,
          handCount,
          fisted: fists[0] === true,
          curl: curls[0] ?? 0,
        });
        if (bloomEvent) {
          triggerSummon(bloomEvent, runtime.lastHandMidpoint);
          this.squash.suppress(now);
        }
        store.patch({
          bloomArmed: this.bloom.isArmed,
          armed: this.bloom.isArmed,
          triggerBlockReason: this.bloom.blockReason,
        });
      } else if (store.mode === "active") {
        const squashEvent = this.squash.update({
          time: now,
          handCount,
          palmA: palms[0],
          palmB: palms[1],
          imageAspect: aspect,
          bothFisted,
        });
        if (squashEvent) {
          triggerDismiss(squashEvent);
          this.bloom.suppress(now);
        }
        store.patch({
          bloomArmed: false,
          armed: this.squash.isClosing,
          triggerBlockReason: this.squash.blockReason,
        });
      } else {
        // Mid spawn or mid collapse: neither gesture is listening, and leaving
        // the pulse lit from the previous mode would say otherwise.
        store.patch({ bloomArmed: false, armed: false, triggerBlockReason: store.mode });
      }
    }

    if (store.mode === "active") {
      runtime.targetPosition = carryController.update({
        time: now,
        handCount,
        anchors,
        palms,
        fists,
        imageAspect: aspect,
      });

      // Charging is single-hand now. Two fists means you have hold of the ball,
      // and reading that as a charge would light it up every time you carried it.
      const charging = handCount === 1 && fists[0] === true;
      if (charging) {
        runtime.powerMode += (1 - runtime.powerMode) * GESTURE.powerRamp;
      } else {
        runtime.powerMode += (0 - runtime.powerMode) * GESTURE.powerRamp;
      }

      // Rotation. One hand, pinched, and the ball takes that hand's own 3D
      // orientation rather than an angle inferred from flat image coordinates.
      //
      // Three things must be true before a pinch counts as having hold of it,
      // and the first two exist because leaving them out made the ball spin
      // wildly during two gestures that have nothing to do with rotation:
      //
      //   not a fist   Curling the hand puts the thumb tip right beside the
      //                index tip, so a fist measures as a maximum pinch. Power
      //                mode therefore grabbed the ball and it rode the fist.
      //                `handAnchor` excludes fists for exactly this reason.
      //   one hand     `sorted` is ordered by palm x and re-sorted every frame,
      //                so with two hands up, crossing them swaps which hand
      //                slot 0 refers to and the orientation jumps to a
      //                different hand. Matching how `charging` is gated on a
      //                single hand keeps the source stable.
      //   not carried  Two fists are the carry grab. The release grace can
      //                leave that state with one hand still up.
      //
      // The grip also has separate take-hold and let-go thresholds. Turning
      // your hand changes how the thumb and finger project, so the measured
      // pinch moves while you twist even though your fingers have not; against
      // a single threshold that flickers, and each flicker cost the anchor.
      const grip = this.smoothedPinch === null ? 0 : pinchStrength(this.smoothedPinch);
      const mayGrip = handCount === 1 && fists[0] !== true && runtime.carry !== "carried";
      this.gripped =
        mayGrip && (this.gripped ? grip >= ROTATION.gripExit : grip >= ROTATION.gripEnter);

      rotationController.update({
        time: now,
        dt: this.lastFrameTime === null ? 1 / 60 : now - this.lastFrameTime,
        hand: this.gripped ? handOrientation(worldSorted[0]) : null,
      });

      // Pinch is always measured; it only drives the size when a hand is free
      // to pinch, rather than while charging or carrying.
      if (!charging && runtime.carry !== "carried" && this.smoothedPinch !== null) {
        runtime.targetScale = pinchToScale(this.smoothedPinch);
      }

      const label =
        runtime.carry === "carried"
          ? "CARRY"
          : runtime.carry === "parked"
            ? "PARKED"
            : charging
              ? "POWER"
              : "TRACK";
      store.patch({ gestureLabel: label, carry: runtime.carry });
    } else {
      this.gripped = false;
      rotationController.update({
        time: now,
        dt: this.lastFrameTime === null ? 1 / 60 : now - this.lastFrameTime,
        hand: null,
      });
      store.patch({ gestureLabel: handCount >= 2 ? "READY" : "IDLE" });
    }
    this.lastFrameTime = now;

    store.patch({
      handCount,
      curlReadout: openness,
      spreadReadout: this.detector.spread,
      closingReadout: this.detector.closingSpeed,
      reachReadout: runtime.carry === "parked" ? carryController.reach : 0,
      stableReadout: this.stableFrames,
      pinchReadout: this.smoothedPinch ?? 0,
      gripReadout: this.gripped,
      scaleReadout: runtime.currentScale,
      powerReadout: runtime.powerMode,
    });
  }
}

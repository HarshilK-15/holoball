import { TIMING, type HologramMode } from "./types";
import { runtime, useHologramStore } from "./hologramStore";
import { carryController } from "./carry";
import { rotationController } from "./rotation";
import type { BloomEvent } from "../vision/bloomDetector";
import type { SquashEvent } from "../vision/squashDetector";
import type { Vec2 } from "./types";

function enter(mode: HologramMode, now: number): void {
  runtime.modeStart = now;
  if (mode === "trapped") {
    runtime.trapStartScale = runtime.currentScale;
    runtime.trapStartPosition = { ...runtime.currentPosition };
  }
  useHologramStore.getState().setMode(mode);
}

/**
 * Summon, on one gesture.
 *
 * It used to take two claps, on the reasoning that one was too easy to trigger
 * by accident. That reasoning was sound for a detector that fired on stray
 * movement, but it multiplied a single attempt's odds by themselves, and with
 * the clap detector's measured 51.9% recall it made summoning a roughly one in
 * ten proposition. A held fist that then opens is deliberate enough on its own.
 */
export function triggerSummon(event: BloomEvent, at: Vec2): void {
  const store = useHologramStore.getState();
  if (store.mode !== "hidden") return;

  store.patch({ gestureCount: store.gestureCount + 1 });
  runtime.currentScale = 0;
  runtime.currentPosition = { ...at };
  runtime.targetPosition = { ...at };
  carryController.reset(at);
  rotationController.reset();
  store.patch({ carry: "follow" });
  enter("spawning", event.time);
}

/** Dismiss, on two palms converging around the ball. */
export function triggerDismiss(event: SquashEvent): void {
  const store = useHologramStore.getState();
  if (store.mode !== "active") return;

  store.patch({ gestureCount: store.gestureCount + 1 });
  // Snapshot where the palms were converging. Reading the live target instead
  // is what used to make the ball collapse off to one side, since by the time a
  // dismiss registers the tracker has often dropped a hand and left the target
  // frozen wherever it last saw them.
  runtime.trapPoint = { ...event.contact };
  runtime.trapAxis = { ...event.axis };
  enter("trapped", event.time);
}

/** Advances timed transitions. Called once per render frame. */
export function tickStateMachine(now: number): void {
  const store = useHologramStore.getState();

  if (store.mode === "spawning" && now - runtime.modeStart >= TIMING.spawnDuration) {
    enter("active", now);
  } else if (store.mode === "trapped" && now - runtime.modeStart >= TIMING.trapDuration) {
    runtime.powerMode = 0;
    enter("hidden", now);
  }
}

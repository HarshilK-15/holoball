import { TIMING, type HologramMode } from "./types";
import { runtime, useHologramStore } from "./hologramStore";

let pendingClapTime = -Infinity;

function enter(mode: HologramMode, now: number): void {
  runtime.modeStart = now;
  if (mode === "trapped") runtime.trapStartScale = runtime.currentScale;
  useHologramStore.getState().setMode(mode);
}

/**
 * Summon needs two claps because one is far too easy to trigger by accident.
 * Dismiss needs only one because the ball is already visible and intent is clear.
 */
export function triggerHandClap(now: number): void {
  const store = useHologramStore.getState();
  store.patch({ clapCount: store.clapCount + 1 });

  if (store.mode === "active") {
    enter("trapped", now);
    pendingClapTime = -Infinity;
    store.patch({ awaitingSecondClap: false });
    return;
  }

  if (store.mode !== "hidden") return;

  if (now - pendingClapTime <= TIMING.doubleClapWindow) {
    pendingClapTime = -Infinity;
    store.patch({ awaitingSecondClap: false });
    runtime.currentScale = 0.05;
    runtime.currentPosition = { ...runtime.lastHandMidpoint };
    runtime.targetPosition = { ...runtime.lastHandMidpoint };
    enter("spawning", now);
  } else {
    pendingClapTime = now;
    store.patch({ awaitingSecondClap: true });
  }
}

/** Advances timed transitions. Called once per render frame. */
export function tickStateMachine(now: number): void {
  const store = useHologramStore.getState();

  if (store.awaitingSecondClap && now - pendingClapTime > TIMING.doubleClapWindow) {
    pendingClapTime = -Infinity;
    store.patch({ awaitingSecondClap: false });
  }

  if (store.mode === "spawning" && now - runtime.modeStart >= TIMING.spawnDuration) {
    enter("active", now);
  } else if (store.mode === "trapped" && now - runtime.modeStart >= TIMING.trapDuration) {
    runtime.powerMode = 0;
    enter("hidden", now);
  }
}

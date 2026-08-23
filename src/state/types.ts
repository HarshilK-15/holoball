export type HologramMode = "hidden" | "spawning" | "active" | "trapped";

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
}

export const TIMING = {
  doubleClapWindow: 1.5,
  spawnDuration: 0.45,
  trapDuration: 0.42,
} as const;

export const GESTURE = {
  clapOpenThreshold: 0.55,
  clapCloseThreshold: 0.42,
  clapClosingVelocity: 2.0,
  clapDebounce: 0.32,
  palmSmoothing: 0.4,
  pinchSmoothing: 0.35,
  pinchMinDistance: 0.05,
  pinchMaxDistance: 0.32,
  scaleBase: 0.5,
  scaleRange: 2.6,
  powerRamp: 0.15,
  smoothingJumpCutoff: 0.8,
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

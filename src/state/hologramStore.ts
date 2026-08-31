import { create } from "zustand";
import type { CarryState, HologramMode, RuntimeState } from "./types";

interface HudState {
  mode: HologramMode;
  carry: CarryState;
  handCount: number;
  fps: number;
  /** Fist held and ready: opening the hand now summons. */
  bloomArmed: boolean;
  /** Bloom armed, or two palms currently converging. Drives the HUD pulse. */
  armed: boolean;
  /** Summons plus dismisses, replacing the old clap tally. */
  gestureCount: number;
  spreadReadout: number;
  closingReadout: number;
  reachReadout: number;
  stableReadout: number;
  /** Candidates the geometric pass proposed, before any classifier check. */
  candidateCount: number;
  lastCandidateReason: string;
  /** 0..1 openness of hand 0, the summon signal. */
  curlReadout: number;
  /** Why the live path is not summoning or dismissing right now. */
  triggerBlockReason: string;
  /** Recorder-only: approach detector phase, "idle" or "closing". */
  approachPhase: string;
  /** Widest opening the approach detector has calibrated against. */
  approachOpen: number;
  /** Closest the palms came during the current or last approach. */
  approachMin: number;
  /** Why the recorder did not capture on this frame. */
  captureBlockReason: string;
  pinchReadout: number;
  /** True while a pinch has hold of the ball and is turning it. */
  gripReadout: boolean;
  scaleReadout: number;
  powerReadout: number;
  gestureLabel: string;
  cameraError: string | null;
  setMode: (mode: HologramMode) => void;
  patch: (partial: Partial<HudState>) => void;
}

export const useHologramStore = create<HudState>((set) => ({
  mode: "hidden",
  carry: "follow",
  handCount: 0,
  fps: 0,
  bloomArmed: false,
  armed: false,
  gestureCount: 0,
  spreadReadout: 0,
  closingReadout: 0,
  reachReadout: 0,
  stableReadout: 0,
  candidateCount: 0,
  lastCandidateReason: "none",
  curlReadout: 0,
  triggerBlockReason: "show one hand",
  approachPhase: "idle",
  approachOpen: 0,
  approachMin: 0,
  captureBlockReason: "waiting for two hands",
  pinchReadout: 0,
  gripReadout: false,
  scaleReadout: 1,
  powerReadout: 0,
  gestureLabel: "IDLE",
  cameraError: null,
  setMode: (mode) => set({ mode }),
  patch: (partial) => set(partial),
}));

/**
 * Written by the camera loop, read by the render loop, both at frame rate.
 * Kept out of the store on purpose. See REQUIREMENTS.md section 4.
 */
export const runtime: RuntimeState = {
  imageAspect: 16 / 9,
  currentPosition: { x: 0, y: 0 },
  targetPosition: { x: 0, y: 0 },
  currentScale: 1,
  targetScale: 1,
  powerMode: 0,
  lastHandMidpoint: { x: 0, y: 0 },
  modeStart: 0,
  trapStartScale: 1,
  trapStartPosition: { x: 0.5, y: 0.5 },
  trapPoint: { x: 0.5, y: 0.5 },
  trapAxis: { x: 1, y: 0 },
  carry: "follow",
  parkedPosition: { x: 0.5, y: 0.5 },
  followHand: null,
  spin: { x: 0, y: 0, z: 0, w: 1 },
};

import { create } from "zustand";
import type { HologramMode, RuntimeState } from "./types";

interface HudState {
  mode: HologramMode;
  handCount: number;
  fps: number;
  awaitingSecondClap: boolean;
  armed: boolean;
  clapCount: number;
  spreadReadout: number;
  pinchReadout: number;
  scaleReadout: number;
  powerReadout: number;
  gestureLabel: string;
  cameraError: string | null;
  setMode: (mode: HologramMode) => void;
  patch: (partial: Partial<HudState>) => void;
}

export const useHologramStore = create<HudState>((set) => ({
  mode: "hidden",
  handCount: 0,
  fps: 0,
  awaitingSecondClap: false,
  armed: false,
  clapCount: 0,
  spreadReadout: 0,
  pinchReadout: 0,
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
};

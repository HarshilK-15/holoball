import type * as TF from "@tensorflow/tfjs";
import { CLASSIFIER } from "../state/types";

const MODEL_URL = "/models/clap-classifier/model.json";

/**
 * One frame of the engineered signals the classifier sees. Raw landmark
 * sequences are a poor fit for a few hundred training clips, so the model is
 * fed the same signals the geometric detector already computes rather than
 * being asked to rediscover them.
 *
 * `curlB` and `handCount` were added after two fists became the carry grab:
 * the model has to be able to tell a grab from a clap, and a hand dropping out
 * of frame at contact is itself one of the strongest clap signals there is.
 */
export interface FeatureFrame {
  spread: number;
  closingVelocity: number;
  pinch: number;
  curl: number;
  curlB: number;
  handCount: number;
}

export const EMPTY_FRAME: FeatureFrame = {
  spread: 0,
  closingVelocity: 0,
  pinch: 0,
  curl: 0,
  curlB: 0,
  handCount: 0,
};

let tf: typeof TF | null = null;
let model: TF.LayersModel | null = null;
let loadAttempted = false;

/**
 * Optional by design. Until clips are recorded and a model is trained and
 * exported, the geometric detector runs unassisted. TensorFlow itself is
 * imported lazily so its ~1.5MB never lands in the startup path.
 */
export async function loadClassifier(): Promise<void> {
  if (loadAttempted) return;
  loadAttempted = true;
  try {
    const head = await fetch(MODEL_URL, { method: "HEAD" });
    if (!head.ok) return;
    tf = await import("@tensorflow/tfjs");
    model = await tf.loadLayersModel(MODEL_URL);
  } catch {
    model = null;
  }
}

export function isClassifierReady(): boolean {
  return model !== null;
}

export function frameToRow(f: FeatureFrame): number[] {
  return CLASSIFIER.features.map((name) => f[name]);
}

/** Pads at the front and takes the trailing window, matching train.py exactly. */
export function featuresToVector(buffer: FeatureFrame[]): number[] {
  const padded = [...buffer];
  while (padded.length < CLASSIFIER.window) padded.unshift(EMPTY_FRAME);
  return padded.slice(-CLASSIFIER.window).flatMap(frameToRow);
}

export interface ClapVerdict {
  confirmed: boolean;
  /** -1 when no model is loaded, so the HUD can say so rather than show a fake 0. */
  confidence: number;
}

/** Runs only on clap candidates, never every frame, to protect the frame budget. */
export function classifyClap(buffer: FeatureFrame[]): ClapVerdict {
  if (!model || !tf) return { confirmed: true, confidence: -1 };
  const input = tf.tensor2d([featuresToVector(buffer)]);
  const output = model.predict(input) as TF.Tensor;
  const confidence = output.dataSync()[0];
  input.dispose();
  output.dispose();
  return { confirmed: confidence >= CLASSIFIER.confidenceThreshold, confidence };
}

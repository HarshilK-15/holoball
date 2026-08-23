import type * as TF from "@tensorflow/tfjs";
import type { FeatureFrame } from "./cameraController";

const MODEL_URL = "/models/clap-classifier/model.json";
const CONFIDENCE_THRESHOLD = 0.6;
const WINDOW = 20;

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

export function featuresToVector(buffer: FeatureFrame[]): number[] {
  const padded = [...buffer];
  while (padded.length < WINDOW) {
    padded.unshift({ spread: 0, closingVelocity: 0, pinch: 0, curl: 0 });
  }
  return padded
    .slice(-WINDOW)
    .flatMap((f) => [f.spread, f.closingVelocity, f.pinch, f.curl]);
}

/** Runs only on clap candidates, never every frame, to protect the frame budget. */
export function classifyClap(buffer: FeatureFrame[]): boolean {
  if (!model || !tf) return true;
  const input = tf.tensor2d([featuresToVector(buffer)]);
  const output = model.predict(input) as TF.Tensor;
  const confidence = output.dataSync()[0];
  input.dispose();
  output.dispose();
  return confidence >= CONFIDENCE_THRESHOLD;
}

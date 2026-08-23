import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

// Self hosted rather than pulled from a CDN. A CDN URL has to be pinned to the
// exact installed package version, and getting that wrong breaks WASM startup
// in a way that looks like a camera failure.
const WASM_PATH = "/wasm";
const MODEL_PATH = "/models/hand_landmarker.task";

export async function createHandLandmarker(): Promise<HandLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  try {
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  } catch {
    // Safari's GPU delegate is unreliable, fall back rather than fail outright.
    return await HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }
}

/** Turns the browser's terse permission errors into something actionable. */
export function describeCameraError(err: unknown): string {
  if (!(err instanceof Error)) return "Could not start the camera.";
  switch (err.name) {
    case "NotAllowedError":
      return "Camera permission was blocked. Allow it in your browser's site settings, then reload.";
    case "NotFoundError":
      return "No camera was found on this machine.";
    case "NotReadableError":
      return "The camera is already in use by another app. Close it and reload.";
    case "OverconstrainedError":
      return "This camera does not support the requested resolution.";
    case "AbortError":
      return "The camera could not be taken over. Close any other app using it, such as Zoom, FaceTime or Photo Booth, then press start again.";
    case "SecurityError":
      return "The browser blocked camera access here. Use localhost or an https address.";
    default:
      return err.message || "Could not start the camera.";
  }
}

/**
 * Must be called from a user gesture. Safari rejects getUserMedia with
 * AbortError when it runs on page load without one, and separately refuses to
 * play the video element. Chrome is lenient about both, which is why this only
 * showed up in Safari.
 */
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      "This browser will not share a camera over an insecure connection. Use localhost or https.",
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (err) {
    // Safari sometimes rejects the ideal resolution outright rather than
    // negotiating down. Retry once with no constraints before giving up.
    if (err instanceof Error && (err.name === "OverconstrainedError" || err.name === "AbortError")) {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    } else {
      throw err;
    }
  }

  video.srcObject = stream;
  await video.play();
}

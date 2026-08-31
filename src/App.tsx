import { useCallback, useEffect, useRef, useState } from "react";
import { useHologramStore } from "./state/hologramStore";
import {
  createHandLandmarker,
  describeCameraError,
  startCamera,
} from "./vision/handLandmarker";
import { CameraController } from "./vision/cameraController";
import { HologramScene } from "./three/hologramScene";
import { HUDOverlay } from "./hud/HUDOverlay";
import { StartGate, type GateStatus } from "./hud/StartGate";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HologramScene | null>(null);
  const rafRef = useRef(0);
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<GateStatus>("idle");
  const handoffRef = useRef(0);
  const patch = useHologramStore((s) => s.patch);

  // Safari rejects getUserMedia with AbortError unless it runs inside a user
  // gesture, so this is deliberately click driven rather than an effect.
  const begin = useCallback(async () => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    setStatus("busy");
    patch({ cameraError: null });

    try {
      await startCamera(video);
    } catch (err) {
      patch({ cameraError: describeCameraError(err) });
      setStatus("idle");
      return;
    }

    let landmarker;
    try {
      landmarker = await createHandLandmarker();
    } catch (err) {
      patch({
        cameraError: `Hand tracking failed to load. ${
          err instanceof Error ? err.message : "Unknown error."
        }`,
      });
      setStatus("idle");
      return;
    }

    const controller = new CameraController(landmarker, video);
    sceneRef.current = new HologramScene(canvas);
    sceneRef.current.start();

    const pump = (t: number) => {
      rafRef.current = requestAnimationFrame(pump);
      controller.processFrame(t);
    };
    rafRef.current = requestAnimationFrame(pump);

    // The gate confirms the camera came up before it hands over, rather than
    // swapping out mid-click. It is also what makes the button's success state
    // a real state rather than one that is styled but never reachable.
    setStatus("ready");
    handoffRef.current = window.setTimeout(() => setStarted(true), 260);
  }, [patch]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(handoffRef.current);
      sceneRef.current?.stop();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="stage">
      <video ref={videoRef} className="feed" playsInline muted />
      <canvas ref={canvasRef} className="ball" />
      {started ? <HUDOverlay /> : <StartGate onStart={begin} status={status} />}
    </div>
  );
}

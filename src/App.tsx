import { useEffect, useRef } from "react";
import { useHologramStore } from "./state/hologramStore";
import {
  createHandLandmarker,
  describeCameraError,
  startCamera,
} from "./vision/handLandmarker";
import { CameraController } from "./vision/cameraController";
import { loadClassifier } from "./vision/gestureClassifier";
import { HologramScene } from "./three/hologramScene";
import { HUDOverlay } from "./hud/HUDOverlay";

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const patch = useHologramStore((s) => s.patch);

  useEffect(() => {
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    let scene: HologramScene | null = null;
    let raf = 0;
    let cancelled = false;

    (async () => {
      // Kept as separate steps so the failure message names the real cause.
      // Lumping these together reports a model download failure as a camera
      // problem, which sends you looking in the wrong place.
      try {
        await startCamera(video);
      } catch (err) {
        patch({ cameraError: describeCameraError(err) });
        return;
      }
      if (cancelled) return;

      let landmarker;
      try {
        landmarker = await createHandLandmarker();
      } catch (err) {
        patch({
          cameraError: `Hand tracking failed to load. ${
            err instanceof Error ? err.message : "Unknown error."
          }`,
        });
        return;
      }
      if (cancelled) return;

      void loadClassifier();
      const controller = new CameraController(landmarker, video);
      scene = new HologramScene(canvas);
      scene.start();

      const pump = (t: number) => {
        raf = requestAnimationFrame(pump);
        controller.processFrame(t);
      };
      raf = requestAnimationFrame(pump);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      scene?.stop();
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [patch]);

  return (
    <div className="stage">
      <video ref={videoRef} className="feed" playsInline muted />
      <canvas ref={canvasRef} className="ball" />
      <HUDOverlay />
    </div>
  );
}

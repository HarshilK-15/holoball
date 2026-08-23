import { useEffect, useRef, useState } from "react";
import { createHandLandmarker, startCamera } from "../vision/handLandmarker";
import { CameraController } from "../vision/cameraController";

const LABELS = ["clap", "near_miss", "wave", "rest", "other_gesture"] as const;
type Label = (typeof LABELS)[number];

/**
 * Dataset collection for the clap classifier. Runs the exact same pipeline as
 * production on purpose: recording through a different path than inference is
 * the fastest way to build a model that trains well and fails live.
 *
 * Open with ?record in the URL. Press a number key to save the last window.
 */
export function RecordRoute() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<CameraController | null>(null);
  const [label, setLabel] = useState<Label>("clap");
  const [saved, setSaved] = useState<Record<string, number>>({});

  useEffect(() => {
    const video = videoRef.current!;
    let raf = 0;
    let cancelled = false;

    (async () => {
      await startCamera(video);
      const landmarker = await createHandLandmarker();
      if (cancelled) return;
      controllerRef.current = new CameraController(landmarker, video);
      const pump = (t: number) => {
        raf = requestAnimationFrame(pump);
        controllerRef.current?.processFrame(t);
      };
      raf = requestAnimationFrame(pump);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < LABELS.length) {
        setLabel(LABELS[idx]);
        return;
      }
      if (e.code !== "Space") return;
      e.preventDefault();
      const frames = controllerRef.current?.getFeatureBuffer() ?? [];
      if (frames.length === 0) return;

      const clip = { label, frames: [...frames], recordedAt: Date.now() };
      const blob = new Blob([JSON.stringify(clip)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${label}-${clip.recordedAt}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setSaved((s) => ({ ...s, [label]: (s[label] ?? 0) + 1 }));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [label]);

  return (
    <div className="stage">
      <video ref={videoRef} className="feed" playsInline muted />
      <div className="recorder">
        <p>
          Label: <strong>{label}</strong>. Press 1-5 to switch, space to save the
          last window.
        </p>
        <ul>
          {LABELS.map((l, i) => (
            <li key={l} data-active={l === label}>
              {i + 1}. {l}, {saved[l] ?? 0} saved
            </li>
          ))}
        </ul>
        <p>Files download to your browser's download folder. Move them into training/record_export/.</p>
      </div>
    </div>
  );
}

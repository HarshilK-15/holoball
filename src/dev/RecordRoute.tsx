import { useCallback, useEffect, useRef, useState } from "react";
import { createHandLandmarker, startCamera } from "../vision/handLandmarker";
import {
  CameraController,
  type CaptureInfo,
  type FeatureFrame,
} from "../vision/cameraController";
import { APPROACH, CLASSIFIER } from "../state/types";
import { useHologramStore } from "../state/hologramStore";

/**
 * Targets come from REQUIREMENTS.md section 9. Negatives outnumber positives.
 *
 * `auto` marks the two-hand classes, where the approach detector proposes the
 * capture and you only supply the label. The one-handed and static classes
 * never converge two palms, so nothing can propose them and they stay on the
 * spacebar. Auto-capturing those would just mislabel stray claps as waves.
 */
const LABELS = [
  { name: "clap", target: 80, auto: true },
  { name: "near_miss", target: 65, auto: true },
  { name: "wave", target: 50, auto: false },
  { name: "rest", target: 40, auto: false },
  { name: "other_gesture", target: 45, auto: true },
] as const;

type Label = (typeof LABELS)[number]["name"];

interface Clip {
  label: Label;
  frames: FeatureFrame[];
  /** "auto" clips were caught by the detector; "manual" ones you pressed space for. */
  source: "auto" | "manual";
  /** What tripped the capture, and how close the palms came. Kept for triage:
   *  a "clap" clip whose palms never closed is a mislabel worth finding. */
  reason?: string;
  minSpread?: number;
  recordedAt: number;
}

/**
 * Dataset collection for the clap classifier. Runs the exact same pipeline as
 * production on purpose: recording through a different path than inference is
 * the fastest way to build a model that trains well and fails live.
 *
 * Open with ?record in the URL.
 *
 * Captures happen automatically whenever the palms converge, tagged with
 * whichever label is currently selected. That is the only way to get the clap
 * itself into the clip: waiting for a keypress means the motion has already
 * scrolled out of the window by the time you react.
 *
 * The trigger is the approach detector, not the clap detector. Auto capture
 * used to run off the clap detector, which meant `near_miss` could never record
 * a single clip -- a near miss is exactly what that detector exists to reject --
 * and claps only recorded on the rare occasions its absolute thresholds lined
 * up with this camera. The approach detector asks the weaker question, so both
 * classes propose, and you supply the label.
 *
 * Space is still there for the classes no convergence can propose, like a wave
 * or resting hands, which the model needs just as much.
 */
/**
 * Live approach-detector numbers. Auto capture happens when the palms converge
 * and then stop converging, so this panel shows that state machine directly and
 * names whatever is currently standing in the way. `blocked` is the field to
 * read when a gesture did not capture: it says which condition failed rather
 * than leaving you to infer it from raw numbers.
 *
 * Nothing here is compared against an absolute distance. `widest` is calibrated
 * live from your own hands, and `closest` is measured against it.
 */
function Telemetry() {
  const s = useHologramStore();
  const peaks = useRef({ open: 0, closing: 0 });
  const [, bump] = useState(0);

  peaks.current.open = Math.max(peaks.current.open, s.approachOpen);
  peaks.current.closing = Math.max(peaks.current.closing, s.closingReadout);

  useEffect(() => {
    const id = setInterval(() => bump((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  const row = (k: string, v: string, note?: string) => (
    <li key={k} data-active={false}>
      {k}: <strong>{v}</strong>
      {note ? ` ${note}` : ""}
    </li>
  );

  const trigger = (s.approachOpen * APPROACH.closeRatio).toFixed(3);

  return (
    <>
      <p style={{ marginTop: "0.75rem" }}>
        Approach detector. Captures: <strong>{s.candidateCount}</strong> (last:{" "}
        {s.lastCandidateReason})
      </p>
      <ul>
        {row("hands", String(s.handCount))}
        {row("phase", s.approachPhase)}
        {row(
          "widest",
          `${s.approachOpen.toFixed(3)} / ${peaks.current.open.toFixed(3)}`,
          `(needs > ${APPROACH.minOpenSpread}, closes at ${trigger})`,
        )}
        {row("closest", s.approachMin.toFixed(3), `(travel needs ${APPROACH.minTravel})`)}
        {row("spread", s.spreadReadout.toFixed(3))}
        {row(
          "closing",
          `${s.closingReadout.toFixed(2)} / ${peaks.current.closing.toFixed(2)}`,
        )}
        {row("blocked", s.captureBlockReason)}
      </ul>
    </>
  );
}

export function RecordRoute() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<CameraController | null>(null);
  const labelRef = useRef<Label>("clap");
  const [label, setLabel] = useState<Label>("clap");
  const [clips, setClips] = useState<Clip[]>([]);
  const [flash, setFlash] = useState(false);
  const [status, setStatus] = useState("Starting camera");

  const addClip = useCallback(
    (frames: FeatureFrame[], source: "auto" | "manual", info?: CaptureInfo) => {
      if (frames.length === 0) return;
      setClips((c) => [
        ...c,
        {
          label: labelRef.current,
          frames,
          source,
          reason: info?.reason,
          minSpread: info?.minSpread,
          recordedAt: Date.now(),
        },
      ]);
      setFlash(true);
    },
    [],
  );

  /**
   * Auto captures are dropped for the labels that no convergence can produce.
   * Without this, selecting `rest` and then happening to bring your hands
   * together would file a clap under `rest` and quietly poison the dataset.
   */
  const onAuto = useCallback(
    (frames: FeatureFrame[], info: CaptureInfo) => {
      const spec = LABELS.find((l) => l.name === labelRef.current);
      if (!spec?.auto) return;
      addClip(frames, "auto", info);
    },
    [addClip],
  );

  useEffect(() => {
    labelRef.current = label;
  }, [label]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(false), 600);
    return () => clearTimeout(id);
  }, [flash, clips.length]);

  useEffect(() => {
    const video = videoRef.current!;
    let raf = 0;
    let cancelled = false;

    (async () => {
      try {
        await startCamera(video);
        const landmarker = await createHandLandmarker();
        if (cancelled) return;
        controllerRef.current = new CameraController(landmarker, video, {
          // The recorder must never drive the live ball, or collecting a
          // hundred claps would fight the state machine the whole way.
          emitTriggers: false,
          // Any convergence proposes, so near misses record too.
          captureTrigger: "approach",
          onCandidate: onAuto,
        });
        const pump = (t: number) => {
          raf = requestAnimationFrame(pump);
          controllerRef.current?.processFrame(t);
        };
        raf = requestAnimationFrame(pump);
        setStatus("Recording");
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Could not start the camera");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      const stream = video.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onAuto]);

  const exportAll = useCallback(() => {
    if (clips.length === 0) return;
    // Self describing: train.py reads the shape from the file rather than
    // keeping its own copy of the constants, so the two cannot drift apart.
    const payload = {
      window: CLASSIFIER.window,
      features: CLASSIFIER.features,
      exportedAt: Date.now(),
      clips,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `holoball-clips-${payload.exportedAt}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [clips]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < LABELS.length) {
        setLabel(LABELS[idx].name);
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        addClip(controllerRef.current?.snapshotWindow() ?? [], "manual");
        return;
      }
      if (e.code === "Backspace") {
        e.preventDefault();
        setClips((c) => c.slice(0, -1));
        return;
      }
      if (e.key === "e" || e.key === "E") exportAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addClip, exportAll]);

  const counts = clips.reduce<Record<string, number>>((acc, c) => {
    acc[c.label] = (acc[c.label] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="stage">
      <video ref={videoRef} className="feed" playsInline muted />
      <div className="recorder">
        <p>
          {status}. Label <strong>{label}</strong>
          {flash ? ", captured" : ""}
        </p>
        <ul>
          {LABELS.map((l, i) => (
            <li key={l.name} data-active={l.name === label}>
              {i + 1}. {l.name}, {counts[l.name] ?? 0} / {l.target}{" "}
              {l.auto ? "(auto)" : "(space)"}
            </li>
          ))}
        </ul>
        <Telemetry />
        <p>
          {LABELS.find((l) => l.name === label)?.auto
            ? "Auto: bring your palms together and release. The clip is captured on the way out and tagged with the label above, so a clap and a near miss both record."
            : "Manual: press Space to capture the last window. This label never fires automatically."}{" "}
          Backspace drops the last clip.
        </p>
        <p>
          <button type="button" onClick={exportAll}>
            Export {clips.length} clips (E)
          </button>{" "}
          into <code>training/record_export/</code>.
        </p>
      </div>
    </div>
  );
}

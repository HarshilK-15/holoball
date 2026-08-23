import { useHologramStore } from "../state/hologramStore";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./tokens.css";
import "./hud.css";
import "./startgate.css";

/**
 * The entry click. Exists because Safari will not hand over the camera unless
 * the request comes from a user gesture, but it earns its place either way by
 * telling you the gestures before the camera turns on.
 */
export function StartGate({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  const error = useHologramStore((s) => s.cameraError);

  return (
    <div className="gate">
      <div className="gate__panel">
        <h1 className="gate__wordmark">Holoball</h1>
        <p className="gate__lede">
          A hologram you summon with a clap and steer with your hands. Everything
          runs on your machine. Nothing is uploaded.
        </p>

        <dl className="gate__moves">
          <div className="gate__move">
            <dt>Clap twice</dt>
            <dd>Summon</dd>
          </div>
          <div className="gate__move">
            <dt>Open palm</dt>
            <dd>Steer</dd>
          </div>
          <div className="gate__move">
            <dt>Pinch</dt>
            <dd>Resize</dd>
          </div>
          <div className="gate__move">
            <dt>Fist</dt>
            <dd>Charge</dd>
          </div>
          <div className="gate__move">
            <dt>Clap once</dt>
            <dd>Dismiss</dd>
          </div>
        </dl>

        {error ? <p className="gate__error">{error}</p> : null}

        <button className="gate__start" onClick={onStart} disabled={busy} type="button">
          {busy ? "Starting" : error ? "Try again" : "Start"}
        </button>
        <p className="gate__note">Your browser will ask for camera permission.</p>
      </div>
    </div>
  );
}

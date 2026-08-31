import { useHologramStore } from "../state/hologramStore";
import "@fontsource/tomorrow/500.css";
import "@fontsource/tomorrow/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./tokens.css";
import "./hud.css";
import "./startgate.css";

export type GateStatus = "idle" | "busy" | "ready";

/**
 * The moves, as the app actually works today.
 *
 * This list said "Clap twice / Summon" and "Clap once / Dismiss" until the clap
 * was removed: two hands are only tracked 6.6% of the time while touching, so a
 * gesture that ends in contact is invisible to the tracker at the exact instant
 * it means something. Teaching a gesture the app no longer has is worse than
 * teaching none.
 */
const MOVES: [string, string][] = [
  ["Fist, then open", "Summon"],
  ["Move your hand", "Steer"],
  ["Pinch", "Resize"],
  ["Pinch and turn", "Rotate"],
  ["One fist", "Charge"],
  ["Two fists", "Carry"],
  ["Palms together", "Dismiss"],
];

/**
 * The entry click. Exists because Safari will not hand over the camera unless
 * the request comes from a user gesture, but it earns its place either way by
 * telling you the moves before the camera turns on.
 */
export function StartGate({ onStart, status }: { onStart: () => void; status: GateStatus }) {
  const error = useHologramStore((s) => s.cameraError);

  const state =
    status === "ready" ? "success" : status === "busy" ? "loading" : error ? "error" : "default";
  const label =
    status === "ready" ? "Camera live" : status === "busy" ? "Starting" : error ? "Try again" : "Start";

  return (
    <div className="gate">
      <div className="hud__bezel" aria-hidden="true" />

      <div className="gate__panel">
        <header className="gate__head">
          <h1 className="gate__wordmark">Holoball</h1>
          <p className="gate__sub">Gesture instrument</p>
        </header>

        <p className="gate__lede">
          A hologram you summon by opening your fist, then steer, scale and spin with
          your hands. Everything runs on your machine. Nothing is uploaded.
        </p>

        <dl className="gate__moves">
          {MOVES.map(([move, effect]) => (
            <div className="gate__move" key={move}>
              <dt>{move}</dt>
              <dd>{effect}</dd>
            </div>
          ))}
        </dl>

        {error ? (
          <p className="gate__error" role="alert">
            {error}
          </p>
        ) : null}

        <button
          className="gate__start"
          onClick={onStart}
          disabled={status !== "idle"}
          data-state={state}
          type="button"
        >
          <span className="gate__spinner" aria-hidden="true" />
          <span className="gate__label">{label}</span>
        </button>

        <p className="gate__note">Your browser will ask for camera permission.</p>
      </div>
    </div>
  );
}

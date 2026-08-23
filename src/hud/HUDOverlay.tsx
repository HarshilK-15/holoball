import { useEffect, useState } from "react";
import { useHologramStore } from "../state/hologramStore";
import { GESTURE } from "../state/types";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./tokens.css";
import "./hud.css";

function RegistrationMark({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  return (
    <svg
      className={`hud__reg hud__reg--${corner}`}
      viewBox="0 0 26 26"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
    >
      <circle cx="13" cy="13" r="5.5" />
      <path d="M13 0v7M13 19v7M0 13h7M19 13h7" />
    </svg>
  );
}

function Caliper({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="hud__caliper">
      <div className="hud__caliperhead">
        <span className="hud__key">{label}</span>
        <span className="hud__val hud__val--live">{value.toFixed(3)}</span>
      </div>
      <div className="hud__calipertrack">
        <div className="hud__caliperfill" style={{ inlineSize: `${pct}%` }} />
      </div>
    </div>
  );
}

const MODE_PROMPT: Record<string, string> = {
  hidden: "Clap twice to summon",
  spawning: "Materialising",
  active: "Move to steer, pinch to scale, fist to charge",
  trapped: "Collapsing",
};

export function HUDOverlay() {
  const s = useHologramStore();
  const [clock, setClock] = useState("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(
        [d.getHours(), d.getMinutes(), d.getSeconds()]
          .map((n) => String(n).padStart(2, "0"))
          .join(":"),
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (s.cameraError) {
    return (
      <div className="hud">
        <div className="hud__plate hud__error">
          <div className="hud__errortitle">Camera unavailable</div>
          <p className="hud__errorbody">{s.cameraError}</p>
        </div>
      </div>
    );
  }

  const prompt = s.awaitingSecondClap ? "Awaiting second clap" : MODE_PROMPT[s.mode];
  const armed = s.awaitingSecondClap || s.armed;

  return (
    <div className="hud">
      <RegistrationMark corner="tl" />
      <RegistrationMark corner="tr" />
      <RegistrationMark corner="bl" />
      <RegistrationMark corner="br" />

      <div className="hud__plate hud__title">
        <h1 className="hud__wordmark">Holoball</h1>
        <div className="hud__subtitle">Gesture instrument</div>
      </div>

      <div className="hud__plate hud__stamp">
        <div className="hud__clock">{clock}</div>
        <div className="hud__sheet">Local session</div>
      </div>

      <div className="hud__plate hud__status">
        <div className="hud__group">
          <div className="hud__grouphead">Status</div>
          <div className="hud__row">
            <span className="hud__key">Mode</span>
            <span className={`hud__val ${s.mode === "active" ? "hud__val--live" : ""}`}>
              {s.mode.toUpperCase()}
            </span>
          </div>
          <div className="hud__row">
            <span className="hud__key">Hands</span>
            <span className="hud__val">{String(s.handCount).padStart(2, "0")}</span>
          </div>
          <div className="hud__row">
            <span className="hud__key">Signal</span>
            <span className="hud__val">{s.gestureLabel}</span>
          </div>
          <div className="hud__row">
            <span className="hud__key">FPS</span>
            <span className="hud__val">{String(s.fps).padStart(2, "0")}</span>
          </div>
        </div>
      </div>

      <div className="hud__plate hud__telemetry">
        <div className="hud__group">
          <div className="hud__grouphead">Telemetry</div>
          <div className="hud__row">
            <span className="hud__key">Scale</span>
            <span className="hud__val">{s.scaleReadout.toFixed(3)}</span>
          </div>
          <div className="hud__row">
            <span className="hud__key">Power</span>
            <span className={`hud__val ${s.powerReadout > 0.05 ? "hud__val--power" : ""}`}>
              {s.powerReadout.toFixed(3)}
            </span>
          </div>
          <div className="hud__row">
            <span className="hud__key">Claps</span>
            <span className="hud__val">{String(s.clapCount).padStart(3, "0")}</span>
          </div>
        </div>
      </div>

      <div className="hud__plate hud__calipers">
        <Caliper label="Spread" value={s.spreadReadout} max={GESTURE.clapOpenThreshold * 2} />
        <Caliper label="Pinch" value={s.pinchReadout} max={GESTURE.pinchMaxDistance} />
      </div>

      <div className={`hud__prompt ${armed ? "hud__prompt--armed" : ""}`}>
        <span className={`hud__pip ${armed ? "hud__pip--pulse" : ""}`} />
        {prompt}
      </div>
    </div>
  );
}

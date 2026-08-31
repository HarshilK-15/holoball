import { useEffect, useState, type CSSProperties } from "react";
import { useHologramStore } from "../state/hologramStore";
import { GESTURE, SQUASH } from "../state/types";
import "@fontsource/tomorrow/500.css";
import "@fontsource/tomorrow/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "./tokens.css";
import "./hud.css";

/** Staggers the reveal by DOM order without a line of JS timing. */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

function Row({ label, value, tone }: { label: string; value: string; tone?: "live" | "power" }) {
  return (
    <div className="hud__row">
      <span className="hud__key">{label}</span>
      <span className={`hud__val${tone ? ` hud__val--${tone}` : ""}`}>{value}</span>
    </div>
  );
}

/**
 * A caliper, not a progress bar. The tick sits on a dimension line with end
 * stops, the way a measured span is drawn rather than the way a download is.
 */
function Caliper({ label, value, max }: { label: string; value: number; max: number }) {
  // Passed as a 0..1 ratio rather than a width, because the bar and its end
  // stop are driven by transforms. Animating inline-size would put a layout
  // pass on every frame of a readout that updates at camera rate.
  const fill = Math.max(0, Math.min(1, value / max));
  return (
    <div className="hud__caliper">
      <div className="hud__caliperhead">
        <span className="hud__key">{label}</span>
        <span className="hud__val">{value.toFixed(3)}</span>
      </div>
      <div className="hud__calipertrack" style={{ "--fill": fill } as CSSProperties} aria-hidden="true">
        <span className="hud__caliperfill" />
        <span className="hud__calipertick" />
      </div>
    </div>
  );
}

const MODE_PROMPT: Record<string, string> = {
  hidden: "Make a fist, then open your hand to summon",
  spawning: "Materialising",
  active: "Move to steer, pinch to scale, fist both hands to carry",
  trapped: "Collapsing",
};

const CARRY_PROMPT: Record<string, string> = {
  follow: "Pinch and turn one hand to spin it, fist to charge",
  carried: "Carrying — open a hand to set it down",
  parked: "Set down — reach for it to pick it up",
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
        <div className="hud__bezel hud__bezel--alert" aria-hidden="true" />
        <div className="hud__fault" role="alert">
          <p className="hud__faulthead">Camera unavailable</p>
          <p className="hud__faultbody">{s.cameraError}</p>
        </div>
      </div>
    );
  }

  const prompt = s.bloomArmed
    ? "Fist held — open your hand"
    : s.mode === "active"
      ? CARRY_PROMPT[s.carry]
      : MODE_PROMPT[s.mode];

  return (
    <div className="hud">
      <div className="hud__bezel" aria-hidden="true" />

      <header className="hud__topbar" style={step(0)}>
        <div className="hud__brand">
          <h1 className="hud__wordmark">Holoball</h1>
          <p className="hud__sub">Gesture instrument</p>
        </div>
        <div className="hud__meta">
          <span className="hud__clock">{clock}</span>
          <span className="hud__sub">Local session</span>
        </div>
      </header>

      <section className="hud__spine hud__spine--left" style={step(1)}>
        <h2 className="hud__spinehead">Status</h2>
        <Row
          label="Mode"
          value={s.mode.toUpperCase()}
          tone={s.mode === "active" ? "live" : undefined}
        />
        <Row label="Hands" value={String(s.handCount).padStart(2, "0")} />
        <Row label="Signal" value={s.gestureLabel} />
        <Row label="Rate" value={`${String(s.fps).padStart(2, "0")} FPS`} />
      </section>

      <section className="hud__spine hud__spine--right" style={step(2)}>
        <h2 className="hud__spinehead">Telemetry</h2>
        <Row label="Scale" value={s.scaleReadout.toFixed(2)} />
        <Row
          label="Power"
          value={s.powerReadout.toFixed(2)}
          tone={s.powerReadout > 0.05 ? "power" : undefined}
        />
        <Row
          label="Grip"
          value={s.gripReadout ? "HELD" : "—"}
          tone={s.gripReadout ? "live" : undefined}
        />
        <Row label="Events" value={String(s.gestureCount).padStart(3, "0")} />
        <Row label="Reach" value={s.carry === "parked" ? s.reachReadout.toFixed(2) : "—"} />
      </section>

      <p className={`hud__prompt${s.armed ? " hud__prompt--armed" : ""}`} style={step(3)}>
        <span className={`hud__pip${s.armed ? " hud__pip--pulse" : ""}`} aria-hidden="true" />
        {prompt}
      </p>

      <div className="hud__deck" style={step(4)}>
        <div className="hud__calipers">
          <Caliper label="Open" value={s.curlReadout} max={1} />
          <Caliper label="Spread" value={s.spreadReadout} max={1.2} />
          <Caliper
            label="Closing"
            value={Math.max(0, s.closingReadout)}
            max={SQUASH.minClosingSpeed * 4}
          />
          <Caliper label="Pinch" value={s.pinchReadout} max={GESTURE.pinchMaxDistance} />
        </div>
        <p className="hud__trigger">
          <span className="hud__key">Trigger</span>
          <span className="hud__val">{s.triggerBlockReason}</span>
        </p>
      </div>
    </div>
  );
}

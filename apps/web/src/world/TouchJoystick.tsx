import { useRef, useState } from "react";
import { CONTROL_PX, useControls } from "../controls";
import { t } from "../i18n";
import { input } from "./input";

const bottom = "bottom-[max(1.5rem,env(safe-area-inset-bottom))]";

/**
 * Controles táctiles: joystick para moverse y botón de saltar en el otro pulgar. Cada uno sigue
 * su propio dedo (eventos de puntero, no clics), así que se puede saltar mientras se camina.
 * Lado, tamaño y opacidad se cambian en Personalizar → Controles.
 */
export function TouchJoystick() {
  const c = useControls();
  const px = CONTROL_PX[c.size];
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [pressed, setPressed] = useState(false);
  const R = px.stick * 0.375;
  const left = c.hand === "left";

  const update = (e: React.PointerEvent) => {
    const rect = base.current!.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) {
      dx = (dx / len) * R;
      dy = (dy / len) * R;
    }
    setKnob({ x: dx, y: dy });
    input.move.x = dx / R;
    input.move.y = -dy / R;
  };

  const end = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    input.move.x = 0;
    input.move.y = 0;
  };

  return (
    <>
      <div
        ref={base}
        style={{ width: px.stick, height: px.stick, opacity: c.opacity }}
        className={`pointer-events-auto absolute ${bottom} ${left ? "left-6" : "right-6"} touch-none select-none rounded-full border border-cal/20 bg-noche/30 backdrop-blur-sm`}
        onPointerDown={(e) => {
          e.stopPropagation();
          pointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          update(e);
        }}
        onPointerMove={(e) => e.pointerId === pointer.current && update(e)}
        onPointerUp={(e) => e.pointerId === pointer.current && end()}
        onPointerCancel={(e) => e.pointerId === pointer.current && end()}
        aria-label={t("hud.joystick")}
      >
        <div
          className="absolute left-1/2 top-1/2 rounded-full border border-neon-suave/60 bg-neon/25"
          style={{ width: px.stick * 0.44, height: px.stick * 0.44, transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
        />
      </div>
      {c.jumpButton && (
        <button
          type="button"
          aria-label={t("tools.jump")}
          style={{ width: px.jump, height: px.jump, opacity: c.opacity, fontSize: px.jump * 0.38 }}
          className={`pointer-events-auto absolute ${bottom} ${left ? "right-6" : "left-6"} grid touch-none select-none place-items-center rounded-full border border-neon-suave/50 text-cal backdrop-blur-sm transition-transform ${pressed ? "scale-90 bg-neon/40" : "bg-neon/20"}`}
          // Al tocar (no al soltar): responde al instante y no espera a que el otro dedo suelte.
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            input.jump = true;
            setPressed(true);
          }}
          onPointerUp={() => setPressed(false)}
          onPointerCancel={() => setPressed(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span aria-hidden>⤒</span>
        </button>
      )}
    </>
  );
}

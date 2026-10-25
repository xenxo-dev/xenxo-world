import { useRef, useState } from "react";
import { t } from "../i18n";
import { input } from "./input";

/** Joystick virtual para móvil. Escribe en `input.move`; el giro se hace arrastrando en el resto de la pantalla. */
export function TouchJoystick() {
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const R = 48;

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
    <div
      ref={base}
      className="pointer-events-auto absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-6 h-32 w-32 touch-none rounded-full border border-cal/20 bg-noche/30 backdrop-blur-sm"
      onPointerDown={(e) => {
        e.stopPropagation();
        pointer.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => e.pointerId === pointer.current && update(e)}
      onPointerUp={end}
      onPointerCancel={end}
      aria-label={t("hud.joystick")}
    >
      <div
        className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full border border-terracota-claro/60 bg-terracota/40"
        style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }}
      />
    </div>
  );
}

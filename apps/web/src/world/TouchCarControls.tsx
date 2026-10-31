import { useEffect, useRef, useState } from "react";
import { CONTROL_PX, useControls } from "../controls";
import { t } from "../i18n";
import { input } from "./input";
import { BrakeIcon, GasIcon, HandbrakeIcon, SteerIcon } from "../hud/icons";

const bottom = "bottom-[max(1.5rem,env(safe-area-inset-bottom))]";

/**
 * Controles táctiles del coche (sustituyen al joystick mientras se conduce): un volante que se
 * desliza a los lados en el pulgar del joystick y, en el otro, acelerar, frenar (y marcha atrás
 * si ya está parado) y el freno de mano. Cada mando sigue su propio dedo, así que se puede girar y
 * acelerar a la vez. Lado, tamaño y opacidad salen de Personalizar → Controles, como el joystick.
 */
export function TouchCarControls() {
  const c = useControls();
  const px = CONTROL_PX[c.size];
  const left = c.hand === "left";
  // En pantallas estrechas, volante y pedales se encogen para no pisarse (cada uno, como mucho, un
  // 40 % y un 15 % del ancho).
  const W = Math.round(px.stick * 1.15);
  const H = Math.round(px.stick * 0.56);
  const [travel, setTravel] = useState((W - H) / 2);

  const track = useRef<HTMLDivElement>(null);
  const steerPointer = useRef<number | null>(null);
  const [knob, setKnob] = useState(0);
  const pedals = useRef({ gas: false, brake: false });
  const [pressed, setPressed] = useState({ gas: false, brake: false, hand: false });

  // Al bajarse del coche (o al cambiar de mando) no se queda nada pulsado.
  useEffect(
    () => () => {
      input.move.x = 0;
      input.move.y = 0;
      input.brake = false;
    },
    [],
  );

  const steer = (e: React.PointerEvent) => {
    const rect = track.current!.getBoundingClientRect();
    const reach = Math.max(1, (rect.width - rect.height) / 2);
    if (reach !== travel) setTravel(reach);
    const dx = Math.max(-reach, Math.min(reach, e.clientX - (rect.left + rect.width / 2)));
    setKnob(dx);
    input.move.x = dx / reach;
  };
  const steerEnd = () => {
    steerPointer.current = null;
    setKnob(0);
    input.move.x = 0;
  };

  const pedal = (which: "gas" | "brake", on: boolean) => {
    pedals.current[which] = on;
    // Con los dos pisados, manda el freno.
    input.move.y = pedals.current.brake ? -1 : pedals.current.gas ? 1 : 0;
    setPressed((p) => ({ ...p, [which]: on }));
  };
  const hand = (on: boolean) => {
    input.brake = on;
    setPressed((p) => ({ ...p, hand: on }));
  };

  // Pulsar al tocar (no al soltar) y seguir el mismo dedo hasta que se levante.
  const hold = (on: (v: boolean) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      on(true);
    },
    onPointerUp: () => on(false),
    onPointerCancel: () => on(false),
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const base = "pointer-events-auto grid touch-none select-none place-items-center border text-cal backdrop-blur-sm transition-transform";
  const pedalW = `min(${Math.round(px.jump * 0.8)}px, 15vw)`;
  const handW = `min(${Math.round(px.jump * 0.62)}px, 12vw)`;

  return (
    <>
      <div
        ref={track}
        role="slider"
        aria-label={t("car.steer")}
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round((knob / travel) * 100)}
        style={{ width: `min(${W}px, 40vw)`, height: H, opacity: c.opacity }}
        className={`pointer-events-auto absolute ${bottom} ${left ? "left-6" : "right-6"} touch-none select-none rounded-full border border-cal/20 bg-noche/30 backdrop-blur-sm`}
        onPointerDown={(e) => {
          e.stopPropagation();
          steerPointer.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          steer(e);
        }}
        onPointerMove={(e) => e.pointerId === steerPointer.current && steer(e)}
        onPointerUp={(e) => e.pointerId === steerPointer.current && steerEnd()}
        onPointerCancel={(e) => e.pointerId === steerPointer.current && steerEnd()}
      >
        <div
          className="absolute left-1/2 top-1/2 grid place-items-center rounded-full border border-neon-suave/60 bg-neon/25 text-cal [&>svg]:h-1/2 [&>svg]:w-1/2"
          style={{ width: H - 10, height: H - 10, transform: `translate(calc(-50% + ${knob}px), -50%) rotate(${(knob / travel) * 60}deg)` }}
        >
          <SteerIcon />
        </div>
      </div>

      <div
        className={`pointer-events-none absolute ${bottom} ${left ? "right-6 flex-row" : "left-6 flex-row-reverse"} flex items-end gap-2`}
        style={{ opacity: c.opacity }}
      >
        <button
          type="button"
          aria-label={t("car.handbrake")}
          style={{ width: handW, height: handW }}
          className={`${base} aspect-square rounded-full ${pressed.hand ? "scale-90 border-cal/60 bg-cal/25" : "border-cal/30 bg-noche/40"} [&>svg]:h-[45%] [&>svg]:w-[45%]`}
          {...hold(hand)}
        >
          <HandbrakeIcon />
        </button>
        <button
          type="button"
          aria-label={t("car.brake")}
          style={{ width: pedalW, height: Math.round(px.stick * 0.72) }}
          className={`${base} rounded-2xl ${pressed.brake ? "scale-95 border-rosa/70 bg-rosa/35" : "border-rosa/45 bg-rosa/15"} [&>svg]:h-8 [&>svg]:w-8`}
          {...hold((on) => pedal("brake", on))}
        >
          <BrakeIcon />
        </button>
        <button
          type="button"
          aria-label={t("car.gas")}
          style={{ width: pedalW, height: px.stick }}
          className={`${base} rounded-2xl ${pressed.gas ? "scale-95 border-neon-suave/80 bg-neon/40" : "border-neon-suave/50 bg-neon/20"} [&>svg]:h-8 [&>svg]:w-8`}
          {...hold((on) => pedal("gas", on))}
        >
          <GasIcon />
        </button>
      </div>
    </>
  );
}

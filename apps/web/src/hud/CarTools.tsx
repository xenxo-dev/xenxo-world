import { useEffect, useState } from "react";
import { t } from "../i18n";
import { usePlace } from "../net/world-store";
import { input } from "../world/input";
import { carSpeed, DISTRICT_CHUNKS, useDrive } from "../world/vehicle/drive-state";
import { CarIcon, hudIconButton } from "./icons";

/** Conducir o bajarse del coche (también con la tecla C). Solo en los distritos. */
export function CarButton({ touch }: { touch: boolean }) {
  const place = usePlace();
  const d = useDrive();
  if (!DISTRICT_CHUNKS.has(place)) return null;
  const label = t(d.on ? "car.exit" : d.phase === "parked" ? "car.enter" : "car.drive");
  return (
    <button
      title={touch ? label : `${label} (C)`}
      aria-label={label}
      aria-pressed={d.on}
      disabled={d.loading || (d.phase !== "none" && d.phase !== "parked" && !d.on)}
      onClick={() => (input.car = true)}
      className={hudIconButton}
    >
      <CarIcon />
    </button>
  );
}

/** Al volante: velocímetro (se lee 6 veces por segundo, sin tocar React cada frame). */
export function CarSpeed({ className }: { className: string }) {
  const d = useDrive();
  const [kmh, setKmh] = useState(0);
  useEffect(() => {
    if (!d.on) return;
    const id = setInterval(() => setKmh(Math.round(Math.abs(carSpeed()) * 3.6)), 160);
    return () => clearInterval(id);
  }, [d.on]);
  if (!d.on) return null;
  return (
    <p className={className} aria-live="off">
      <span className="display text-2xl text-cal">{kmh}</span>
      <span className="meta ml-1 text-xs text-cal/60">km/h</span>
    </p>
  );
}

/** Avisos cortos del coche (no cabe aquí, sacándolo…). */
export function CarNotice({ className }: { className: string }) {
  const d = useDrive();
  if (!d.notice) return null;
  return (
    <p role="status" className={className}>
      {t(d.notice)}
    </p>
  );
}

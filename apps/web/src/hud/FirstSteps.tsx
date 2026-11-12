/**
 * Primeros pasos (net/first-steps.ts): una lista pequeña, arriba a la izquierda, con lo primero que
 * hacer en xenxo. Plegada es una pastilla con lo que lleva («2/5»); abierta, los cinco pasos con su
 * marca. Al terminarlos, quien tiene cuenta se lleva la insignia (la da el servidor); quien no, ve
 * que con cuenta se la llevaría. Con su ✕ no vuelve a salir. Nada de esto va al servidor.
 */
import { useEffect, useState } from "react";
import { PLACES } from "@xenxo/protocol";
import { t, useLang, type Key } from "../i18n";
import { useAccount } from "../net/account";
import { FIRST_STEPS, firstSteps, useFirstSteps, type FirstStep } from "../net/first-steps";
import { usePlace } from "../net/world-store";
import { useDrive } from "../world/vehicle/drive-state";

const box = "rounded-2xl border border-cal/10 bg-noche/85 shadow-[0_18px_50px_-18px_rgb(0_0_0/0.8)] backdrop-blur";
/** Debajo de la fila de arriba y del botón de la guía, a la izquierda. */
const where = "pointer-events-auto absolute left-4 top-[calc(max(1rem,env(safe-area-inset-top))+6.1rem)]";

export function FirstSteps({ onSignup }: { onSignup: () => void }) {
  useLang();
  const chunk = usePlace();
  const user = useAccount();
  const s = useFirstSteps();
  const [open, setOpen] = useState(false);
  const d = useDrive();

  // Lo que se sabe sin esperar a nada: estar en un distrito (se ha cruzado una puerta) y tener cuenta.
  useEffect(() => {
    if (chunk && chunk !== PLACES.nexo && chunk !== PLACES.plaza) firstSteps.mark("door");
  }, [chunk]);
  useEffect(() => {
    if (user) firstSteps.mark("account");
  }, [user]);

  if (s.closed || (d.phase !== "none" && d.phase !== "parked")) return null;
  const done = (k: FirstStep) => s.done.includes(k);
  const count = FIRST_STEPS.filter(done).length;
  const all = count === FIRST_STEPS.length;

  if (!open)
    return (
      <button
        onClick={() => setOpen(true)}
        className={`${where} flex items-center gap-2 rounded-xl border border-cal/10 bg-noche/70 px-3 py-1.5 text-sm text-cal/80 backdrop-blur hover:text-cal`}
      >
        <span className={`h-2 w-2 rounded-full ${all ? "bg-huerta" : "bg-neon"}`} />
        {t("first.title")}
        <span className="meta text-xs text-cal/55">
          {count}/{FIRST_STEPS.length}
        </span>
      </button>
    );

  return (
    <section aria-label={t("first.title")} className={`${where} ${box} w-[min(19rem,calc(100vw-2rem))]`}>
      <header className="flex items-center justify-between gap-3 border-b border-cal/10 px-4 py-3">
        <h2 className="display text-[15px] font-semibold text-cal">
          {t("first.title")} <span className="meta ml-1 text-xs font-normal text-cal/55">{count}/{FIRST_STEPS.length}</span>
        </h2>
        <div className="flex items-center gap-1">
          <button onClick={() => setOpen(false)} aria-label={t("first.fold")} className="grid h-7 w-7 place-items-center rounded-lg text-cal/60 hover:bg-cal/10 hover:text-cal">
            –
          </button>
          <button onClick={() => firstSteps.close()} aria-label={t("first.close")} title={t("first.close")} className="grid h-7 w-7 place-items-center rounded-lg text-cal/60 hover:bg-cal/10 hover:text-cal">
            ✕
          </button>
        </div>
      </header>
      <ol className="space-y-2.5 px-4 py-3">
        {FIRST_STEPS.map((k) => (
          <li key={k} className="flex items-start gap-2.5">
            <span
              aria-hidden
              className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[10px] ${done(k) ? "border-huerta bg-huerta/25 text-lime-100" : "border-cal/30 text-transparent"}`}
            >
              ✓
            </span>
            <div className="min-w-0">
              <p className={`text-sm ${done(k) ? "text-cal/55 line-through decoration-cal/30" : "text-cal"}`}>{t(`first.${k}` as Key)}</p>
              {!done(k) && <p className="text-xs leading-snug text-soft">{t(`first.${k}.text` as Key)}</p>}
              {k === "account" && !done(k) && (
                <button onClick={onSignup} className="mt-1.5 text-xs text-neon hover:underline">
                  {t("first.account.go")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-t border-cal/10 px-4 py-2.5 text-xs leading-snug text-soft">{t(all ? (user ? "first.done" : "first.doneGuest") : user ? "first.badge" : "first.badgeGuest")}</p>
    </section>
  );
}

import { useEffect, useState } from "react";
import { loadPref, savePref } from "./config";
import { startSession } from "./net/session";
import { useWorldVersion, world } from "./net/world-store";
import { Panel } from "./panel/Panel";
import { TouchJoystick } from "./world/TouchJoystick";
import { World, xrStore } from "./world/World";

function randomName() {
  return `visitante-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function useVRSupported() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    navigator.xr?.isSessionSupported("immersive-vr").then(setOk).catch(() => setOk(false));
  }, []);
  return ok;
}

export function App() {
  const [inWorld, setInWorld] = useState(false);
  const [name, setNameState] = useState(() => loadPref("name", randomName()));
  const [quality, setQualityState] = useState<"low" | "high">(() =>
    loadPref("quality", matchMedia("(pointer: coarse)").matches ? "low" : "high"),
  );
  const vr = useVRSupported();
  const touch = matchMedia("(pointer: coarse)").matches;
  useWorldVersion();

  // La plaza se ve viva detrás del panel desde el primer segundo.
  useEffect(() => {
    void startSession(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setName = (n: string) => {
    setNameState(n);
    savePref("name", n);
  };
  const setQuality = (q: "low" | "high") => {
    setQualityState(q);
    savePref("quality", q);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0b0d1f] text-white">
      <World active={inWorld} quality={quality} />

      {!inWorld && (
        <Panel
          onEnter={() => setInWorld(true)}
          onEnterVR={vr ? () => void xrStore.enterVR() : null}
          name={name}
          setName={setName}
          quality={quality}
          setQuality={setQuality}
        />
      )}

      {inWorld && (
        <div className="pointer-events-none absolute inset-0">
          <div className="pointer-events-auto absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-3 rounded-xl border border-white/10 bg-[#11142b]/70 px-3 py-2 text-sm backdrop-blur">
            <button onClick={() => setInWorld(false)} className="text-white/80 hover:text-white" aria-label="Volver al panel">
              ← Panel
            </button>
            <span className="h-4 w-px bg-white/15" />
            <span className="flex items-center gap-1.5 text-white/70">
              <span className={`h-2 w-2 rounded-full ${world.status === "open" ? "bg-emerald-400" : "bg-amber-400"}`} />
              {world.status === "open" ? `${world.peers.size + 1} en la plaza` : "conectando…"}
            </span>
          </div>
          {vr && (
            <button
              onClick={() => void xrStore.enterVR()}
              className="pointer-events-auto absolute right-4 top-[max(1rem,env(safe-area-inset-top))] rounded-xl border border-cyan-300/30 bg-[#11142b]/70 px-3 py-2 text-sm text-cyan-200 backdrop-blur"
            >
              VR
            </button>
          )}
          {touch ? (
            <TouchJoystick />
          ) : (
            <p className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-[#11142b]/70 px-3 py-1.5 text-xs text-white/60">
              WASD para moverte · arrastra para mirar
            </p>
          )}
        </div>
      )}
    </div>
  );
}

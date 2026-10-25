import { lazy, Suspense, useEffect, useState } from "react";
import type { XRStore } from "@react-three/xr";
import { loadPref, savePref } from "./config";
import { Chat } from "./hud/Chat";
import { t, useLang } from "./i18n";
import { setGuestName as setSessionGuestName, startSession } from "./net/session";
import { useWorldVersion, world } from "./net/world-store";
import { Panel, type Section } from "./panel/Panel";
import { TouchJoystick } from "./world/TouchJoystick";

/**
 * La escena 3D (Three.js, WebXR, cargadores de modelos) se descarga aparte:
 * el panel aparece al instante y la plaza se monta detrás en cuanto llega.
 */
const worldModule = import("./world/World");
const World = lazy(() => worldModule.then((m) => ({ default: m.World })));

function randomName() {
  return `${t("guest")}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function useVRSupported() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    navigator.xr?.isSessionSupported("immersive-vr").then(setOk).catch(() => setOk(false));
  }, []);
  return ok;
}

/** La tienda XR existe cuando ha llegado el módulo 3D; hasta entonces no se ofrece la VR. */
function useXRStore() {
  const [store, setStore] = useState<XRStore | null>(null);
  useEffect(() => {
    let alive = true;
    worldModule.then((m) => alive && setStore(m.xrStore)).catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return store;
}

const hudBox = "rounded-xl border border-cal/10 bg-noche/70 backdrop-blur";

export function App() {
  const [inWorld, setInWorld] = useState(false);
  const [panelSection, setPanelSection] = useState<Section>("solutions");
  const [name, setNameState] = useState(() => loadPref("name", randomName()));
  const [quality, setQualityState] = useState<"low" | "high">(() =>
    loadPref("quality", matchMedia("(pointer: coarse)").matches ? "low" : "high"),
  );
  const vr = useVRSupported();
  const xrStore = useXRStore();
  const enterVR = vr && xrStore ? () => void xrStore.enterVR() : null;
  const touch = matchMedia("(pointer: coarse)").matches;
  useWorldVersion();
  useLang();

  // La plaza se ve viva detrás del panel desde el primer segundo.
  useEffect(() => {
    void startSession(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setName = (n: string) => {
    setNameState(n);
    savePref("name", n);
    setSessionGuestName(n);
  };
  const setQuality = (q: "low" | "high") => {
    setQualityState(q);
    savePref("quality", q);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-noche text-cal">
      <Suspense fallback={null}>
        <World active={inWorld} quality={quality} />
      </Suspense>

      {!inWorld && (
        <Panel
          section={panelSection}
          onSection={setPanelSection}
          onEnter={() => setInWorld(true)}
          onEnterVR={enterVR}
          guestName={name}
          setGuestName={setName}
          quality={quality}
          setQuality={setQuality}
        />
      )}

      {inWorld && (
        <div className="pointer-events-none absolute inset-0">
          <div className={`pointer-events-auto absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-3 px-3 py-2 text-sm ${hudBox}`}>
            <button onClick={() => setInWorld(false)} className="text-cal/80 hover:text-cal" aria-label={t("hud.backLabel")}>
              {t("hud.back")}
            </button>
            <span className="h-4 w-px bg-cal/15" />
            <span className="flex items-center gap-1.5 text-cal/70">
              <span className={`h-2 w-2 rounded-full ${world.status === "open" ? "bg-huerta" : "bg-ocre"}`} />
              {world.status === "open" ? t("hud.inPlaza", { n: world.peers.size + 1 }) : t("hud.connecting")}
            </span>
          </div>
          {enterVR && (
            <button
              onClick={enterVR}
              className={`pointer-events-auto absolute right-4 top-[max(1rem,env(safe-area-inset-top))] px-3 py-2 text-sm text-azulejo-claro ${hudBox}`}
            >
              VR
            </button>
          )}
          <Chat
            touch={touch}
            onSignup={() => {
              setPanelSection("customize");
              setInWorld(false);
            }}
          />
          {touch ? (
            <TouchJoystick />
          ) : (
            <p className={`absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 text-xs text-cal/70 ${hudBox}`}>
              {t("hud.desktopHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

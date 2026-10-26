import { lazy, Suspense, useEffect, useState } from "react";
import type { XRStore } from "@react-three/xr";
import { loadPref, savePref } from "./config";
import { Chat } from "./hud/Chat";
import { CONTROL_PX, useControls } from "./controls";
import { enterFullscreen } from "./fullscreen";
import { TopTools, ViewTools } from "./hud/CameraTools";
import { Emotes } from "./hud/Emotes";
import { People } from "./hud/People";
import { PortalCard, TravelToast } from "./hud/PortalCard";
import { errorText, placeName, t, useLang } from "./i18n";
import { setGuestName as setSessionGuestName, startSession, travel } from "./net/session";
import { completeGoogleReturn, refreshSession, useAccount } from "./net/account";
import { districtOf, parcelArrival, refreshDistricts } from "./net/districts";
import { useWorldVersion, world } from "./net/world-store";
import { Consent, pendingConsent } from "./panel/Consent";
import { Gate } from "./games/Gate";
import { Player as GamePlayer } from "./games/Player";
import { closeGame, openGame, useOpenGame } from "./games/state";
import { gameBySlug, gameRoute } from "./net/games";
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
  const [panelSection, setPanelSection] = useState<Section>("nexo");
  const [name, setNameState] = useState(() => loadPref("name", randomName()));
  const vr = useVRSupported();
  const xrStore = useXRStore();
  const enterVR = vr && xrStore ? () => void xrStore.enterVR() : null;
  const touch = matchMedia("(pointer: coarse)").matches;
  useWorldVersion();
  useLang();
  const user = useAccount();
  const controls = useControls();
  // Entrar al mundo es un gesto: si se pidió en Personalizar, a pantalla completa.
  const enterWorld = () => {
    if (controls.autoFullscreen) void enterFullscreen();
    setInWorld(true);
  };
  const game = useOpenGame();

  // La plaza se ve viva detrás del panel desde el primer segundo.
  // Vuelta de Google: termina el acceso y abre Personalizar con el resultado.
  const [authNotice, setAuthNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // «Entrar con xenxo»: un juego pide la identidad (?autorizar=… lo pone /oidc/authorize).
  const [consent, setConsent] = useState(() => {
    const q = new URLSearchParams(location.search);
    const request = q.get("autorizar") ?? pendingConsent();
    const error = q.get("autorizar_error");
    return request || error ? { request, error } : null;
  });
  useEffect(() => {
    void completeGoogleReturn().then((r) => {
      if (!r.returned) return void refreshSession();
      setPanelSection("account");
      if (r.error) setAuthNotice({ tone: "error", text: errorText({ code: r.error }) });
      else if (r.linked) setAuthNotice({ tone: "ok", text: t("account.googleLinkedOk") });
    });
  }, []);

  useEffect(() => {
    void startSession(name);
    // xenxo.io/j/<juego>: delante de su portal y con su aviso previo abierto.
    const slug = gameRoute(location.pathname);
    if (slug) {
      history.replaceState(history.state, "", `/${location.search}${location.hash}`);
      void gameBySlug(slug).then(async (p) => {
        if (!p) return setAuthNotice({ tone: "error", text: t("gate.notFound") });
        const districts = await refreshDistricts(true);
        const d = districts.find((x) => x.id === p.district);
        const parcel = d?.parcels.find((x) => x.project_id === p.id);
        if (d && parcel) {
          const a = parcelArrival(parcel);
          travel(d.chunk_id, a.p, a.yaw);
          setInWorld(true);
        }
        openGame(p);
      });
    }
    // Vuelta desde un juego (xenxo.back() del SDK): ?volver=<proyecto> → delante de su portal.
    const q = new URLSearchParams(location.search);
    const back = q.get("volver");
    if (back !== null) {
      q.delete("volver");
      history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`);
      if (/^[A-Za-z0-9_-]{4,40}$/.test(back)) {
        void refreshDistricts(true).then((districts) => {
          for (const d of districts) {
            const parcel = d.parcels.find((p) => p.project_id === back);
            if (!parcel || !districtOf(d.id)) continue;
            const a = parcelArrival(parcel);
            travel(d.chunk_id, a.p, a.yaw);
            setInWorld(true);
            return;
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setName = (n: string) => {
    setNameState(n);
    savePref("name", n);
    setSessionGuestName(n);
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-noche text-cal">
      <Suspense fallback={null}>
        <World active={inWorld && !game} paused={game?.stage === "play"} />
      </Suspense>

      {game?.stage === "gate" && game.project.game && (
        <Gate
          open={game}
          onSignIn={() => {
            closeGame();
            setPanelSection("account");
            setInWorld(false);
          }}
        />
      )}
      {game?.stage === "play" && <GamePlayer open={game} />}

      {consent && <Consent request={consent.request} error={consent.error} onClose={() => setConsent(null)} />}

      {!inWorld && (
        <Panel
          section={panelSection}
          onSection={setPanelSection}
          onEnter={enterWorld}
          onEnterVR={enterVR}
          guestName={name}
          setGuestName={setName}
          authNotice={authNotice}
        />
      )}

      {inWorld && (
        <div className="pointer-events-none absolute inset-0">
          <div className={`pointer-events-auto absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-3 px-3 py-2 text-sm ${hudBox}`}>
            <button onClick={() => setInWorld(false)} className="text-cal/80 hover:text-cal" aria-label={t("hud.backLabel")}>
              {t("hud.back")}
            </button>
            <span className="h-4 w-px bg-cal/15" />
            <People selfName={user?.display_name ?? name} selfNo={user?.player_no ?? null} />
          </div>
          <TopTools onVR={enterVR} />
          <Chat
            touch={touch}
            onSignup={() => {
              setPanelSection("account");
              setInWorld(false);
            }}
          />
          <PortalCard />
          <TravelToast />
          {/* Primera persona y gestos en una fila; en táctil, por encima del botón de saltar (o del
              joystick, si va a la derecha). */}
          <div
            className={`pointer-events-auto absolute flex gap-1.5 ${touch && controls.hand === "right" ? "left-4" : "right-4"} ${touch ? "" : "bottom-5"}`}
            style={touch ? { bottom: `calc(max(1.5rem, env(safe-area-inset-bottom)) + ${CONTROL_PX[controls.size].stick + 16}px)` } : undefined}
          >
            <ViewTools touch={touch} />
            {controls.showEmotes && (
              <div style={touch ? { opacity: controls.opacity } : undefined}>
                <Emotes />
              </div>
            )}
          </div>
          {touch ? (
            <TouchJoystick />
          ) : (
            <p className={`absolute bottom-5 left-1/2 -translate-x-1/2 px-3 py-1.5 text-center text-xs text-cal/70 ${hudBox}`}>
              {t("hud.desktopHint")}
              <span className="block text-cal/45">{t("hud.keys")}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

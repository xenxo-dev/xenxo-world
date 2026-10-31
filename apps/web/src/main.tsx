import "./zod-config";
import { splashDone, splashProgress } from "./splash";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { cardRoute } from "./net/card";
// Tipografías autoalojadas (sin CDN): Space Grotesk para titulares y carteles, Inter para el texto
// y IBM Plex Mono para los datos técnicos.
import "@fontsource-variable/inter";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

// xenxo.io/p/<n>: el carné público, sin cargar el mundo ni el panel.
const cardNo = cardRoute(location.pathname);
const App = lazy(() =>
  import("./App").then((m) => {
    splashProgress(0.3);
    return { default: m.App };
  }),
);
// El carné no monta el mundo: la pantalla de carga se va en cuanto llega su código.
const CardPage = lazy(() =>
  import("./card/CardPage").then((m) => {
    splashDone();
    return { default: m.CardPage };
  }),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>{cardNo === null ? <App /> : <CardPage no={cardNo} />}</Suspense>
  </StrictMode>,
);

// PWA: se puede instalar y abre sin red con la última copia. Solo en producción (en local, el
// servidor de desarrollo de Vite no se lleva bien con una caché delante).
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  });
}

import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { cardRoute } from "./net/card";
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo/wdth.css";
import "./index.css";

// xenxo.io/p/<n>: el carné público, sin cargar el mundo ni el panel.
const cardNo = cardRoute(location.pathname);
const App = lazy(() => import("./App").then((m) => ({ default: m.App })));
const CardPage = lazy(() => import("./card/CardPage").then((m) => ({ default: m.CardPage })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>{cardNo === null ? <App /> : <CardPage no={cardNo} />}</Suspense>
  </StrictMode>,
);

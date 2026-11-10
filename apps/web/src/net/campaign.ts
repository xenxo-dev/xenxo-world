/**
 * De qué enlace viene la visita: la etiqueta `?v=` que se pone en cada vídeo o publicación
 * (xenxo.io/d/vertical?v=tiktok-12). Sirve para contar, sumadas y sin identificar a nadie, cuántas
 * visitas trae cada enlace y cuántas acaban entrando, creando cuenta o publicando (el servidor solo
 * guarda totales por día: `stats` en directory.ts). No es un dato de la persona: es del enlace.
 *
 * Se recuerda mientras dure la pestaña (sobrevive a la ida y vuelta de «Entrar con Google») y se
 * quita de la barra de direcciones.
 */
const TAG = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const KEY = "xenxo:src";

function read(): string | null {
  try {
    const q = new URLSearchParams(location.search);
    const v = q.get("v")?.toLowerCase();
    if (v !== undefined) {
      q.delete("v");
      history.replaceState(history.state, "", `${location.pathname}${q.size ? `?${q}` : ""}${location.hash}`);
      if (TAG.test(v)) {
        sessionStorage.setItem(KEY, v);
        return v;
      }
    }
    const kept = sessionStorage.getItem(KEY);
    return kept && TAG.test(kept) ? kept : null;
  } catch {
    return null;
  }
}

const tag = read();

/** La etiqueta del enlace por el que se llegó (null: sin etiqueta). */
export function campaign(): string | null {
  return tag;
}

/** Añade la etiqueta a una URL de la API (`?src=`), si la hay. */
export function withCampaign(url: URL): URL {
  if (tag) url.searchParams.set("src", tag);
  return url;
}

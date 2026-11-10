/**
 * Rutas de la web que se pueden compartir. Todas sirven la misma aplicación; cambia adónde llevan:
 *
 *   /                        el panel
 *   /d/<distrito>            dentro de ese distrito (o /d/plaza)
 *   /d/<distrito>/<sitio>    en una de sus actividades (world/guide.ts)
 *   /j/<juego>               un juego (net/games.ts)
 *   /p/<número>              un carné de jugador (net/card.ts)
 *
 * Con /en delante, lo mismo en inglés para quien aún no ha elegido idioma. Cada ruta de distrito
 * tiene además su página con su vista previa para las redes (tools/share/build.mjs): por eso un
 * enlace a /d/vertical enseña Vertical al pegarlo en un chat, y no la portada.
 *
 * Sin dependencias: lo usa también i18n.ts al arrancar.
 */

/** ¿La ruta pide inglés? (/en o /en/…). */
export function pathLang(pathname: string = location.pathname): "en" | null {
  return pathname === "/en" || pathname.startsWith("/en/") ? "en" : null;
}

/** La ruta de la aplicación, sin el prefijo de idioma ("/en/d/vertical" → "/d/vertical"). */
export function appPath(pathname: string = location.pathname): string {
  return pathLang(pathname) ? pathname.slice(3) || "/" : pathname;
}

export interface PlaceRoute {
  district: string;
  spot: string | null;
}

/** /d/<distrito>[/<sitio>] → adónde lleva (los ids, en minúsculas y sin comprobar que existan). */
export function placeRoute(pathname: string = location.pathname): PlaceRoute | null {
  const m = appPath(pathname).match(/^\/d\/([a-z0-9_-]{2,32})(?:\/([a-z0-9_-]{2,32}))?\/?$/);
  return m ? { district: m[1]!, spot: m[2] ?? null } : null;
}

/** El enlace de un distrito (o de uno de sus sitios), en el idioma de quien lo comparte. */
export function placeLink(district: string, spot: string | null = null, lang: string = "es"): string {
  return `${location.origin}${lang === "en" ? "/en" : ""}/d/${district}${spot ? `/${spot}` : ""}`;
}

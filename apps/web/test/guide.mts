/**
 * Prueba de la llegada a los distritos, sin navegador: los sitios de «Qué hacer aquí»
 * (src/world/guide.json) existen, caen en un hueco libre de la ciudad de verdad
 * (district-cities.json y lo que ponen las actividades) y tienen sus textos en los dos idiomas; los
 * enlaces /d/<distrito>/<sitio> llevan adonde dicen; y los navegadores integrados de las apps se
 * reconocen (net/inapp.ts).
 *
 *   npm run test:guide -w @xenxo/web
 *
 * Si la forja mueve una ciudad y un sitio queda dentro de algo, esto lo dice antes que un jugador.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import activities from "../../realtime/src/district-activities.json";
import cities from "../../realtime/src/district-cities.json";
import layout from "../../realtime/src/districts.json";
import raw from "../src/world/guide.json";
import { inAppBrowser, openInBrowserUrl } from "../src/net/inapp";
import { appPath, pathLang, placeRoute } from "../src/routes";
import { directPlace, guideOf, spotIds, spotOf, type GuideSpot } from "../src/world/guide";

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "  ✓" : "  ✗"} ${what}`);
  if (!ok) fails++;
};

type Box = [number, number, number, number, number, number];
const CITY = (cities as unknown as { cities: Record<string, number[][]> }).cities;
const ACTS = activities as unknown as Record<string, { props?: { p: number[]; half?: number[] }[] } | undefined>;
const [B0, B1] = (layout as unknown as { bounds: [number, number] }).bounds;

/** Las cajas del distrito: su ciudad (edificios, muebles, barandillas) y lo que colocan las actividades. */
function boxesOf(district: string): Box[] {
  const city = (CITY[district] ?? []).map((b) => b.slice(0, 6) as Box);
  const props = (ACTS[district]?.props ?? []).filter((p) => p.half && p.half.some((h) => h > 0)).map((p) => [p.p[0]!, p.p[1]! + p.half![1]!, p.p[2]!, p.half![0]!, p.half![1]!, p.half![2]!] as Box);
  return [...city, ...props];
}

/** ¿Cabe una persona de pie (0,35 m de radio, 1,7 m de alto) con los pies en ese punto? */
function blocked(boxes: Box[], s: GuideSpot): Box | null {
  const [x, y, z] = s.p;
  for (const b of boxes) {
    const [cx, cy, cz, hx, hy, hz] = b;
    if (y + 0.2 >= cy + hy || y + 1.7 <= cy - hy) continue;
    const dx = Math.max(0, Math.abs(x - cx) - hx);
    const dz = Math.max(0, Math.abs(z - cz) - hz);
    if (dx * dx + dz * dz < 0.35 * 0.35) return b;
  }
  return null;
}

/** En alto, ¿hay algo debajo que lo sostenga (el tejado, la rejilla del mirador)? */
function supported(boxes: Box[], s: GuideSpot): boolean {
  const [x, y, z] = s.p;
  if (y < 0.2) return true;
  return boxes.some(([cx, cy, cz, hx, hy, hz]) => Math.abs(x - cx) <= hx && Math.abs(z - cz) <= hz && Math.abs(cy + hy - y) < 0.4);
}

const i18n = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n.ts"), "utf8");
const cut = i18n.indexOf("} as const;");
const DICT = { es: i18n.slice(0, cut), en: i18n.slice(cut) };
const hasText = (key: string) => (["es", "en"] as const).every((l) => DICT[l].includes(`  ${JSON.stringify(key)}: "`));

console.log("Sitios de «Qué hacer aquí»");
const districts = Object.keys(raw).filter((k) => !k.startsWith("$"));
check(districts.length >= 5, `hay guía para ${districts.length} distritos`);
for (const id of districts) {
  const d = (layout.districts as { id: string; chunk: string; soon?: boolean }[]).find((x) => x.id === id);
  check(!!d && !d.soon, `${id}: existe y está abierto`);
  const entries = guideOf(id);
  const ids = spotIds(id);
  check(entries.length > 0 && new Set(ids).size === ids.length, `${id}: ${entries.length} filas, ${ids.length} sitios sin repetir`);
  check(ids.every((s) => /^[a-z0-9_-]{2,32}$/.test(s)), `${id}: los ids valen para un enlace`);
  check(entries.every((e) => e.spot || e.levels.length), `${id}: cada fila lleva a algún sitio`);
  check(entries.every((e) => hasText(`guide.${id}.${e.id}`) && hasText(`guide.${id}.${e.id}.text`)) && hasText(`guide.${id}.tip`), `${id}: textos en español e inglés`);
  const boxes = boxesOf(id);
  for (const sid of ids) {
    const s = spotOf(id, sid)!;
    const inside = s.p[0] > B0 + 2 && s.p[0] < B1 - 2 && s.p[2] > B0 + 2 && s.p[2] < B1 - 2;
    const hit = blocked(boxes, s);
    const ok = inside && !hit && supported(boxes, s) && Number.isFinite(s.yaw);
    check(ok, `${id}/${sid}: [${s.p.join(", ")}] libre${s.p[1] > 0.2 ? " y con suelo debajo" : ""}${hit ? ` — choca con la caja [${hit.map((v) => v.toFixed(1)).join(", ")}]` : ""}${inside ? "" : " — fuera del distrito"}`);
  }
}

console.log("Enlaces directos");
{
  check(appPath("/en/d/vertical") === "/d/vertical" && appPath("/en") === "/" && appPath("/d/cero") === "/d/cero", "el prefijo /en se quita de la ruta");
  check(pathLang("/en/d/x1") === "en" && pathLang("/en") === "en" && pathLang("/entrar") === null && pathLang("/") === null, "/en pide inglés (y /entrar no)");
  const r = placeRoute("/en/d/vertical/nivel3");
  check(r?.district === "vertical" && r.spot === "nivel3", "/en/d/vertical/nivel3 → Vertical, nivel 3");
  check(placeRoute("/d/cero/")?.district === "cero" && placeRoute("/d/cero/")?.spot === null, "/d/cero/ → Distrito Cero");
  check(placeRoute("/d/") === null && placeRoute("/p/4") === null && placeRoute("/d/a/b/c") === null && placeRoute("/d/Mal") === null, "lo que no es un distrito no cuela");
  const v = directPlace("vertical", "nivel1");
  const start = (activities as unknown as { vertical: { races: { id: string; start: { p: number[] } }[] } }).vertical.races.find((x) => x.id === "nivel1")!.start.p;
  check(!!v && v !== "soon" && v.chunk === "c_-1_1" && v.p.join() === start.join(), "…/vertical/nivel1 deja en la salida del nivel 1");
  const plain = directPlace("vertical", "no-existe");
  check(!!plain && plain !== "soon" && plain.p.join() === (layout.spawn as number[]).join(), "un sitio que no existe deja en la entrada del distrito");
  check(directPlace("agora", null) === "soon", "un distrito «próximamente» no se abre");
  const pl = directPlace("plaza", null);
  check(!!pl && pl !== "soon" && pl.chunk === "c_0_0", "/d/plaza lleva a la plaza");
  check(directPlace("inventado", null) === null, "uno que no es del sistema se pregunta al servidor");
}

console.log("Navegadores integrados");
{
  const ua = {
    instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 335.0.0.0.93 (iPhone15,2; iOS 17_5; es_ES; es; scale=3.00; 1179x2556; 607944922)",
    tiktok: "Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.123 Mobile Safari/537.36 musical_ly_2023405030 JsSdk/1.0 NetType/WIFI AppName/musical_ly app_version/34.5.3 BytedanceWebview/d8a21c6",
    facebook: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/465.0.0.38.107;FBBV/601177541;FBDV/iPhone14,5]",
    webview: "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.53 Mobile Safari/537.36",
    chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    safari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    quest: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.0 Chrome/124.0.0.0 VR Safari/537.36",
  };
  check(inAppBrowser(ua.instagram) === "Instagram" && inAppBrowser(ua.tiktok) === "TikTok" && inAppBrowser(ua.facebook) === "Facebook", "Instagram, TikTok y Facebook se reconocen");
  check(inAppBrowser(ua.webview) === "", "una vista web de Android sin nombre también");
  check([ua.chromeAndroid, ua.safari, ua.desktop, ua.quest].every((u) => inAppBrowser(u) === null), "Chrome, Safari, un PC y las gafas no son navegadores integrados");
  const link = "https://xenxo.io/d/vertical?x=1";
  check(openInBrowserUrl(ua.tiktok, link) === "intent://xenxo.io/d/vertical?x=1#Intent;scheme=https;action=android.intent.action.VIEW;end", "en Android se abre con un intent");
  check(openInBrowserUrl(ua.instagram, link) === "x-safari-https://xenxo.io/d/vertical?x=1", "en iPhone, con Safari");
  check(openInBrowserUrl(ua.desktop, link) === null && openInBrowserUrl(ua.tiktok, "http://localhost:5173/") === null, "en un PC (o sin https) no se ofrece");
}

console.log(fails ? `\n${fails} fallos` : "\nTodo bien");
process.exit(fails ? 1 : 0);

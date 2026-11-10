// Páginas para compartir: después de compilar la web, una copia de su index.html por cada ruta que
// se comparte (/en, /d/<distrito>, /d/<distrito>/<sitio> y sus versiones en inglés), cada una con
// su título, su descripción y su imagen para las redes (Open Graph). Así un enlace a /d/vertical
// enseña Vertical al pegarlo en un chat, sin ningún servidor por medio: son archivos estáticos.
// También escribe robots.txt y sitemap.xml.
//
//   node tools/share/build.mjs        (lo lanza `npm run build -w @xenxo/web`)
//
// El dominio sale de WEB_DOMAIN (por defecto xenxo.io), como en el despliegue. Las imágenes son
// capturas reales del mundo (apps/web/public/og/, ver tools/share/README.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIST = join(ROOT, "apps", "web", "dist");
const DOMAIN = process.env.WEB_DOMAIN || "xenxo.io";
const ORIGIN = `https://${DOMAIN}`;

const layout = JSON.parse(readFileSync(join(ROOT, "apps", "realtime", "src", "districts.json"), "utf8"));
const guide = JSON.parse(readFileSync(join(ROOT, "apps", "web", "src", "world", "guide.json"), "utf8"));
const i18n = readFileSync(join(ROOT, "apps", "web", "src", "i18n.ts"), "utf8");

/** Los textos de la interfaz, por idioma (i18n.ts: primero el diccionario en español, luego el inglés). */
const cut = i18n.indexOf("} as const;");
const DICT = { es: i18n.slice(0, cut), en: i18n.slice(cut) };
function text(lang, key) {
  const m = DICT[lang].match(new RegExp(`^\\s*${JSON.stringify(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: (".*"),?\\s*$`, "m"));
  return m ? JSON.parse(m[1]) : null;
}

const LANGS = {
  es: { prefix: "", locale: "es_ES", tail: "Entra desde el navegador, sin descargar nada." },
  en: { prefix: "/en", locale: "en_GB", tail: "Jump in from your browser, nothing to install." },
};
const HOME = {
  es: {
    title: "xenxo.io — un mundo 3D abierto, en tu navegador",
    desc: "Parkour, carreras y juegos sin descargar nada. Y si creas: cuentas, personajes 3D y una parcela para tu juego web. Código abierto, hecho por personas y agentes de IA.",
    alt: "El nexo de xenxo: una plataforma sobre una ciudad, con las puertas de los distritos",
  },
  en: {
    title: "xenxo.io — an open 3D world, right in your browser",
    desc: "Parkour, races and games with nothing to install. And if you build: accounts, 3D characters and a plot for your web game. Open source, made by people and AI agents.",
    alt: "The xenxo nexus: a platform above a city, with the gates to the districts",
  },
};

/** La dirección completa de una ruta en un idioma ("" es la portada: / en español, /en en inglés). */
const abs = (lang, path) => `${ORIGIN}${LANGS[lang].prefix + path || "/"}`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const image = (name) => (existsSync(join(DIST, "og", `${name}.jpg`)) ? name : "xenxo");

/** La cabecera que cambia en cada página (lo que va entre share:start y share:end en index.html). */
function head({ lang, path, title, desc, img, alt }) {
  const url = (l) => abs(l, path);
  const here = abs(lang, path);
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<link rel="canonical" href="${here}" />`,
    `<link rel="alternate" hreflang="es" href="${url("es")}" />`,
    `<link rel="alternate" hreflang="en" href="${url("en")}" />`,
    `<link rel="alternate" hreflang="x-default" href="${url("es")}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${DOMAIN}" />`,
    `<meta property="og:locale" content="${LANGS[lang].locale}" />`,
    `<meta property="og:url" content="${here}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:image" content="${ORIGIN}/og/${image(img)}.jpg" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(alt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n    ");
}

const shell = readFileSync(join(DIST, "index.html"), "utf8");
const START = "<!-- share:start -->";
const END = "<!-- share:end -->";
if (!shell.includes(START) || !shell.includes(END)) throw new Error("index.html no tiene las marcas share:start / share:end");

function page(file, lang, meta) {
  const a = shell.indexOf(START) + START.length;
  const b = shell.indexOf(END);
  const html = `${shell.slice(0, a)}\n    ${head({ lang, ...meta })}\n    ${shell.slice(b)}`.replace(/<html lang="[a-z-]+">/, `<html lang="${lang}">`);
  const out = join(DIST, file);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

const urls = [];
let pages = 0;
for (const lang of Object.keys(LANGS)) {
  const L = LANGS[lang];
  const home = { path: "", title: HOME[lang].title, desc: HOME[lang].desc, img: "xenxo", alt: HOME[lang].alt };
  // La portada: index.html en español (se reescribe con el dominio) y /en en inglés.
  page(lang === "es" ? "index.html" : "en.html", lang, home);
  urls.push(abs(lang, ""));
  pages++;

  const places = [
    { id: "plaza", name: text(lang, "nexo.plaza") ?? "La Plaza", desc: text(lang, "nexo.plazaDesc") ?? "" },
    ...layout.districts.filter((d) => !d.soon).map((d) => ({ id: d.id, name: d.name[lang] ?? d.name.en, desc: d.desc[lang] ?? d.desc.en })),
  ];
  for (const d of places) {
    const meta = { title: `${d.name} · ${DOMAIN}`, desc: `${d.desc} ${L.tail}`, img: d.id, alt: d.name };
    page(`${L.prefix.slice(1)}${L.prefix ? "/" : ""}d/${d.id}.html`, lang, { ...meta, path: `/d/${d.id}` });
    urls.push(abs(lang, `/d/${d.id}`));
    pages++;
    // Sus sitios (world/guide.json): la misma vista previa del distrito, con el nombre del sitio delante.
    const entries = Array.isArray(guide[d.id]) ? guide[d.id] : [];
    const spots = entries.flatMap((e) => [
      ...(e.levels ? [] : [{ id: e.id, name: text(lang, `guide.${d.id}.${e.id}`), desc: text(lang, `guide.${d.id}.${e.id}.text`) }]),
      ...(e.levels ?? []).map((id, i) => ({ id, name: (text(lang, "guide.level") ?? "{n}").replace("{n}", String(i + 1)), desc: text(lang, `guide.${d.id}.${e.id}.text`) })),
    ]);
    for (const s of spots) {
      if (!s.name) throw new Error(`falta el texto guide.${d.id}.${s.id} (${lang}) en i18n.ts`);
      page(`${L.prefix.slice(1)}${L.prefix ? "/" : ""}d/${d.id}/${s.id}.html`, lang, {
        path: `/d/${d.id}/${s.id}`,
        title: `${s.name} · ${d.name} · ${DOMAIN}`,
        desc: `${s.desc ?? d.desc} ${L.tail}`,
        img: d.id,
        alt: `${s.name}, ${d.name}`,
      });
      pages++;
    }
  }
}

// La guía para desarrolladores (tools/docs) también va en el mapa del sitio.
for (const p of ["/docs/", "/docs/en/"]) if (existsSync(join(DIST, p, "index.html"))) urls.push(`${ORIGIN}${p}`);

const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc><lastmod>${today}</lastmod></url>`).join("\n")}\n</urlset>\n`,
);
writeFileSync(join(DIST, "robots.txt"), `# ${DOMAIN}: todo se puede leer. El mundo en sí necesita JavaScript.\nUser-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);

const missing = ["xenxo", "plaza", ...layout.districts.filter((d) => !d.soon).map((d) => d.id)].filter((n) => !existsSync(join(DIST, "og", `${n}.jpg`)));
if (missing.length) console.warn(`share: sin imagen propia (usan la de la portada): ${missing.join(", ")}`);
console.log(`share: ${pages} páginas, sitemap.xml (${urls.length} direcciones) y robots.txt para ${DOMAIN}`);

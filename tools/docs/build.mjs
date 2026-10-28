// Guía para desarrolladores (xenxo.io/docs): de docs/guia/<idioma>/*.md a HTML estático en
// apps/web/public/docs/ (se genera al compilar la web; no se sube al repo).
//
//   node tools/docs/build.mjs
//
// Sin scripts ni estilos en línea (la CSP de la web no los deja): todo va en docs.css y docs.js.
// Las fuentes se copian de @fontsource: el navegador no habla con nadie más que con xenxo.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "docs", "guia");
const OUT = join(ROOT, "apps", "web", "public", "docs");
const REPO = "https://github.com/xenxo-dev/xenxo-world";
const LANGS = ["es", "en"].filter((l) => existsSync(join(SRC, l)));

const UI = {
  es: {
    home: "Guía", docs: "Desarrolladores", onPage: "En esta página", edit: "Editar esta página en GitHub",
    prev: "Anterior", next: "Siguiente", menu: "Guías", theme: "Cambiar entre día y noche", other: "English",
    back: "Volver a xenxo.io", code: "Código", copy: "Copiar", copied: "Copiado", skip: "Saltar al contenido",
    note: "Nota", tip: "Consejo", warning: "Ojo", important: "Importante", caution: "Cuidado",
    soon: "Próximamente", license: "Documentación con licencia AGPL-3.0, como el resto de xenxo-world.",
  },
  en: {
    home: "Guide", docs: "Developers", onPage: "On this page", edit: "Edit this page on GitHub",
    prev: "Previous", next: "Next", menu: "Guides", theme: "Switch between day and night", other: "Español",
    back: "Back to xenxo.io", code: "Source", copy: "Copy", copied: "Copied", skip: "Skip to content",
    note: "Note", tip: "Tip", warning: "Warning", important: "Important", caution: "Caution",
    soon: "Coming soon", license: "Documentation licensed AGPL-3.0, like the rest of xenxo-world.",
  },
};

/* --- Lectura ------------------------------------------------------------------------------ */

/** Cabecera mínima: líneas `clave: valor` entre dos `---`. */
function parse(file) {
  const raw = readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (m) for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m ? raw.slice(m[0].length) : raw };
}

function pages(lang) {
  const dir = join(SRC, lang);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => ({ slug: f.replace(/\.md$/, ""), ...parse(join(dir, f)) }))
    .sort((a, b) => Number(a.meta.order ?? 99) - Number(b.meta.order ?? 99));
}

/* --- Markdown → HTML ---------------------------------------------------------------------- */

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Enlaces: entre guías sin `.md`; a archivos del repositorio, a GitHub. */
function href(url, lang) {
  if (/^(https?:|mailto:|#)/.test(url)) return url;
  const [path, hash = ""] = url.split("#");
  const h = hash ? `#${hash}` : "";
  if (/^[a-z0-9-]+\.md$/.test(path)) return `${path === "index.md" ? "./" : path.replace(/\.md$/, "")}${h}`;
  if (path.startsWith("../../../")) {
    const rel = path.replace(/^(\.\.\/)+/, "");
    return `${REPO}/${rel.endsWith("/") ? "tree" : "blob"}/main/${rel}${h}`;
  }
  return url;
}

function render(body, lang) {
  const toc = [];
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text);
        if (depth === 2 || depth === 3) toc.push({ id, text: text.replace(/<[^>]+>/g, ""), depth });
        if (depth === 1) return `<h1>${text}</h1>\n`;
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${depth}>\n`;
      },
      link({ href: url, title, tokens }) {
        const out = href(url, lang);
        const ext = /^https?:/.test(out) && !out.startsWith("https://xenxo.io");
        return `<a href="${esc(out)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${this.parser.parseInline(tokens)}</a>`;
      },
      code({ text, lang: l }) {
        const label = (l || "").split(/\s/)[0];
        if (label === "text") return `<div class="code plain"><pre><code>${esc(text)}</code></pre></div>\n`;
        return `<div class="code"${label ? ` data-lang="${esc(label)}"` : ""}><pre><code>${esc(text)}</code></pre></div>\n`;
      },
      table(token) {
        // Tablas con desplazamiento propio en móvil.
        const head = token.header.map((c) => `<th${c.align ? ` class="a-${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows
          .map((r) => `<tr>${r.map((c) => `<td${c.align ? ` class="a-${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
          .join("\n");
        return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
      },
      blockquote({ tokens }) {
        // Avisos con la sintaxis de GitHub: > [!NOTE], > [!TIP], > [!WARNING]…
        const inner = this.parser.parse(tokens);
        const m = inner.match(/^<p>\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s*/);
        if (!m) return `<blockquote>${inner}</blockquote>\n`;
        const kind = m[1].toLowerCase();
        return `<aside class="callout ${kind}"><p class="callout-title">${UI[lang][kind]}</p><p>${inner.slice(m[0].length)}</aside>\n`;
      },
    },
  });
  return { html: md.parse(body), toc };
}

/* --- Plantilla ---------------------------------------------------------------------------- */

const ICON_SUN = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const ICON_MOON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;
const ICON_GH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/></svg>`;

/**
 * El anillo del nexo: 8 puertas cada 45°, como en el mundo. Las guías son las puertas abiertas; el
 * resto, cerradas («próximamente»), igual que los distritos que aún no han abierto.
 */
function ring(list, lang) {
  const gates = list.filter((p) => p.meta.gate);
  const R = 150, C = 200;
  const pos = (i) => {
    const a = (-90 + i * 45) * (Math.PI / 180);
    return [C + R * Math.cos(a), C + R * Math.sin(a)];
  };
  // Las abiertas en las diagonales y el norte, como la plaza y los distritos.
  const slots = [0, 1, 3, 5, 7, 2, 4, 6];
  let svg = `<svg class="ring" viewBox="-115 0 630 410" role="img" aria-labelledby="ring-title"><title id="ring-title">${esc(lang === "es" ? "El nexo de xenxo: una puerta por cada forma de desplegarlo" : "The xenxo nexus: one gate for each way to deploy it")}</title>`;
  svg += `<circle class="ring-orbit" cx="${C}" cy="${C}" r="${R}"/><circle class="ring-core" cx="${C}" cy="${C}" r="54"/>`;
  svg += `<text class="ring-word" x="${C}" y="${C + 8}" text-anchor="middle">xenxo</text>`;
  for (let s = 0; s < 8; s++) {
    const [x, y] = pos(s);
    svg += `<line class="ring-ray" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }
  slots.forEach((slot, i) => {
    const [x, y] = pos(slot);
    const g = gates[i];
    if (!g) {
      svg += `<g class="gate closed"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13"/></g>`;
      return;
    }
    const right = x >= C;
    const tx = x + (Math.abs(x - C) < 1 ? 0 : right ? 26 : -26);
    const ty = Math.abs(x - C) < 1 ? (y < C ? y - 26 : y + 36) : y + 5;
    const anchor = Math.abs(x - C) < 1 ? "middle" : right ? "start" : "end";
    svg += `<a class="gate" href="${g.slug === "index" ? "./" : g.slug}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="17"/><circle class="gate-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5"/><text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="${anchor}">${esc(g.meta.gate)}</text></a>`;
  });
  return svg + `</svg>`;
}

function shell({ lang, page, list, html, toc }) {
  const t = UI[lang];
  const base = lang === "es" ? "/docs/" : "/docs/en/";
  const otherBase = lang === "es" ? "/docs/en/" : "/docs/";
  const self = page.slug === "index" ? base : base + page.slug;
  const other = page.slug === "index" ? otherBase : otherBase + page.slug;
  const i = list.indexOf(page);
  const prev = list[i - 1];
  const next = list[i + 1];
  const link = (p) => (p.slug === "index" ? base : base + p.slug);
  const nav = list
    .map((p) => `<li><a href="${link(p)}"${p === page ? ' aria-current="page"' : ""}>${esc(p.meta.nav ?? p.meta.title)}</a></li>`)
    .join("");
  const tocHtml = toc.filter((x) => x.depth === 2).length > 1
    ? `<nav class="toc" aria-label="${t.onPage}"><p>${t.onPage}</p><ul>${toc.map((x) => `<li class="d${x.depth}"><a href="#${x.id}">${esc(x.text)}</a></li>`).join("")}</ul></nav>`
    : "";
  const home = page.slug === "index";
  const hero = home
    ? `<header class="hero"><div class="hero-text"><h1>${page.meta.hero}</h1><p class="lead">${page.meta.lead}</p></div>${ring(list, lang)}</header>`
    : `<header class="page-head"><h1>${esc(page.meta.title)}</h1>${page.meta.description ? `<p class="lead">${esc(page.meta.description)}</p>` : ""}</header>`;
  const pager = `<nav class="pager" aria-label="${t.prev} / ${t.next}">${prev ? `<a class="prev" href="${link(prev)}"><span>${t.prev}</span>${esc(prev.meta.nav ?? prev.meta.title)}</a>` : "<span></span>"}${next ? `<a class="next" href="${link(next)}"><span>${t.next}</span>${esc(next.meta.nav ?? next.meta.title)}</a>` : ""}</nav>`;
  const title = home ? `${page.meta.title} · xenxo.io` : `${page.meta.title} · ${t.docs} · xenxo.io`;
  return `<!doctype html>
<html lang="${lang}" data-copy="${t.copy}" data-copied="${t.copied}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(page.meta.description ?? "")}" />
<meta name="theme-color" content="#080d19" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="alternate" hreflang="${lang === "es" ? "en" : "es"}" href="${other}" />
<link rel="canonical" href="https://xenxo.io${self}" />
<link rel="stylesheet" href="/docs/assets/docs.css" />
<script src="/docs/assets/docs.js"></script>
</head>
<body class="${home ? "home" : "guide"}">
<a class="skip" href="#content">${t.skip}</a>
<header class="top">
  <a class="brand" href="${base}"><span class="word">xenxo<span class="dot">.io</span></span><span class="section">${t.docs}</span></a>
  <div class="top-actions">
    <a href="${other}" hreflang="${lang === "es" ? "en" : "es"}" lang="${lang === "es" ? "en" : "es"}">${t.other}</a>
    <a class="icon" href="${REPO}" rel="noopener" aria-label="${t.code}" title="${t.code}">${ICON_GH}</a>
    <button class="icon theme" type="button" aria-label="${t.theme}" title="${t.theme}">${ICON_SUN}${ICON_MOON}</button>
    <a class="back" href="/">${t.back}</a>
  </div>
</header>
<div class="layout">
  <nav class="side" aria-label="${t.menu}">
    <details class="side-menu" open><summary>${t.menu}</summary><ul>${nav}</ul></details>
  </nav>
  <main id="content">
    ${hero}
    <article class="prose">
${html}
    </article>
    ${pager}
    <footer class="foot">
      <a href="${REPO}/edit/main/docs/guia/${lang}/${page.slug}.md" rel="noopener">${t.edit}</a>
      <p>${t.license}</p>
    </footer>
  </main>
  ${tocHtml}
</div>
</body>
</html>
`;
}

/* --- Salida ------------------------------------------------------------------------------- */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "assets", "fonts"), { recursive: true });
mkdirSync(join(OUT, "en"), { recursive: true });

for (const lang of LANGS) {
  const list = pages(lang);
  for (const page of list) {
    const { html, toc } = render(page.body, lang);
    const dir = lang === "es" ? OUT : join(OUT, "en");
    writeFileSync(join(dir, `${page.slug}.html`), shell({ lang, page, list, html, toc }));
  }
}

const here = dirname(fileURLToPath(import.meta.url));
cpSync(join(here, "docs.css"), join(OUT, "assets", "docs.css"));
cpSync(join(here, "docs.js"), join(OUT, "assets", "docs.js"));
const FONTS = [
  ["space-grotesk", "space-grotesk-latin-500-normal.woff2"],
  ["space-grotesk", "space-grotesk-latin-700-normal.woff2"],
  ["inter", "inter-latin-400-normal.woff2"],
  ["inter", "inter-latin-600-normal.woff2"],
  ["inter", "inter-latin-ext-400-normal.woff2"],
  ["inter", "inter-latin-ext-600-normal.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-400-normal.woff2"],
  ["ibm-plex-mono", "ibm-plex-mono-latin-500-normal.woff2"],
];
for (const [pkg, file] of FONTS) {
  const from = join(ROOT, "node_modules", "@fontsource", pkg, "files", file);
  if (!existsSync(from)) throw new Error(`falta la fuente ${from}`);
  cpSync(from, join(OUT, "assets", "fonts", file));
}
console.log(`guía generada en ${OUT}`);

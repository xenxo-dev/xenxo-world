// La lista de repositorios públicos que enseña el panel (Proyectos → Repos), como un archivo
// estático: apps/web/public/repos.json. Se genera en el despliegue, con el token del propio flujo
// de GitHub Actions, y la web lo lee de su mismo origen: ni el navegador ni el Worker hablan con
// GitHub en cada visita (la consulta del Worker, sin identificar y desde direcciones compartidas,
// se topaba con el límite de GitHub y el panel decía que no había repos).
//
//   GITHUB_OWNER=xenxo-dev [GITHUB_TOKEN=…] node tools/repos/fetch.mjs
//
// Si GitHub no contesta, no se escribe nada y el despliegue sigue: la web pregunta entonces al
// Worker (`/github/repos`), como antes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "apps", "web", "public", "repos.json");
const owner = process.env.GITHUB_OWNER || "xenxo-dev";
const token = process.env.GITHUB_TOKEN || "";

try {
  const r = await fetch(`https://api.github.com/users/${encodeURIComponent(owner)}/repos?sort=updated&per_page=30`, {
    headers: { "User-Agent": "xenxo-world", Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const repos = (await r.json())
    .filter((x) => !x.fork && !x.private)
    .slice(0, 12)
    .map((x) => ({ name: x.name, description: x.description, html_url: x.html_url, stargazers_count: x.stargazers_count, language: x.language }));
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ owner, repos, at: new Date().toISOString() }));
  console.log(`repos: ${repos.length} de ${owner} → apps/web/public/repos.json`);
} catch (e) {
  console.warn(`repos: GitHub no contesta (${e.message}); la web preguntará al Worker`);
}

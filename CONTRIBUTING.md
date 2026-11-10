# Contribuir a xenxo

xenxo lo hace su comunidad: no hay empresa detrás. Cualquier ayuda vale, también si programas con
una IA al lado. *(English below.)*

## Formas de ayudar

| Quieres… | Por dónde |
|---|---|
| Avisar de un fallo o proponer algo | Una [issue](https://github.com/xenxo-dev/xenxo-world/issues/new/choose). Desde xenxo.io, el enlace «Informar de un problema» la abre ya rellenada |
| Hacer un juego, un distrito o que tu agente construya | No hace falta tocar este repositorio: [guía para crear](https://xenxo.io/docs/crear) |
| Mejorar el mundo (web, servidor, herramientas) | Un pull request contra `main` (sigue leyendo) |
| Traducir | Un diccionario nuevo en `apps/web/src/i18n.ts` y las páginas de `docs/guia/` |
| Aportar modelos, texturas o sonido | Solo CC0 o hechos por ti, con su línea en `CREDITS.md` (`docs/RECURSOS.md`) |
| Alojar un distrito en tu servidor (un nodo) | [Los distritos en tu servidor](https://xenxo.io/docs/servidor) y escribe a contact@xenxo.io |
| Avisar de un fallo de seguridad | Nunca en una issue pública: [`SECURITY.md`](SECURITY.md) |

## Antes de programar

1. Lee [`CLAUDE.md`](CLAUDE.md). Son las reglas del repositorio y valen igual para personas y para
   agentes de IA. Las cuatro que no se negocian:
   - el contrato es `packages/protocol` (agnóstico del motor);
   - se versiona, no se edita el significado de un campo;
   - una sola puerta de escritura del mundo (`MUTATE_WORLD` → `chunk-room.ts`);
   - los agentes son clientes normales, sin vías privilegiadas.
2. Para un cambio grande, abre antes una issue y cuéntalo: ahorra trabajo a todos.
3. Arráncalo en local (Node 22 o más nuevo):

   ```bash
   npm install
   cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars
   cp apps/web/.env.example apps/web/.env
   npm run dev:realtime   # terminal 1 → http://localhost:8787
   npm run dev:web        # terminal 2 → http://localhost:5173
   ```

## Antes de abrir el pull request

```bash
npm run typecheck
npm run build
# con `npm run dev:realtime` en marcha:
XENXO_AGENT_KEY=dev-agent-key-change-me npm run conformance
```

- Toda cadena de la interfaz, en `apps/web/src/i18n.ts`, en español e inglés.
- Si cambias el protocolo: `docs/PROTOCOL.md` y un escenario nuevo en `apps/headless/src/conformance.ts`.
- Si cambias cómo se arranca, se despliega o se aloja algo: `docs/guia` en los dos idiomas.
- Las gafas (Quest 3) son el mínimo: nada de objetos nuevos por frame y cada efecto, en la tabla
  `FEATURES`. La web no habla con terceros y todo se diseña para el plan gratuito de Cloudflare.
- Si lo ha escrito un agente de IA, dilo en el pull request. Es bienvenido y pasa las mismas pruebas.

El CI repite estas comprobaciones. Lo que llega a `main` se despliega solo en xenxo.io.

## Licencia de lo que aportas

Lo que envías se publica con la licencia de la carpeta que tocas: **AGPL-3.0** en el mundo
(`apps/realtime`, `apps/web`, `tools/`) y **MIT** en lo que usan los creadores (`packages/*`,
`apps/headless`). Al abrir el pull request confirmas que es tuyo, o que puedes aportarlo con esa
licencia. Detalle en [`NOTICE.md`](NOTICE.md).

Y entre personas: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

---

# Contributing to xenxo

xenxo is built by its community: there is no company behind it. Any help counts, including work
done with an AI at your side.

## Ways to help

| You want to… | Where |
|---|---|
| Report a bug or suggest something | An [issue](https://github.com/xenxo-dev/xenxo-world/issues/new/choose). On xenxo.io, the "Report a problem" link opens one pre-filled |
| Make a game, a district, or let your agent build | No need to touch this repository: [creator guide](https://xenxo.io/docs/en/crear) |
| Improve the world (web, server, tools) | A pull request against `main` (read on) |
| Translate | A new dictionary in `apps/web/src/i18n.ts` and the pages under `docs/guia/` |
| Contribute models, textures or sound | CC0 or your own work only, with a line in `CREDITS.md` (`docs/RECURSOS.md`) |
| Host a district on your server (a node) | [Districts on your server](https://xenxo.io/docs/en/servidor), then write to contact@xenxo.io |
| Report a security problem | Never in a public issue: [`SECURITY.md`](SECURITY.md) |

## Before you code

1. Read [`CLAUDE.md`](CLAUDE.md) (in Spanish). Those are the repository rules, for people and AI
   agents alike. The four that are not up for debate:
   - the contract is `packages/protocol` (engine-agnostic);
   - version, never edit what a field means;
   - one single write gate into the world (`MUTATE_WORLD` → `chunk-room.ts`);
   - agents are ordinary clients, with no privileged path.
2. For a large change, open an issue first and describe it: it saves everyone work.
3. Run it locally (Node 22 or newer): the commands above.

## Before opening the pull request

Run `npm run typecheck`, `npm run build` and, with `npm run dev:realtime` running,
`XENXO_AGENT_KEY=dev-agent-key-change-me npm run conformance`.

- Every interface string goes in `apps/web/src/i18n.ts`, in Spanish and English.
- Protocol changes need `docs/PROTOCOL.md` and a new scenario in `apps/headless/src/conformance.ts`.
- Changes to how something is started, deployed or hosted need `docs/guia` in both languages.
- Headsets (Quest 3) are the baseline: no new objects per frame, and every effect goes in the
  `FEATURES` table. The web talks to no third parties and everything targets Cloudflare's free plan.
- If an AI agent wrote it, say so in the pull request. It is welcome and goes through the same checks.

CI repeats these checks. Whatever lands on `main` is deployed to xenxo.io automatically.

## Licence of your contribution

What you send is published under the licence of the folder you touch: **AGPL-3.0** for the world
(`apps/realtime`, `apps/web`, `tools/`) and **MIT** for what creators use (`packages/*`,
`apps/headless`). By opening the pull request you confirm it is yours, or that you may contribute it
under that licence. Details in [`NOTICE.md`](NOTICE.md).

And between people: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

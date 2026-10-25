# xenxo-world

El mundo de **xenxo.io**: un panel 2D con soluciones, repos y agentes, y detrás una plaza mayor mediterránea en 3D, viva, que se puede recorrer desde el navegador en **escritorio, móvil y VR** (Meta Quest 3 vía WebXR), y que construyen tanto personas como **agentes de IA**.

Se está construyendo en público. Esto es la v0.

## Arquitectura

```
 Clientes (reemplazables)          Núcleo (lo que dura)
 ┌─────────────┐
 │ Web / WebXR │──┐
 ├─────────────┤  │   ┌──────────────────────┐   ┌───────────────────────────┐
 │  Headless   │──┼──▶│ Protocolo v0 (Zod)   │──▶│ Durable Object por chunk  │
 ├─────────────┤  │   │ packages/protocol    │   │ autoridad + SQLite + log  │
 │ Agentes IA  │──┘   └──────────────────────┘   └───────────────────────────┘
 └─────────────┘
```

- **Cloudflare Pages** sirve el cliente web (panel + 3D).
- **Cloudflare Workers + Durable Objects** (`apps/realtime`): un objeto por chunk de 64 × 64 m, con jurisdicción de la UE (los datos se guardan y procesan solo en Europa). Valida cada mutación, guarda el estado en su SQLite, reparte las poses a 10 Hz y duerme cuando no hay mensajes (WebSocket Hibernation).
- **Directory** (otro Durable Object): cuentas con **passkey** (sin email ni contraseña), proyectos de la comunidad y denuncias.
- **R2**: modelos 3D (personajes y stands) direccionados por hash, en la UE y sin coste de descarga.
- **GitHub Actions** despierta al agente constructor de ejemplo cada 6 horas.

El contrato completo está en [`docs/PROTOCOL.md`](docs/PROTOCOL.md). Las reglas para trabajar en el repo, en [`CLAUDE.md`](CLAUDE.md).

## Arrancar en local

Requisitos: Node 22+.

```bash
npm install
cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars
cp apps/web/.env.example apps/web/.env

npm run dev:realtime   # terminal 1 → http://localhost:8787
npm run dev:web        # terminal 2 → http://localhost:5173
```

Abre `http://localhost:5173` en dos pestañas y pulsa **Enter world** en ambas: os veréis moveros.

Para probar en las Quest 3 en la misma red, abre `http://<IP-de-tu-PC>:5173` en el navegador de las gafas. WebXR exige HTTPS fuera de `localhost`, así que para la VR real usa el despliegue en Cloudflare o un túnel (por ejemplo `cloudflared tunnel --url http://localhost:5173`).

### Personajes y proyectos de la comunidad

Cualquiera que se dé de alta (con una passkey) puede, desde **Personalizar** y **Proyectos**:

- Subir su **personaje** en `.glb` (Blender o lo que quiera) o `.vrm` (VRoid Studio y similares). Se valida y se optimiza en su propio navegador antes de subirlo, y los demás lo ven en la plaza.
- **Publicar un proyecto** con título, descripción, enlace y un modelo 3D opcional. Aparece en la lista y como stand en la exposición, delante del edificio Proyectos.
- Descargar todos sus datos o borrar la cuenta (y todo su contenido) en un clic.

Guía para quien crea modelos: [`docs/CREAR-MODELOS.md`](docs/CREAR-MODELOS.md).

Para subir modelos tuyos o de un agente desde la terminal (packs CC0, Blender, escaneos…):

```bash
XENXO_AGENT_KEY=dev-agent-key-change-me npm run upload-asset -w @xenxo/headless -- ruta/modelo.glb model
```

Optimiza, sube todos los LOD y te devuelve el `mesh@1` listo para usar en `MUTATE_WORLD`.

### Banco de conformidad y agente

```bash
export XENXO_URL=http://localhost:8787
export XENXO_AGENT_KEY=dev-agent-key-change-me   # la clave de ejemplo de .dev.vars.example
export XENXO_ADMIN_KEY=dev-admin-key-change-me   # moderación (opcional)

npm run conformance    # 18 escenarios: protocolo, cuentas, assets, proyectos, RGPD y denuncias
npm run agent:build    # el agente coloca un bloque en la plaza
```

## Desplegar (gratis para empezar)

1. **Servidor de tiempo real**
   ```bash
   cd apps/realtime
   npx wrangler login
   npx wrangler secret put TOKEN_SECRET      # cadena larga aleatoria
   npm run hash-key -w @xenxo/headless       # genera una clave de agente y su hash
   npx wrangler secret put AGENT_KEYS        # builder-01:<hash>,admin-01:<hash>:build|upload|admin
   npx wrangler r2 bucket create xenxo-assets --jurisdiction eu
   npm run deploy
   ```
   Añade tu dominio a `ALLOWED_ORIGINS` en `wrangler.toml` si usas otro distinto de xenxo.io, y ajusta `RP_ID` (el dominio de las passkeys).
   Antes de abrir cuentas, completa los datos entre corchetes de `apps/web/public/legal/` y haz que los revise un profesional.
2. **Web en Cloudflare Pages**: conecta este repo, directorio raíz del repositorio, comando `npm run build`, salida `apps/web/dist`, y la variable `VITE_REALTIME_URL` con la URL del Worker.
3. **Agente en GitHub Actions**: en *Settings → Secrets and variables → Actions*, crea la variable `XENXO_URL` y el secreto `XENXO_AGENT_KEY`.

**Antes de publicar un vídeo invitando a entrar**, pasa la cuenta de Cloudflare al plan Workers Paid (5 $/mes): en el gratuito, al superar los límites diarios el multijugador se corta hasta las 00:00 UTC.

## Estado

- [x] Protocolo v0 con esquemas y códigos de error
- [x] Durable Object por chunk: autoridad, presupuestos, propiedad, `base_rev`, idempotencia, log
- [x] Panel 2D (Solutions, Repos en vivo de GitHub, Agents en vivo, Customize)
- [x] Plaza 3D como datos, avatares con interpolación, escritorio + móvil + WebXR
- [x] Plaza mayor mediterránea (cal, terracota, azulejo, fuente, campanario, naranjos) con primitivas
- [x] Español e inglés en el panel, el HUD y los carteles del mundo
- [x] Datos de los chunks en la UE
- [x] Cliente headless con banco de conformidad y agente de ejemplo
- [ ] Panel dentro de la VR con `@react-three/uikit`
- [ ] Manos en VR y teletransporte
- [x] Assets glTF en R2 con validación de presupuesto y optimización en el navegador
- [x] Cuentas con passkey, personaje propio (GLB o VRM) y proyectos con stand en la plaza
- [x] Exportar y borrar datos (RGPD), denuncias y moderación (DSA), páginas legales en borrador
- [ ] Agente con LLM y servidor MCP del mundo ("trae tu propio agente")
- [ ] Varios chunks y paso de uno a otro
- [ ] Modelos CC0 (Kenney, Quaternius) en lugar de primitivas
- [ ] Parcelas con dueño, chat y retos con insignias
- [ ] Animaciones de andar para los personajes y manos en VR

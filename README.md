# xenxo-world

El mundo de **xenxo.io**: un panel 2D con soluciones, repos y agentes, y detrás un mundo 3D vivo —el **nexo** de entrada y sus **distritos** (La Plaza, Arcade, Píxel, Ágora, Taller, Frontera, Distrito Cero y Vertical), donde cada proyecto tiene su parcela— que se puede recorrer desde el navegador en **escritorio, móvil y VR** (Meta Quest 3 vía WebXR), y que construyen tanto personas como **agentes de IA**.

Se está construyendo en público. Esto es la v0.5.

## Publicar en xenxo.io (si no vas a tocar el código)

- **Tu personaje y tu proyecto:** entra en [xenxo.io](https://xenxo.io), *Cuenta → Crear cuenta* con passkey o Google (sin email). Desde ahí subes tu personaje (`.vrm` o `.glb`) y en *Proyectos → Publicar el mío* tu proyecto. Eliges **distrito** (Arcade, Píxel, Ágora, Taller, Frontera, Distrito Cero o Vertical) y una **parcela libre** en su plano, y das **nombre, enlace, una portada (imagen 16:9) y un monumento 3D** (`.glb`, ≤ 10.000 triángulos): tu proyecto aparece como un **portal en tu parcela**, con la portada en la pantalla y el monumento (hasta 1,6 m) en la peana de delante y como tarjeta en el nexo 2D (cuando lo revisa alguien de xenxo). Guía de modelos: [`docs/CREAR-MODELOS.md`](docs/CREAR-MODELOS.md).
- **Construir con un agente de IA:** publica tu proyecto, crea una clave de parcela en *Proyectos → Construir con tu agente* y conecta el servidor MCP de xenxo a Claude Code o Cursor (ver abajo). Para construir fuera de una parcela hace falta una clave que da el equipo (contact@xenxo.io).
- **Tu propia copia del mundo:** sigue *Arrancar en local* y *Desplegar*.

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

- **Cloudflare Workers** (recursos estáticos) sirve el cliente web (panel + 3D).
- **Cloudflare Workers + Durable Objects** (`apps/realtime`): un objeto por chunk de 64 × 64 m, con jurisdicción de la UE (los datos se guardan y procesan solo en Europa). Valida cada mutación, guarda el estado en su SQLite, reparte las poses a 8 Hz y duerme cuando no hay mensajes (WebSocket Hibernation).
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

Cualquiera que se dé de alta (con una passkey) puede, desde **Cuenta** y **Proyectos**:

- Subir su **personaje** en `.glb` (Blender o lo que quiera) o `.vrm` (VRoid Studio y similares) y verlo en una **vista previa 3D** (quieto, andando, bailando o saludando). Se valida y se optimiza en su propio navegador antes de subirlo, y los demás lo ven en todo el mundo (el mismo personaje, nombre y número en cada lugar). Su **armario** guarda hasta 3 personajes propios para cambiar de uno a otro; los 8 de serie no cuentan.
- **Publicar un proyecto** en la parcela que elija de un distrito, con nombre, enlace, portada y monumento 3D (descripción opcional). Aparece como portal en su parcela y, una vez revisado, como tarjeta en el nexo 2D.
- Escribir en el **chat de cada lugar** (nexo, plaza o distrito; los invitados lo leen); los mensajes salen también como bocadillos sobre los personajes y se pueden denunciar.
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

npm run conformance    # 29 escenarios: protocolo, gestos, avatares de serie, cuentas, assets (GLB y VRM), proyectos, chat, luces, RGPD y denuncias
npm run agent:build    # el agente coloca un bloque en la plaza
```

## El nexo: la entrada

Al entrar en xenxo se aparece en el **nexo**, una plataforma flotante sobre una megaciudad cyberpunk, con un planeta con anillos en el cielo (de día o de noche, según elijas en Personalizar): suelo oscuro con líneas de luz cian, «xenxo» escrito con luz en el centro, un faro fino y las **puertas de los distritos**. Cada puerta está abierta: a su izquierda, el emblema del distrito; a través de ella y detrás, su isla flotante con el distrito en pequeño. En el nexo solo hay distritos (los proyectos están en sus parcelas) y quedan huecos para distritos futuros.

- **La Plaza**: el distrito con historia (su arco devuelve al nexo).
- **Arcade** (juegos 3D), **Píxel** (juegos 2D), **Ágora** (social), **Taller** (herramientas), **Frontera** (lo demás), **Distrito Cero** (la ciudad ciberpunk de Xen: ciencia ficción e IA) y **Vertical** (torres de caravanas apiladas: webs personales y primeros proyectos): cada uno de **256 × 256 m**, con **su ciudad en el centro** (ocho manzanas de su tema alrededor de una plaza con su monumento y puestos de actividad) y, alrededor de dos anillos de calles, **64 parcelas** de 15 × 15 m. Quien publica elige distrito y parcela libre; su portal va al fondo de la parcela con su portada, su monumento en la peana y su nombre en neón. Al acercarte se abre su ficha con el enlace (nunca se abre nada sin pulsar). En la fase 2, la parcela será también el terreno que su dueño o su agente pueda construir.

Para quien no quiera moverse en 3D, el panel tiene el **nexo 2D**: las mismas portadas en tarjetas grandes, filtro por categoría, *Abrir* el proyecto o *Ver su portal* (te lleva delante de él).

La disposición está en `apps/realtime/src/nexo-layout.json` y `districts.json` (las usan el servidor, la forja y la web); sus piezas se forjan con `npm run forge:nexo` y `npm run forge:districts`. Para sacar recursos (texturas, modelos, avatares, sonido) mira [`docs/RECURSOS.md`](docs/RECURSOS.md).

## Construye en tu parcela con tu agente (MCP)

Quien publica un proyecto puede dejar que su agente (Claude Code, Cursor o cualquier cliente MCP)
construya en su parcela: en *Proyectos → Construir con tu agente* crea una **clave de parcela**
(`xk_…`), descarga el servidor MCP (`xenxo.io/mcp/xenxo-mcp.mjs`, un solo archivo) y se lo conecta
a su agente. El agente es un cliente más del protocolo: todo pasa por `MUTATE_WORLD` y el servidor
comprueba que cada pieza quepa entera en la parcela (15 × 15 m, 12 m de alto) y su presupuesto
(48 piezas, 24.000 triángulos, 1 luz). Detalles en [`packages/mcp/README.md`](packages/mcp/README.md).

## Haz tu juego: `npm create xenxo`

```sh
npm create xenxo@latest
```

Crea un juego **2D o 3D** listo para xenxo: «Entrar con xenxo», el personaje VRM del jugador, un
**simulador local** (jugador de prueba sin cuenta ni conexión), la ficha `xenxo.json` y un
`AGENTS.md` para que tu IA sepa integrarse desde el primer prompt. Se publica con `npm run deploy`
en tu cuenta gratuita de Cloudflare (o cualquier alojamiento estático). Detalles en
[`packages/create-xenxo/README.md`](packages/create-xenxo/README.md).

## «Entrar con xenxo» en tu juego

xenxo es proveedor de identidad (OpenID Connect) para juegos web: registras tu juego en
*Proyectos → «Entrar con xenxo» en tu juego*, pones el SDK (`npm install @xenxo/sdk` o `https://xenxo.io/sdk/xenxo.mjs`, 8 KB,
MIT) y la gente entra con su cuenta. Con su permiso recibes su nombre, su número de jugador y su
personaje (VRM), firmados con Ed25519; cada juego ve un identificador distinto de la misma persona
y cada persona puede retirar el permiso en *Cuenta → Juegos conectados*. Juego de ejemplo:
[xenxo.io/sdk/ejemplo](https://xenxo.io/sdk/ejemplo). Detalles en
[`packages/sdk/README.md`](packages/sdk/README.md).

## La Plaza (distrito) y las personas

- **Arquitectura generada por código** (`tools/forge`, Blender sin pantalla): casas con soportales, balcones de forja, persianas y tejas, campanario con cúpula de azulejo, fuente, puerta monumental con neón, farolas, bancos y naranjos. La oclusión ambiental se hornea en su sitio y cada pieza tiene dos niveles de detalle.
- **Texturas escaneadas reales** (cal, piedra, losas, adoquín, teja, madera…) y **cielo de nubes** de Poly Haven (CC0), servidos desde xenxo.
- **Personas realistas y animadas**: 8 avatares de serie generados con MakeHuman (CC0) y 17 animaciones VRMA (Quaternius, CC0) que valen también para cualquier VRM que suba la gente. Correr (Mayús), saltar (Espacio) y gestos (1-4: saludar, bailar, sentarse en un banco, celebrar) que todos ven. Movimiento con inercia, subida de escalones, se puede andar sobre bancos y muros bajos, y salto con margen (coyote y buffer). Cámara con zoom (rueda o pellizco) y primera persona (V), modo foto (P) y lista de «quién está aquí» con su carnet y un botón para ir a su lado. En móvil se salta sin dejar de caminar (botón en el otro pulgar) y los controles se ajustan en Personalizar (lado, tamaño, opacidad, sensibilidad). Pantalla completa (F) y se instala como app (PWA, abre sin red con la última copia).
- **De noche, ciudad de neón**: arcos y cornisas con tubos de neón, ventanas que se encienden, faroles y la ciudad del fondo iluminada.

Cómo regenerar todo: [`tools/forge/README.md`](tools/forge/README.md) y [`tools/avatars/README.md`](tools/avatars/README.md). Créditos en [`CREDITS.md`](CREDITS.md).

## Gráficos: los pinta el equipo de cada visitante

El servidor manda a todos el mismo mundo (datos). Cada navegador elige cómo dibujarlo según su gráfica:

| Nivel | Para quién | Qué añade |
|---|---|---|
| Ahorro | Gafas y móviles modestos, PCs sin gráfica | Texturas de 512 px, oclusión horneada, neones con halo y charcos de luz |
| Media | Quest 3/Pro, móviles potentes, portátiles con gráfica integrada | Relieve de las texturas, cielo real; en escritorio, resplandor de neones (bloom). En VR y móvil, sin post-proceso ni sombras |
| Alta | PCs con gráfica dedicada | Sombras, suelo que refleja la plaza, luces de farolas |
| Ultra | Gráficas potentes (RTX, Radeon RX 6000+, Apple M2+) | Más resolución de sombras y reflejos, oclusión ambiental, más ciudad |

Si los FPS caen, baja un nivel solo. Se puede fijar a mano en *Personalizar → Gráficos*, igual que el ambiente: de día la plaza mediterránea, de noche la ciudad de neón (en automático, según la hora del visitante). Los efectos de los niveles altos se descargan aparte: las gafas y los móviles nunca los bajan.

## Desplegar (gratis para empezar)

Se publica solo: cada vez que el CI pasa en `main`, el flujo **Desplegar** (`.github/workflows/deploy.yml`) sube el servidor a `api.xenxo.io` y la web a `xenxo.io` (Cloudflare Workers, datos en la UE). Configuración, una vez:

1. **Cloudflare**: crea la cuenta (gratis), añade el dominio `xenxo.io` (si lo compraste en otro sitio, cambia sus DNS a los de Cloudflare) y activa **R2** en el panel.
2. **Token de API**: *My Profile → API Tokens → Create Token → «Edit Cloudflare Workers»*, limitado a tu cuenta y a la zona `xenxo.io`. Copia también el *Account ID* (columna derecha de la página del dominio).
3. **GitHub** (*Settings → Secrets and variables → Actions*), secretos:
   - `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`,
   - `TOKEN_SECRET`: una cadena larga aleatoria (p. ej. `openssl rand -hex 32`); no la cambies después o se cerrarán todas las sesiones,
   - `AGENT_KEYS` (opcional): `npm run hash-key -w @xenxo/headless -- <tu-clave>` → `builder-01:<hash>` (y `admin-01:<hash>:build|upload|admin` para moderar).
   - Variable opcional `WEB_DOMAIN` si usas otro dominio.
   - Variable opcional `FOUNDER_USER_ID`: el id de tu cuenta (sale en *Descargar mis datos*) para ser el **jugador #0**. El resto se numera por orden de alta desde el 1.
4. **Antes de abrir cuentas**: completa los datos entre corchetes de `apps/web/public/legal/` (titular, NIF, dirección y email de contacto) y haz que los revise un profesional.
5. *Actions → Desplegar → Run workflow* (o empuja a `main`).

El agente de ejemplo usa la variable `XENXO_URL=https://api.xenxo.io` y el secreto `XENXO_AGENT_KEY`.

**Gasto:** está pensado para el plan gratuito, donde superar un límite corta el servicio (el multijugador, hasta las 00:00 UTC) en vez de cobrar. R2 sí cobraría al pasar de su capa gratis, por eso hay topes de almacenamiento y subidas (ver `CLAUDE.md`, sección Gasto). Pasar a Workers Paid (5 $/mes) es una decisión para cuando haya tráfico real.

## Estado

- [x] Protocolo v0 con esquemas y códigos de error
- [x] Durable Object por chunk: autoridad, presupuestos, propiedad, `base_rev`, idempotencia, log
- [x] Panel 2D (Solutions, Repos en vivo de GitHub, Agents en vivo, Customize)
- [x] Mundo 3D como datos, avatares con interpolación, escritorio + móvil + WebXR
- [x] Plaza mayor mediterránea (cal, terracota, azulejo, fuente, campanario, naranjos) con primitivas
- [x] Español e inglés en el panel, el HUD y los carteles del mundo
- [x] Datos de los chunks en la UE
- [x] Cliente headless con banco de conformidad y agente de ejemplo
- [ ] Panel dentro de la VR con `@react-three/uikit`
- [ ] Manos en VR y teletransporte
- [x] Assets glTF en R2 con validación de presupuesto y optimización en el navegador
- [x] Cuentas con passkey, personaje propio (GLB o VRM) y proyectos con portal en el nexo
- [x] Exportar y borrar datos (RGPD), denuncias y moderación (DSA), páginas legales en borrador
- [ ] Agente con LLM y servidor MCP del mundo ("trae tu propio agente")
- [x] Nexo de entrada con portales (3D y 2D) y paso de un lugar a otro
- [x] Distritos temáticos de 256 m con su ciudad y 64 parcelas: cada proyecto elige la suya
- [x] Construir en tu parcela con tu agente (MCP): clave de parcela y servidor MCP
- [x] Arquitectura generada (forja), texturas escaneadas y cielo real en lugar de primitivas
- [x] Personas realistas de serie con animaciones VRMA, gestos en red y colisiones
- [x] Movimiento con inercia, escalones y plataformas; zoom, primera persona, modo foto y «quién está aquí»
- [x] Controles táctiles configurables, pantalla completa y PWA instalable
- [x] Chat de cada lugar con bocadillos, límites, denuncias y moderación
- [x] Personajes que caminan (VRM con huesos humanoides, GLB con animaciones `idle`/`walk`)
- [x] Carga inicial rápida: el panel no espera a la escena 3D
- [x] Gráficos por niveles según el equipo (bloom, sombras, reflejos, AO) y ambiente día/noche con neones
- [ ] Parcelas con dueño y retos con insignias
- [ ] Manos y panel dentro de la VR

## Licencia

- **El mundo** (servidor, web y herramientas): [AGPL-3.0](LICENSE). Puedes usarlo, cambiarlo y montar tu propia copia, pero si la abres al público tienes que publicar tu código con tus cambios. Así nadie puede cerrar xenxo y quedarse con una versión privada.
- **Lo que usan los creadores** (`packages/protocol`, `packages/assets`, `apps/headless`, `packages/mcp`, `packages/sdk` y `packages/create-xenxo`): **MIT**. Conectar tu juego o tu agente a xenxo no cambia la licencia de tu código: sigue siendo tuyo.
- **Recursos gráficos**: ver [`CREDITS.md`](CREDITS.md).

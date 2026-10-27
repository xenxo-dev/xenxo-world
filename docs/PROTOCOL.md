# Protocolo xenxo v0

Este documento y [`packages/protocol/src/index.ts`](../packages/protocol/src/index.ts) son **el contrato del mundo**. El código es la fuente de verdad; este texto lo explica. Si los dos no coinciden, el bug está en el que cambió último.

## 1. Principios

1. **El mundo es el producto, los clientes son vistas desechables.** Nada aquí conoce Three.js, React, Cloudflare ni Supabase.
2. **Una sola puerta de escritura.** Humanos y agentes envían `MUTATE_WORLD` al servidor del chunk. Nadie escribe directamente en una base de datos.
3. **Compatibilidad hacia delante.** Un cliente que recibe algo que no entiende (un mensaje, un componente) lo ignora y sigue funcionando.
4. **Versionado explícito.** El sobre lleva `v`. Cada componente lleva su versión en el nombre (`transform@1`). Cambiar el significado de un campo = versión nueva, nunca edición silenciosa.

## 2. Convenciones

| Tema | Regla |
|---|---|
| Unidades | Metros |
| Ejes | Y hacia arriba, dextrógiro (igual que glTF 2.0) |
| Rotaciones | Cuaterniones `[x, y, z, w]` |
| Posiciones de entidades | **Relativas a su chunk** (`0 ≤ x, z < 64`, `-16 ≤ y ≤ 256`) |
| Chunks | `c_<x>_<z>`, lado `CHUNK_SIZE = 64` m. Origen global = `(x·64, 0, z·64)` |
| Tiempo | Milisegundos. Las poses de `POSES` usan la hora del servidor |
| Assets | Direccionados por contenido: `sha256:<64 hex>`, inmutables |

## 3. Entidad

```json
{
  "schema": "xenxo.entity/0",
  "entity_id": "e_vvELgZbIIo1f",
  "chunk_id": "c_0_0",
  "owner": "agt_builder-01",
  "rev": 3,
  "components": {
    "transform@1": { "p": [44, 0.8, 34], "r": [0, 0, 0, 1], "s": [1, 1, 1], "parent": null },
    "primitive@1": { "shape": "box", "size": [1.2, 1.6, 1.2], "color": "#34d399", "emissive": false },
    "label@1": { "text": "hola", "billboard": true, "size": 0.3 }
  }
}
```

`owner` y `rev` los pone el servidor. `rev` sube en cada cambio y sirve para el control de concurrencia optimista.

## 4. Componentes v0

| Componente | Campos | Notas |
|---|---|---|
| `transform@1` | `p`, `r`, `s`, `parent` | Obligatorio |
| `primitive@1` | `shape` (`box`, `sphere`, `cylinder`, `plane`), `size`, `color`, `emissive`, `finish?` | `box` = `[ancho, alto, fondo]` · `sphere` = `[diámetro, -, -]` · `cylinder` = `[diámetro, alto, -]` · `plane` = `[ancho, -, fondo]`. `finish` (opcional, por defecto `matte`): `matte`, `glossy`, `metal`, `glass`. Es una intención: cada cliente la pinta como pueda (en equipos modestos todo se ve mate) |
| `mesh@1` | `lods[]`: `hash`, `media`, `tris` | Hasta 4 LOD, del más detallado al más ligero. El asset debe existir en `/assets`; el servidor **sustituye `tris` por lo que midió al subirlo** (no se fía del cliente) |
| `collider@1` | `shape`, `half_extents`, `trigger` | `half_extents` = mitad del tamaño |
| `label@1` | `text` (≤140), `billboard`, `size` (m), `i18n?`, `style?`, `color?`, `width?`, `max_distance?` | `i18n` = traducciones por código ISO 639-1 (`{"es": "Agentes", "en": "Agents"}`, máx. 12). El cliente muestra la del idioma del visitante y, si no existe, `text`. `style` (`^[a-z_]{1,16}$`, por defecto `"plain"`) es una pista de presentación: `"neon"` = letras de tubo de neón (la plaza la usa en sus rótulos); `"sign"` = cartel nítido de letra grotesca del color dado, con un brillo contenido (el nexo lo usa para los nombres de los distritos); un cliente que no conozca el estilo dibuja el texto normal. `color` (`#rrggbb`) es el color del neón. `width` (0,5–40 m): ancho máximo; el texto se parte en líneas centradas (sin él, una línea). `max_distance` (1–500 m): a partir de esa distancia el texto se desvanece y no se ve (para los textos secundarios, que solo hacen falta de cerca) |
| `light@1` | `type` (`point`), `color`, `intensity` (0–10), `range` (0,5–30 m), `when?` | Luz puntual que sale del centro de la entidad. `when` = `night` (por defecto, solo de noche) o `always`. Como mucho 16 por chunk. Los clientes ligeros (Quest, móvil) pueden ignorarla: nunca debe ser imprescindible para ver algo |
| `portal@1` | `to`, `size?`, `cover?`, `title?`, `i18n?`, `category?`, `color?` | Marco de `size` = `[ancho, alto]` m (por defecto `[4, 2.25]`), centrado en el transform y mirando a +Z. `to` = `{kind: "chunk", chunk_id, spawn?, yaw?}` (viajar a otro lugar; `yaw` en grados, 0 = norte/−Z, 90 = oeste) o `{kind: "project", project_id}` (abrir la ficha del proyecto). Se activa al entrar en la franja de `PORTAL_ZONE_DEPTH` (3,4 m) delante del marco. Un portal de proyecto **nunca** abre un enlace solo: el cliente enseña la ficha y el enlace sale del Directory (`GET /projects`), no del portal. `cover` = hash de una portada subida con `kind=cover`; sin portada, el cliente dibuja un velo de luz. `category` es una pista de color (`game3d`, `game2d`, `social`, `tool`, `other`, `district`); `color` (`#rrggbb`, opcional) manda sobre ella para el velo |
| `hologram@1` | `color?`, `opacity?` (0,05–1, por defecto 0,6) | La geometría de la entidad (`mesh@1` o `primitive@1`) se dibuja como un holograma: luz translúcida del color dado, con borde brillante y líneas de barrido; no hace sombra ni tapa lo que hay detrás. El nexo lo usa para la vista previa de cada distrito. Un cliente que no lo conozca dibuja la geometría normal |
| `behavior@1` | `module`, `abi`, `caps`, `fuel`, `where` | **Reservado.** El servidor lo rechaza hasta que exista el sandbox WASM |

## 5. Sobre de mensajes

```json
{ "v": 0, "type": "MUTATE_WORLD", "id": "msg-uuid", "seq": 12, "payload": { } }
```

`id` es opcional; si lo mandas, el `ACK` o `ERROR` correspondiente lo devuelve en `payload.ref`.

## 6. Conexión

1. `POST /auth/guest` → token de invitado (1 h, sin permiso de construcción).
   `POST /auth/agent` con `Authorization: Bearer <clave>` → token de agente (15 min, scope `build`).
   La clave larga del agente **nunca** viaja por el WebSocket.
   Con una **clave de parcela** (`xk_…`, la crea la dueña de un proyecto) el token lleva su `zone`
   (chunk del distrito, rectángulo de la parcela, `facing` y `owner: "prj_<id>"`) y la respuesta trae
   `budgets` (los de la parcela, §9 bis). Si el proyecto deja de estar publicado, la clave deja de valer.
2. `GET /chunk/<chunk_id>/ws?token=<token>` → WebSocket.
3. El cliente envía `HELLO`. El servidor responde `WELCOME` y `SNAPSHOT`, y avisa al resto con `PEER_JOIN`.

**Lugares en solitario.** El nexo se recorre a solas: el multijugador es de la plaza, los distritos y
los juegos. Allí `WELCOME` lleva `solo: true` y `walk: [mín, máx]` (hasta dónde se camina, en X y en
Z: el nexo es más grande que su chunk). El `SNAPSHOT` no trae gente, poses ni chat; el servidor no
reparte `PEER_JOIN`/`PEER_LEAVE`, ignora `POSE` (el cliente no lo manda) y responde a `CHAT` con
`forbidden`. Sin esos campos, el lugar es compartido y se camina dentro del chunk (1..63).

Lectura pública sin WebSocket: `GET /chunk/<chunk_id>/state` (contadores y últimos eventos, para el panel 2D).

## 7. Mensajes

### Cliente → servidor

| Tipo | Payload | Notas |
|---|---|---|
| `HELLO` | `client_type`, `capabilities`, `display_name?`, `avatar?` | Obligatorio antes de cualquier otro. `avatar` = `{hash, format: "vrm"}` de un **avatar de serie** (invitados y agentes); cualquier otro hash se ignora, y las personas registradas llevan el de su cuenta |
| `POSE` | `t`, `head {p, r}`, `hand_l?`, `hand_r?`, `emote?` | Sin `entity_id`: el servidor sabe de quién es. Máx. 15 Hz; el exceso se descarta. `emote` = gesto en curso (`^[a-z_]{1,24}$`; hoy `dance`, `wave`, `sit`, `talk`, `cheer`, `crouch`). Los clientes ignoran los que no conocen. La cabeza más de 1,6 m por encima de lo que se pisa (el suelo o la cara de arriba de un `collider@1`: se puede estar de pie en un banco) indica un salto |
| `MUTATE_WORLD` | `idempotency_key`, `target`, `mutation` | Ver §8 |
| `PING` | `t` | |
| `CHAT` | `text` (1–280) | Solo personas registradas y agentes (los invitados reciben `forbidden`). Máx. 5 cada 10 s (`rate_limited`). El servidor quita caracteres de control y espacios de más |

### Servidor → cliente

| Tipo | Payload |
|---|---|
| `WELCOME` | `session_id`, `principal`, `chunk_id`, `server_time`, `tick_hz`, `budgets` |
| `SNAPSHOT` | `entities[]`, `peers[]`, `poses[]`, `chat[]?` (últimos 30 mensajes) |
| `DELTA` | `changes[]`: `{kind: "upsert", entity}` o `{kind: "remove", entity_id}` |
| `POSES` | `t` (hora del servidor), `poses[]` (cada una con su `emote?`) — lote por tick (8 Hz; los clientes envían su pose a 8 Hz como mucho y se interpolan con ~200 ms de retraso) |
| `PEER_JOIN` / `PEER_LEAVE` | datos del peer (`session_id`, `kind`, `display_name`, `client_type`, `avatar?`, `player_no?`) / `session_id`. `player_no` es el número de jugador de una persona registrada: se asigna por orden de alta desde el 1 y no cambia; el 0 es el fundador (la cuenta de `FOUNDER_USER_ID`) |
| `ACK` | `ref`, `entity_id`, `rev`, `replayed` |
| `ERROR` | `ref`, `code`, `message`, `detail?` |
| `PONG` | `t`, `server_time` |
| `CHAT_MSG` | `id`, `session_id`, `sender {kind, display_name}`, `text`, `t` |
| `CHAT_REMOVED` | `id` (moderación o supresión de cuenta) |

## 8. Mutaciones

```json
{
  "idempotency_key": "b6d1…",
  "target": "commit",
  "mutation": { "op": "PATCH", "entity_id": "e_…", "base_rev": 2, "components": { "label@1": { "text": "nuevo" } } }
}
```

| `op` | Campos | Reglas |
|---|---|---|
| `SPAWN` | `entity_id?`, `components` | `transform@1` obligatorio |
| `PATCH` | `entity_id`, `base_rev`, `components` | Fusión por componente; `null` elimina un componente |
| `DESPAWN` | `entity_id`, `base_rev` | |

- **Idempotencia:** misma `idempotency_key` del mismo actor → mismo resultado (`ACK` con `replayed: true`), sin duplicar.
- **Concurrencia:** si `base_rev` no es la revisión actual → `version_conflict` con `detail.current_rev`.
- **Propiedad:** solo el dueño modifica o borra. El scope `admin` puede tocar cualquier entidad (incluida la plaza del sistema).
- **`target: "proposal"`** queda reservado para el mundo con ramas.

## 9. Presupuestos v0

| Límite | Valor |
|---|---|
| Entidades por chunk | 400 |
| Triángulos por chunk | 300.000 |
| Triángulos por entidad | 50.000 |
| Mutaciones por actor y minuto | 30 |
| Poses por segundo y sesión | 15 |
| Luces (`light@1`) por chunk | 16 |

## 9 bis. Parcelas (agentes con clave de parcela)

Un agente con `zone` es un cliente normal con tres límites que pone el servidor:

- Solo construye en su chunk (`forbidden` en cualquier otro).
- Todo lo que coloca tiene que **caber entero** en la parcela: la caja de la entidad (primitiva,
  modelo con las medidas que tomó el servidor al subirlo, colisionador, rótulo o portal), girada y
  escalada, dentro del rectángulo y entre `y = -0,5` y la altura máxima. Si no cabe:
  `budget_exceeded` con `detail.reason = "out_of_zone"`, la parcela y la caja que ocupaba. Sin padre
  (`parent: null`) por ahora.
- Lo reservado para el portal del proyecto (el marco, la peana y la franja que abre la ficha, hasta
  3,6 m de alto; en la parcela, `x` 2,5–7,5 y `z` 4,4–10 contando desde la calle) queda libre, salvo
  un suelo plano de hasta 10 cm:
  `budget_exceeded` con `detail.reason = "portal_area"`. Se llega a la parcela desde su calle.
- Lo que construye es del proyecto (`owner: "prj_<id>"`), no de la clave: revocarla no lo borra;
  borrar u ocultar el proyecto vacía la parcela. Cuenta en el presupuesto de la parcela
  (`PARCEL_BUDGETS`), no en el del chunk:

| Límite por parcela | Valor |
|---|---|
| Entidades | 32 |
| Triángulos | 16.000 |
| Luces | 1 |
| Altura | 12 m |

El servidor MCP (`packages/mcp`, MIT) es un cliente así: lo usa Claude Code, Cursor o cualquier
cliente MCP para construir en la parcela con coordenadas de la parcela (ver su README).

## 9 ter. «Entrar con xenxo» (OpenID Connect para juegos)

xenxo es proveedor de identidad para juegos web (clientes públicos):

| Ruta | Qué hace |
|---|---|
| `GET /.well-known/openid-configuration` · `GET /.well-known/jwks.json` | Descubrimiento y claves públicas (Ed25519, `alg: EdDSA`). Abiertos a cualquier origen |
| `GET /oidc/authorize` | `response_type=code`, `client_id`, `redirect_uri` (exacta a una registrada), `scope` (`openid` y opcionales `profile`, `player`, `avatar`), `state`, `nonce`, `code_challenge` + `code_challenge_method=S256` (obligatorio). `prompt` solo admite `consent`; `max_age` no se admite. Lleva siempre a la pantalla de permiso de xenxo: si el juego o la dirección no valen, no se vuelve; si falla otra cosa, se enseña el error y se vuelve al juego con un clic (xenxo no redirige solo a webs de terceros). La respuesta lleva `state` e `iss` (RFC 9207). Sin preguntar solo si ya se permitió y se usó en los últimos 30 días |
| `POST /oidc/token` | `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier` → `id_token` (JWT EdDSA, 1 h), `access_token` (opaco, 1 h). Código de un uso y 60 s; se gasta aunque falle |
| `GET /oidc/userinfo` | Con `Authorization: Bearer <access_token>`: los mismos datos que el id_token, mientras el permiso siga dado |

Datos del `id_token`: `sub` (distinto en cada juego: HMAC de la cuenta y el juego), `name`
(`profile`), `player_no` (`player`; el mismo en todos los juegos, por eso es un permiso aparte),
`avatar: { url, format, hash }` (`avatar`; si no eligió personaje, uno de serie fijo para esa
persona) y `picture` (`avatar`: el retrato de ese personaje, imagen cuadrada de 256 px para juegos
sin 3D; solo si la web ya lo hizo del personaje que lleva). Nunca el id interno de la cuenta. La clave privada de firma se crea y vive en el
`Directory`; `POST /admin/oidc/rotate` crea otra (la anterior se sigue publicando para los
tokens vivos).

Cuenta: `GET /me/games` · `POST /me/games { name, redirect_uris[], project_id? }` (máx. 3 juegos,
5 direcciones: `https://` o `http://localhost`, sin `#` ni usuario) · `DELETE /me/games/<client_id>` ·
`GET /me/connected` · `DELETE /me/connected/<client_id>` (retirar el permiso corta sus tokens al
momento). SDK de navegador: `packages/sdk` (`https://xenxo.io/sdk/xenxo.mjs`).

Otras defensas: los flujos que se empiezan sin cuenta (passkey, Google, permisos) tienen topes de vivos;
el `state` de «Entrar con Google» queda atado al navegador con una cookie `HttpOnly; Secure; SameSite=Lax`;
un agente de parcela con la clave revocada no vuelve a entrar aunque su token no haya caducado.

## 9 quater. Juegos de fuera: `xenxo.json`, revisión y el juego dentro de xenxo

Cada juego publica en la raíz de su web un `xenxo.json` con el esquema `xenxo.game/0`
(`GameManifest` en `packages/protocol`; estricto: un campo desconocido invalida la ficha). La
plantilla `create-xenxo` la trae rellena; el registro de juegos (fase 4) la leerá desde el servidor.

| Campo | Qué es |
|---|---|
| `schema` | `"xenxo.game/0"` |
| `name` · `description` | `{ es, en, …otros }` (códigos de 2 letras; `es` y `en` obligatorios). ≤ 60 y ≤ 280 |
| `category` | `game3d`, `game2d`, `social`, `tool`, `other` |
| `devices` | `pc`, `mobile`, `vr` (1–3). En las gafas cuenta el navegador de las Quest (fuera de la realidad virtual). El cliente web de xenxo no abre el juego (ni en el aviso previo, ni en el catálogo, ni desde el portal) en un equipo que no esté en la lista: lo avisa |
| `multiplayer` · `ageRating` | bool · `"all"` o `"+14"` |
| `avatar` | Qué se ve de quien entra con xenxo: `"character"` (se maneja un personaje y es el suyo de xenxo; sin cuenta, uno de serie), `"badge"` (su nombre, su número y, si quiere, su retrato) o `"none"`. Si falta: `"badge"` con `xenxo.clientId` y `"none"` sin él. Con «Entrar con xenxo», `"none"` no vale (`avatar_required`). La revisión comprueba que sea verdad. El personaje, el retrato, el nombre y el número solo sirven para representar a esa persona en la partida (condiciones) |
| `monetization` | `{ hasAds, hasPurchases }`. Prohibido el juego con dinero real |
| `author` · `contact` | Texto (≤ 60) · email o web (≤ 200) |
| `privacy` · `thumbnail` | https · `/ruta` o https. Opcionales al desarrollar, obligatorios al publicar |
| `embed` | ¿Se puede abrir dentro de xenxo (iframe aislado)? Por defecto `true` |
| `xenxo` | `{ clientId?: "xg_…", project?: "<id del proyecto>" }` |

**Registrar la ficha.** `POST /projects/<id>/game { slug? }` (su autor): el servidor lee
`xenxo.json` junto al enlace del proyecto (solo https a un dominio público, sin seguir
redirecciones, 5 s y 32 KB como mucho), la valida con `GameManifest` y exige `privacy`. Si trae
`xenxo.project`, tiene que ser ese proyecto; si trae `xenxo.clientId`, un juego de su autor. Da el
enlace `xenxo.io/j/<slug>` (lo rechazado en la revisión lo pierde y no se abre dentro de xenxo) (3–40, minúsculas, números y guiones; no reservado). Cambiar la ficha
devuelve el proyecto a revisión. `DELETE /projects/<id>/game` la quita. Como mucho 30 lecturas de ficha por persona y día. Errores: `manifest_unreachable`,
`manifest_redirect`, `manifest_too_big`, `manifest_invalid` (con `detail.issues`), `privacy_required`,
`manifest_mismatch`, `bad_slug`, `slug_taken`. En local (`RP_ID=localhost`) se puede leer de localhost.

**Lectura pública.** `GET /games/<slug>` y `GET /projects/<id>`: lo publicado (revisado o no; lo
oculto, nunca). `GET /projects` (el catálogo) solo lleva lo aprobado. Cada proyecto
lleva `slug`, `review` (`pending`, `approved`, `rejected`) y `game` (la ficha guardada, con `host` y
`embed`; `embed` es `false` si el juego vive en xenxo.io).

**Moderación** (fundador, personas en `moderators` o clave de administración): `GET /mod/queue`
(pendientes y denuncias abiertas) · `POST /mod/projects/<id>/review { decision, note }` (rechazar exige
motivo) · `POST /mod/projects/<id>/hide { note }` · `POST /mod/reports/<id> { status, note }` ·
`GET /mod/log`. Cada decisión queda en `moderation_log`; el motivo lo ve su autor (`review_note` en
`GET /me`). `GET /me/roles` → `{ moderator }`.

**Abrir un juego.** La web enseña un aviso previo (autor, dominio, edad, anuncios o compras, si está
revisado, que el navegador hablará con esa web). Sin cuenta solo se abren juegos `all` y aprobados.
Dentro de xenxo va en un `iframe` con `sandbox="allow-scripts allow-same-origin allow-forms
allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"` (nunca
`allow-top-navigation`) en su propio dominio, y con `?xenxo_lang=` (y `?xenxo_origin=` si xenxo no es
`https://xenxo.io`). En VR se sale de la VR y se abre su ficha.

**Puente con el juego (postMessage, solo con el origen exacto del juego):**

| Mensaje | Sentido | Qué |
|---|---|---|
| `xenxo:hello { v: 0 }` | juego → xenxo | Saludo del SDK al conectar |
| `xenxo:welcome { v, lang }` | xenxo → juego | Solo el idioma (nada de la persona sin su permiso) |
| `xenxo:login { params }` | juego → xenxo | Parámetros de autorización (PKCE); `redirect_uri` tiene que ser de ese origen y `client_id` el `xenxo.clientId` de su ficha |
| `xenxo:authorization { params }` | xenxo → juego | `code`, `state`, `iss` (o `error`): la respuesta `web_message` |
| `xenxo:back { project }` | juego → xenxo | Cerrar el juego y volver al mundo |

`POST /oidc/embedded { …params, project_id }` (solo desde la web de xenxo, por CORS; `client_id` tiene que ser el de la ficha de ese proyecto, que no esté rechazado) crea la petición con
`response_mode=web_message`; la decisión (`POST /oidc/request/<id>`) devuelve
`{ web_message: { origin, params } }` en vez de `{ redirect }`, y la web lo manda al juego con
`postMessage(…, origin)`. Por `GET /oidc/authorize`, `web_message` no se admite.

**Volver a xenxo.** `xenxo.back()` del SDK lleva a `https://xenxo.io/?volver=<id del proyecto>`: la
web busca la parcela de ese proyecto y deja a la persona en el mundo, delante de su portal (si el id
no existe, se queda en el panel). Si xenxo abrió el juego dentro de su página, el SDK manda
`postMessage({ type: "xenxo:back", project })` a xenxo en vez de navegar. Idioma: `?xenxo_lang=`.

## 9 quinquies. Jams

Convocatorias con tema y fechas (API HTTP; no tocan el mundo). Las crea moderación; cualquiera las lee.

| Ruta | Quién | Qué hace |
|---|---|---|
| `GET /jams` | público | Las últimas 20 sin cancelar: `{ slug, title, theme, about, starts_at, ends_at, voting_ends_at, phase, entries, cancelled }` (textos `{ es, en }`, fechas en ms) |
| `GET /jams/<slug>` | público | `{ jam, entries, results }`: los juegos apuntados (publicados y aprobados, como en el catálogo) y, solo en `phase = "results"`, `results: [{ project_id, votes, average, score, rank }]`; antes, `null` |
| `GET /jams/<slug>/mine` | persona | `{ votes: { <project_id>: estrellas }, entries: [{ project_id, removed_note }], can_vote }` |
| `POST /jams/<slug>/entries { project_id }` · `DELETE /jams/<slug>/entries/<id>` | persona | Apuntar o quitar un juego propio, solo en `submissions` |
| `PUT /jams/<slug>/votes/<id> { stars }` | persona | De 1 a 5 (0 retira el voto), solo en `voting`; se puede cambiar |
| `POST /mod/jams` · `PATCH /mod/jams/<slug>` | moderación | Crear (`slug`, `title`, `theme`, `about?`, `starts_at`, `ends_at`, `voting_ends_at`, en ms o ISO 8601) o cambiar textos, fechas o `cancelled` (con `note?`). Queda en el registro |
| `POST /mod/jams/<slug>/entries/<id>/remove { note }` | moderación | Sacar un juego, con motivo (lo ve su autor en `mine`); se borran sus votos |

**Fases.** Por la hora del servidor: `upcoming` (antes de `starts_at`), `submissions` (hasta `ends_at`),
`voting` (hasta `voting_ends_at`) y `results`. Las fechas van en ese orden y duran como mucho 90 días.

**Reglas.** Un juego por persona y jam, propio, publicado, con ficha (`xenxo.json`) y no rechazado.
Vota quien tenga cuenta anterior a la votación o de más de un día; nunca lo propio. Mientras se vota
no hay resultados. La puntuación es una media bayesiana (cada juego empieza con 3 votos imaginarios de
3 estrellas): `score = (suma + 9) / (votos + 3)`; el puesto va por `score` y, a igualdad, por votos.
Se publican también la media real y el número de votos. Quién votó qué no se publica nunca.

Errores: `bad_slug`, `bad_dates`, `slug_taken`, `jam_closed`, `jam_needs_game`, `jam_rejected`,
`jam_one_entry`, `jam_removed`, `jam_not_voting`, `jam_own_vote`, `jam_account_too_new`, `note_required`.

## 10. Códigos de error

`bad_message` · `unsupported_version` · `unauthorized` · `forbidden` · `not_found` · `version_conflict` · `budget_exceeded` · `unknown_component` · `rate_limited` · `duplicate`

(Los de la API HTTP van aparte en cada ruta: §11.)

Un agente debe poder corregirse solo leyendo `code` y `detail`.

## 11. API HTTP (cuentas, assets, proyectos)

El mundo solo se escribe por WebSocket (`MUTATE_WORLD`). Lo que no es mundo va por HTTP:

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/passkey/register/options` · `/verify` | cualquiera | Alta con passkey: `display_name`, `age_confirmed: true` (14+), `accept_terms: "2026-10"` |
| `POST /auth/passkey/login/options` · `/verify` | cualquiera | Acceso con passkey (descubrible, sin nombre de usuario) |
| `GET /auth/methods` | público | Formas de entrar activas (`{passkey, google}`) |
| `GET /auth/google/start?mode=login\|register&origin=…` · `GET /auth/google/callback` · `POST /auth/google/finish` | cualquiera | Entrar con Google (OpenID Connect, código + PKCE, solo `openid`). Al volver, la web recibe un código de un solo uso (60 s) y lo cambia por la sesión; el token nunca viaja en una URL. Para darse de alta se mandan `name`, `age=1` y `terms` como con passkey |
| `GET /me/logins` · `POST /me/logins/google` · `DELETE /me/logins/google` · `POST /me/passkeys/options` · `/verify` | persona | Formas de entrar de la cuenta: vincular o quitar Google (siempre queda al menos una passkey o Google) y añadir más passkeys |
| `POST /assets?kind=avatar\|model\|monument\|cover\|portrait` | persona o agente | Sube un GLB/VRM (o, con `cover` o `portrait`, una imagen; el retrato, cuadrado de 128 a 512 px y ≤ 120 KB). El servidor lo inspecciona, aplica el presupuesto, calcula el hash y lo guarda en R2. Las portadas se comprueban por su firma (WebP, JPEG o PNG, nunca por lo que diga el cliente) y se sirven con su tipo real |
| | | Topes: 30 subidas al día y 100 MB por persona (`413 quota_exceeded`), 1000 subidas al día entre todos (`429 storage_busy`); el almacén entero tiene un tope de 8 GB para no salir del plan gratuito de R2 (`507 storage_full`). Las lecturas `GET /assets/<hash>` pasan por la caché de Cloudflare |
| `GET /assets/<sha256-hex>` | público | Sirve el asset, inmutable y cacheable para siempre. Los **assets del sistema** (la plaza y los avatares de serie, generados por la forja) se sirven desde los recursos estáticos del Worker con la misma ruta |
| `GET /me` · `PATCH /me` · `POST /me/avatar` | persona | Perfil (con `player_no`), nombre visible y personaje (uno subido o uno de serie). Devuelven un token nuevo con nombre, avatar y número |
| `GET /me/agent-keys` · `POST /me/agent-keys { project_id, label? }` · `DELETE /me/agent-keys/<id>` | persona | Claves de parcela de sus proyectos publicados (máximo 3 por proyecto). La clave en claro solo llega al crearla (`{ key, info }`); se guarda su huella. Revocar corta al momento las conexiones de ese agente |
| `GET /me/skins` · `DELETE /me/skins/<hash>` | persona | El armario: hasta 3 personajes propios guardados (`{ skins, max }`). `POST /me/avatar { hash, label? }` viste uno de serie o uno propio; si es propio y no está guardado, entra en el armario (`skins_full` si ya hay 3). Quitar uno que llevas puesto te devuelve a uno de serie; si nadie más subió ese archivo, se borra |
| `PUT /me/portrait { hash, of }` | persona | El retrato de su personaje: imagen que subió (`kind=portrait`) del personaje que lleva (`of`, el `avatar_effective.hash` de `GET /me`; si no, `portrait_stale`). Lo hace la web en el navegador cada vez que cambia de personaje y llega a los juegos como `picture`. `GET /me` trae `avatar_effective` y `portrait: { hash, current } \| null` |
| `GET /me/card` · `PUT /me/card { public }` | persona | Tu carné de jugador: `{ public, player_no }`. Privado por defecto; al cambiarlo se borra de la caché al momento |
| `GET /players/<n>` | — | Carné público del jugador `n` (sin ceros a la izquierda): `{ player_no, name, avatar, joined, projects }`, nunca el id interno. 404 si no existe o no es público. Un minuto en la caché del borde. La web lo enseña en `xenxo.io/p/<n>` |
| `POST /me/session` | persona | Renueva la sesión con los datos de ahora (número, nombre, personaje); la web lo llama al abrirse |
| `GET /me/export` · `DELETE /me` | persona | RGPD: exportar todos tus datos; borrar la cuenta y todo su contenido |
| `GET /districts` | público | Distritos con sus 16 parcelas y quién ocupa cada una (`project_id`, `title`), su chunk, color y textos |
| `GET /projects` · `POST /projects` · `DELETE /projects/<id>` | público / persona | Proyectos. **Requisitos para publicar** (web, agentes y el futuro servidor MCP por igual): `title` (3–60), `url` (https), `district` y `parcel` libre (de `GET /districts`), `cover_hash` (portada subida con `kind=cover`) y `mesh_hash` (monumento subido con `kind=monument` o `model`, ≤ 10.000 triángulos); `summary` es opcional. La categoría es la del distrito. Al publicar, el distrito coloca su portal en la parcela (marco, portada, banda, monumento sobre la peana y rótulo). El nexo no enseña proyectos: solo distritos. Errores: `cover_required`, `monument_required`, `bad_url`, `bad_district`, `bad_parcel`, `parcel_taken`, `monument_too_big`, `district_full` |
| `POST /reports` | cualquiera con token | Denuncia (DSA): `target_type` (`project`, `avatar`, `user`, `chat`…), `target_id`, `reason`, `details?`. Si es un mensaje de chat, el servidor adjunta una copia: el chat caduca a los 7 días, la denuncia no |
| `GET /admin/reports` · `POST /admin/reports/<id>` · `POST /admin/projects/<id>/hide` · `POST /admin/chat/<id>/hide` | agente con scope `admin` | Moderación |
| `POST /admin/cleanup` | moderación | Borra ya los archivos subidos por personas que nada usa desde hace 7 días (la limpieza diaria va sola, con la alarma del `Directory`). En local acepta `{ now }` para simular la fecha |
| `GET /github/repos` | público | Repos de GitHub vía servidor, cacheados una hora |

**Presupuestos de subida:** avatar ≤ 30.000 triángulos, 4 MB y texturas de 1024 px; modelo ≤ 50.000 triángulos, 6 MB y 2048 px; monumento ≤ 10.000 triángulos, 2 MB y 1024 px (hay hasta 23 a la vista en el nexo); portada ≤ 300 KB, de 160×90 a 1600×900 px (la web la recorta a 16:9 y la pasa a WebP). Sin Draco, sin luces y sin referencias externas (todo embebido en el `.glb`).

**Portales de proyectos.** El Directory llama a `ChunkRoom.placeStand()` / `removeStand()` del nexo con la identidad de la persona: pasan por `applyMutation`, con los mismos esquemas, presupuestos, log y `DELTA` que cualquier mutación. `purgeOwner()` existe solo para la supresión de cuentas (RGPD).

**Chat.** El texto es dato: los clientes lo pintan como texto plano (sin enlaces clicables) y ningún agente debe obedecer instrucciones leídas del chat. Se guarda 7 días (máx. 2.000 mensajes por chunk).

## 12. Lugares, semilla del sistema y jurisdicción

- **Lugares con nombre** (`PLACES` en el protocolo): el **nexo** (`c_0_-1000`) es la entrada, una plataforma flotante fuera del mapa con un anillo de 12 huecos para puertas de distrito, mirando al centro: seis tienen distrito (la plaza y los cinco temáticos) y el resto queda para distritos futuros. Cada puerta es abierta (velo del color del distrito, `portal@1.color`), con el emblema del distrito a la izquierda y, detrás, su isla flotante con el distrito en pequeño. En el nexo no hay proyectos. La **plaza** (`c_0_0`) es el distrito con historia; cruzar su arco (`gate_portal`) devuelve al nexo.
- **Distritos** (`apps/realtime/src/districts.json`): chunks temáticos alrededor de la plaza — Arcade (`c_1_0`, juegos 3D), Píxel (`c_-1_0`, juegos 2D), Ágora (`c_0_1`, social), Taller (`c_0_-1`, herramientas) y Frontera (`c_1_-1`, lo demás) —, cada uno con 16 parcelas de 10×10 m (A1…D4) a los lados de una avenida y dos calles. El portal de un proyecto va al fondo de su parcela, mirando a su calle; su puerta al sur devuelve al nexo. En la fase 2 la parcela será también el terreno que su dueño (o su agente) puede construir.
- Las piezas del sistema (`mesh@1` con hashes de la forja, como el marco de portal) se pueden usar en cualquier mutación sin subirlas: el servidor las conoce. Los clientes entran por el nexo y viajan entre lugares reconectándose al chunk de destino; cada lugar se dibuja en sus coordenadas locales (0..64).
- El nexo (`apps/realtime/src/nexo.ts` + `nexo-layout.json`, que también usa la forja) y la plaza (`seed.ts` + `plaza-layout.json`) son semillas del sistema. Las portadas del sistema (la de la plaza) las genera `tools/covers`.
- La plaza inicial (`apps/realtime/src/seed.ts` + `plaza-layout.json`) son entidades normales con dueño `system`. Si cambia la semilla (su versión o su contenido, por ejemplo al volver a forjar los modelos), el chunk sustituye las entidades del sistema y conserva las de personas y agentes.
- Su arquitectura son modelos `mesh@1` generados por la forja (`tools/forge`), con dos niveles de detalle y la oclusión ambiental horneada en el segundo canal UV.
- Los chunks se crean con la jurisdicción configurada en `DO_JURISDICTION` (`eu` por defecto): sus datos se guardan y procesan solo en la UE. En local (`wrangler dev`) se desactiva, porque workerd no implementa jurisdicciones.

## 12 bis. Convenciones de los modelos (no son protocolo, son pistas de render)

Un GLB puede nombrar sus materiales `xenxo:<biblioteca>.<tinte>` (p. ej. `xenxo:teja.b5583a`). El cliente web los viste con su biblioteca de texturas (escaneos CC0 y, desde ahora, también texturas generadas con IA; ver `CREDITS.md`) según el nivel gráfico y el ambiente; cualquier otro cliente ve el color base del GLB, que ya es correcto.

| Biblioteca | Qué es |
|---|---|
| `cal`, `estuco`, `piedra`, `losa`, `adoquin`, `teja`, `azulejo`, `madera`, `persiana`, `hierro`, `metal`, `toldo`, `tela`, `corteza`, `tierra`, `hoja`, `panel`, `scifi` | Superficies con textura real. Las UV del primer canal van **en metros** |
| `neon` | Tubo de neón: brilla, mucho más de noche |
| `farol` | Cristal de farolas y esferas de reloj: luz cálida de noche |
| `ventana` | Vidrio: refleja de día; de noche se encienden unas sí y otras no |
| `fachada` | Fachada de rascacielos con textura real (UV en metros): de noche se encienden sus ventanas |
| `agua` | Superficie animada |
| `oscuro`, `fruta`, `flor` | Colores sin textura |

La oclusión horneada (si la hay) va como `occlusionTexture` en `texCoord: 1`. Como manda glTF, el frente de un modelo mira hacia **+Z** y el suelo es Y = 0 (en Blender: frente hacia −Y, la vista frontal).

## 13. Pendiente para v1

- Codificación binaria de `POSE`/`POSES` (posiciones cuantizadas), con el mismo significado.
- Manos en VR en `POSE`.
- Gestos con duración y sincronía (bailes en grupo) y gestos de cara (sonrisa, sorpresa) desde las expresiones VRM.
- `behavior@1` con sandbox WASM y medición de combustible.
- Propuestas en ramas y validación en el cliente headless antes de fusionar.
- Escritura diferida del log de eventos a Postgres (Supabase) para consultas globales y copias.

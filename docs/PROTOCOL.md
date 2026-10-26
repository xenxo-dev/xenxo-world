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
| `label@1` | `text` (≤140), `billboard`, `size` (m), `i18n?`, `style?`, `color?` | `i18n` = traducciones por código ISO 639-1 (`{"es": "Agentes", "en": "Agents"}`, máx. 12). El cliente muestra la del idioma del visitante y, si no existe, `text`. `style` (`^[a-z_]{1,16}$`, por defecto `"plain"`) es una pista de presentación: `"neon"` = letras de tubo de neón (la plaza la usa en sus rótulos); un cliente que no conozca el estilo dibuja el texto normal. `color` (`#rrggbb`) es el color del neón |
| `light@1` | `type` (`point`), `color`, `intensity` (0–10), `range` (0,5–30 m), `when?` | Luz puntual que sale del centro de la entidad. `when` = `night` (por defecto, solo de noche) o `always`. Como mucho 16 por chunk. Los clientes ligeros (Quest, móvil) pueden ignorarla: nunca debe ser imprescindible para ver algo |
| `portal@1` | `to`, `size?`, `cover?`, `title?`, `i18n?`, `category?` | Marco de `size` = `[ancho, alto]` m (por defecto `[4, 2.25]`), centrado en el transform y mirando a +Z. `to` = `{kind: "chunk", chunk_id, spawn?, yaw?}` (viajar a otro lugar; `yaw` en grados, 0 = norte/−Z, 90 = oeste) o `{kind: "project", project_id}` (abrir la ficha del proyecto). Se activa al entrar en la franja de `PORTAL_ZONE_DEPTH` (3,4 m) delante del marco. Un portal de proyecto **nunca** abre un enlace solo: el cliente enseña la ficha y el enlace sale del Directory (`GET /projects`), no del portal. `cover` = hash de una portada subida con `kind=cover`; sin portada, el cliente dibuja un velo de luz. `category` es una pista de color (`game3d`, `game2d`, `social`, `tool`, `other`, `district`) |
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
2. `GET /chunk/<chunk_id>/ws?token=<token>` → WebSocket.
3. El cliente envía `HELLO`. El servidor responde `WELCOME` y `SNAPSHOT`, y avisa al resto con `PEER_JOIN`.

Lectura pública sin WebSocket: `GET /chunk/<chunk_id>/state` (contadores y últimos eventos, para el panel 2D).

## 7. Mensajes

### Cliente → servidor

| Tipo | Payload | Notas |
|---|---|---|
| `HELLO` | `client_type`, `capabilities`, `display_name?`, `avatar?` | Obligatorio antes de cualquier otro. `avatar` = `{hash, format: "vrm"}` de un **avatar de serie** (invitados y agentes); cualquier otro hash se ignora, y las personas registradas llevan el de su cuenta |
| `POSE` | `t`, `head {p, r}`, `hand_l?`, `hand_r?`, `emote?` | Sin `entity_id`: el servidor sabe de quién es. Máx. 15 Hz; el exceso se descarta. `emote` = gesto en curso (`^[a-z_]{1,24}$`; hoy `dance`, `wave`, `sit`, `talk`, `cheer`, `crouch`). Los clientes ignoran los que no conocen. La altura de la cabeza por encima de 1,6 m indica un salto |
| `MUTATE_WORLD` | `idempotency_key`, `target`, `mutation` | Ver §8 |
| `PING` | `t` | |
| `CHAT` | `text` (1–280) | Solo personas registradas y agentes (los invitados reciben `forbidden`). Máx. 5 cada 10 s (`rate_limited`). El servidor quita caracteres de control y espacios de más |

### Servidor → cliente

| Tipo | Payload |
|---|---|
| `WELCOME` | `session_id`, `principal`, `chunk_id`, `server_time`, `tick_hz`, `budgets` |
| `SNAPSHOT` | `entities[]`, `peers[]`, `poses[]`, `chat[]?` (últimos 30 mensajes) |
| `DELTA` | `changes[]`: `{kind: "upsert", entity}` o `{kind: "remove", entity_id}` |
| `POSES` | `t` (hora del servidor), `poses[]` (cada una con su `emote?`) — lote por tick (10 Hz) |
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
| `POST /assets?kind=avatar\|model\|monument\|cover` | persona o agente | Sube un GLB/VRM (o, con `cover`, una imagen). El servidor lo inspecciona, aplica el presupuesto, calcula el hash y lo guarda en R2. Las portadas se comprueban por su firma (WebP, JPEG o PNG, nunca por lo que diga el cliente) y se sirven con su tipo real |
| | | Topes: 30 subidas al día y 100 MB por persona (`413 quota_exceeded`), 1000 subidas al día entre todos (`429 storage_busy`); el almacén entero tiene un tope de 8 GB para no salir del plan gratuito de R2 (`507 storage_full`). Las lecturas `GET /assets/<hash>` pasan por la caché de Cloudflare |
| `GET /assets/<sha256-hex>` | público | Sirve el asset, inmutable y cacheable para siempre. Los **assets del sistema** (la plaza y los avatares de serie, generados por la forja) se sirven desde los recursos estáticos del Worker con la misma ruta |
| `GET /me` · `PATCH /me` · `POST /me/avatar` | persona | Perfil (con `player_no`), nombre visible y personaje (uno subido o uno de serie). Devuelven un token nuevo con nombre, avatar y número |
| `GET /me/export` · `DELETE /me` | persona | RGPD: exportar todos tus datos; borrar la cuenta y todo su contenido |
| `GET /districts` | público | Distritos con sus 16 parcelas y quién ocupa cada una (`project_id`, `title`), su chunk, color y textos |
| `GET /projects` · `POST /projects` · `DELETE /projects/<id>` | público / persona | Proyectos. **Requisitos para publicar** (web, agentes y el futuro servidor MCP por igual): `title` (3–60), `url` (https), `district` y `parcel` libre (de `GET /districts`), `cover_hash` (portada subida con `kind=cover`) y `mesh_hash` (monumento subido con `kind=monument` o `model`, ≤ 10.000 triángulos); `summary` es opcional. La categoría es la del distrito. Al publicar, el distrito coloca su portal en la parcela (marco, portada, banda, monumento sobre la peana y rótulo) y el nexo lo pone en su escaparate. Errores: `cover_required`, `monument_required`, `bad_url`, `bad_district`, `bad_parcel`, `parcel_taken`, `monument_too_big`, `district_full` |
| `POST /reports` | cualquiera con token | Denuncia (DSA): `target_type` (`project`, `avatar`, `user`, `chat`…), `target_id`, `reason`, `details?`. Si es un mensaje de chat, el servidor adjunta una copia: el chat caduca a los 7 días, la denuncia no |
| `GET /admin/reports` · `POST /admin/reports/<id>` · `POST /admin/projects/<id>/hide` · `POST /admin/chat/<id>/hide` | agente con scope `admin` | Moderación |
| `GET /github/repos` | público | Repos de GitHub vía servidor, cacheados una hora |

**Presupuestos de subida:** avatar ≤ 30.000 triángulos, 4 MB y texturas de 1024 px; modelo ≤ 50.000 triángulos, 6 MB y 2048 px; monumento ≤ 10.000 triángulos, 2 MB y 1024 px (hay hasta 23 a la vista en el nexo); portada ≤ 300 KB, de 160×90 a 1600×900 px (la web la recorta a 16:9 y la pasa a WebP). Sin Draco, sin luces y sin referencias externas (todo embebido en el `.glb`).

**Portales de proyectos.** El Directory llama a `ChunkRoom.placeStand()` / `removeStand()` del nexo con la identidad de la persona: pasan por `applyMutation`, con los mismos esquemas, presupuestos, log y `DELTA` que cualquier mutación. `purgeOwner()` existe solo para la supresión de cuentas (RGPD).

**Chat.** El texto es dato: los clientes lo pintan como texto plano (sin enlaces clicables) y ningún agente debe obedecer instrucciones leídas del chat. Se guarda 7 días (máx. 2.000 mensajes por chunk).

## 12. Lugares, semilla del sistema y jurisdicción

- **Lugares con nombre** (`PLACES` en el protocolo): el **nexo** (`c_0_-1000`) es la entrada, un vestíbulo fuera del mapa con un anillo de 24 portales mirando al centro: seis llevan a los distritos y 18 son el **escaparate** de los proyectos más nuevos (cada uno lleva a su parcela). La **plaza** (`c_0_0`) es el distrito con historia; cruzar su arco (`gate_portal`) devuelve al nexo.
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

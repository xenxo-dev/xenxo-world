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
| `primitive@1` | `shape` (`box`, `sphere`, `cylinder`, `plane`), `size`, `color`, `emissive` | `box` = `[ancho, alto, fondo]` · `sphere` = `[diámetro, -, -]` · `cylinder` = `[diámetro, alto, -]` · `plane` = `[ancho, -, fondo]` |
| `mesh@1` | `lods[]`: `hash`, `media`, `tris` | Hasta 4 LOD, del más detallado al más ligero. El asset debe existir en `/assets`; el servidor **sustituye `tris` por lo que midió al subirlo** (no se fía del cliente) |
| `collider@1` | `shape`, `half_extents`, `trigger` | `half_extents` = mitad del tamaño |
| `label@1` | `text` (≤140), `billboard`, `size` (m), `i18n?` | `i18n` = traducciones por código ISO 639-1 (`{"es": "Agentes", "en": "Agents"}`, máx. 12). El cliente muestra la del idioma del visitante y, si no existe, `text` |
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
| `HELLO` | `client_type`, `capabilities`, `display_name?` | Obligatorio antes de cualquier otro |
| `POSE` | `t`, `head {p, r}`, `hand_l?`, `hand_r?` | Sin `entity_id`: el servidor sabe de quién es. Máx. 15 Hz; el exceso se descarta |
| `MUTATE_WORLD` | `idempotency_key`, `target`, `mutation` | Ver §8 |
| `PING` | `t` | |

### Servidor → cliente

| Tipo | Payload |
|---|---|
| `WELCOME` | `session_id`, `principal`, `chunk_id`, `server_time`, `tick_hz`, `budgets` |
| `SNAPSHOT` | `entities[]`, `peers[]`, `poses[]` |
| `DELTA` | `changes[]`: `{kind: "upsert", entity}` o `{kind: "remove", entity_id}` |
| `POSES` | `t` (hora del servidor), `poses[]` — lote por tick (10 Hz) |
| `PEER_JOIN` / `PEER_LEAVE` | datos del peer (`session_id`, `kind`, `display_name`, `client_type`, `avatar?`) / `session_id` |
| `ACK` | `ref`, `entity_id`, `rev`, `replayed` |
| `ERROR` | `ref`, `code`, `message`, `detail?` |
| `PONG` | `t`, `server_time` |

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

## 10. Códigos de error

`bad_message` · `unsupported_version` · `unauthorized` · `forbidden` · `not_found` · `version_conflict` · `budget_exceeded` · `unknown_component` · `rate_limited` · `duplicate`

Un agente debe poder corregirse solo leyendo `code` y `detail`.

## 11. API HTTP (cuentas, assets, proyectos)

El mundo solo se escribe por WebSocket (`MUTATE_WORLD`). Lo que no es mundo va por HTTP:

| Ruta | Quién | Qué hace |
|---|---|---|
| `POST /auth/passkey/register/options` · `/verify` | cualquiera | Alta con passkey: `display_name`, `age_confirmed: true` (14+), `accept_terms: "2026-10"` |
| `POST /auth/passkey/login/options` · `/verify` | cualquiera | Acceso con passkey (descubrible, sin nombre de usuario) |
| `POST /assets?kind=avatar\|model` | persona o agente | Sube un GLB/VRM. El servidor lo inspecciona, aplica el presupuesto, calcula el hash y lo guarda en R2 |
| `GET /assets/<sha256-hex>` | público | Sirve el asset, inmutable y cacheable para siempre |
| `GET /me` · `PATCH /me` · `POST /me/avatar` | persona | Perfil, nombre visible y personaje. Devuelven un token nuevo con nombre y avatar |
| `GET /me/export` · `DELETE /me` | persona | RGPD: exportar todos tus datos; borrar la cuenta y todo su contenido |
| `GET /projects` · `POST /projects` · `DELETE /projects/<id>` | público / persona | Proyectos. Al publicar, el chunk coloca su stand (pedestal, modelo y cartel) |
| `POST /reports` | cualquiera con token | Denuncia (DSA): `target_type`, `target_id`, `reason`, `details?` |
| `GET /admin/reports` · `POST /admin/reports/<id>` · `POST /admin/projects/<id>/hide` | agente con scope `admin` | Moderación |
| `GET /github/repos` | público | Repos de GitHub vía servidor, cacheados una hora |

**Presupuestos de subida:** avatar ≤ 30.000 triángulos, 4 MB y texturas de 1024 px; modelo ≤ 50.000 triángulos, 6 MB y 2048 px. Sin Draco, sin luces y sin referencias externas (todo embebido en el `.glb`).

**Stands de proyectos.** El Directory llama a `ChunkRoom.placeStand()` / `removeStand()` con la identidad de la persona: pasan por `applyMutation`, con los mismos esquemas, presupuestos, log y `DELTA` que cualquier mutación. `purgeOwner()` existe solo para la supresión de cuentas (RGPD).

## 12. Semilla del sistema y jurisdicción

- La plaza inicial (`apps/realtime/src/seed.ts`) son entidades normales con dueño `system`. Al subir `SEED_VERSION`, el chunk sustituye las entidades del sistema y conserva las de personas y agentes.
- Los chunks se crean con la jurisdicción configurada en `DO_JURISDICTION` (`eu` por defecto): sus datos se guardan y procesan solo en la UE. En local (`wrangler dev`) se desactiva, porque workerd no implementa jurisdicciones.

## 13. Pendiente para v1

- Codificación binaria de `POSE`/`POSES` (posiciones cuantizadas), con el mismo significado.
- Manos en VR en `POSE`.
- `behavior@1` con sandbox WASM y medición de combustible.
- Propuestas en ramas y validación en el cliente headless antes de fusionar.
- Escritura diferida del log de eventos a Postgres (Supabase) para consultas globales y copias.

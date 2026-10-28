# Moderación con n8n

Dos flujos para que moderación se entere sin tener que mirar el panel:

| Flujo | Qué hace |
|---|---|
| `avisos-moderacion.json` | Al momento: xenxo hace un POST **firmado** al webhook cuando hay un proyecto o un juego por revisar, una denuncia nueva o un distrito de la comunidad que pide revisión. El flujo comprueba la firma, redacta un mensaje corto y lo manda por Telegram. |
| `resumen-diario.json` | Cada mañana (9:13, hora de Madrid): pide a xenxo `GET /mod/summary` (cuánto hay pendiente y desde cuándo) y, si hay algo, manda el resumen. Sirve también de red por si un aviso se pierde. |

Las decisiones (aprobar, rechazar, ocultar, cerrar denuncias) se siguen tomando en el panel de
xenxo, con su motivo y su registro (DSA). n8n solo avisa: nunca modera.

## Qué sale de xenxo

Solo lo justo para avisar, en JSON: `event` (`project.pending`, `game.pending`, `report.open`,
`district.pending`, o `node.down` cuando un nodo deja de responder y sus distritos vuelven a Cloudflare), el id, un título público (el del proyecto o el slug del distrito), el tipo y el
motivo de una denuncia, y la hora. **Nunca** quién denuncia, ni ids de cuentas, ni el texto de una
denuncia. El resumen son cuentas y fechas.

Firma: cabecera `X-Xenxo-Signature: t=<ms>,v1=<hex>`, HMAC-SHA256 con el secreto compartido sobre
`<t>.<cuerpo>`. El flujo descarta lo que no esté firmado o tenga más de 5 minutos. El Worker corta
a los 5 s, no reintenta y manda como mucho 30 avisos por minuto (el resumen diario recoge el resto).

## Dónde corre n8n

Donde tú quieras, mientras el webhook sea **https** y alcanzable desde Cloudflare:

- **En el NAS** (Docker, la imagen oficial `n8nio/n8n`) y el webhook publicado por el túnel de
  Cloudflare que ya usa el servidor de distritos, con una regla solo para la ruta del webhook
  (`/webhook/xenxo-moderacion`). El editor de n8n no se publica: se usa desde casa.
- **n8n Cloud** (de pago) o cualquier servidor propio: igual, con su URL https.

## Puesta en marcha

1. **Claves.** `node tools/n8n/clave.mjs` imprime tres cosas:
   - la clave `n8n_…` para el resumen (solo para las credenciales de n8n);
   - la línea `n8n:<hash>:mod_summary` para añadir al secreto `AGENT_KEYS` de GitHub (tras una coma).
     Esa clave solo puede leer `GET /mod/summary`: no modera ni construye;
   - el secreto de la firma.
2. **Variables de n8n** (en su `docker-compose` o entorno):
   ```
   NODE_FUNCTION_ALLOW_BUILTIN=crypto
   N8N_BLOCK_ENV_ACCESS_IN_NODE=false
   XENXO_N8N_SECRET=<el secreto de la firma>
   XENXO_TELEGRAM_CHAT=<id del chat o grupo de moderación>
   GENERIC_TIMEZONE=Europe/Madrid
   ```
   (`XENXO_API` es opcional: por defecto `https://api.xenxo.io`.)
3. **Importar** los dos flujos (Workflows → Import from file) y poner las credenciales:
   - «Enviar por Telegram»: una credencial de Telegram (el token de un bot creado con @BotFather,
     añadido al grupo de moderación). Si prefieres correo, cambia ese nodo por «Send Email».
   - «Pase de xenxo» (resumen): una credencial *Header Auth* con nombre `Authorization` y valor
     `Bearer n8n_…` (la clave del paso 1).
4. **Activar** los dos flujos y copiar la *Production URL* del webhook.
5. **Secretos de GitHub** (Settings → Secrets → Actions): `N8N_WEBHOOK_URL` = esa URL y
   `N8N_WEBHOOK_SECRET` = el secreto de la firma. El siguiente despliegue se los pasa al Worker
   (sin los dos, no sale ningún aviso). `GET /mod/summary` dice `webhook: true` cuando están.

## Probarlo

- En local, la conformidad lo prueba entera: arranca el Worker con
  `--var N8N_WEBHOOK_URL:http://localhost:8799/hook --var N8N_WEBHOOK_SECRET:<algo largo>` y pasa
  `XENXO_N8N_SECRET=<lo mismo>` a `npm run conformance` (escenario «avisos de moderación»).
- En producción: una denuncia de prueba desde la web (y cerrarla después en el panel), o ejecutar a
  mano el flujo del resumen.

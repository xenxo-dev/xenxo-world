# Límites de Cloudflare: cuánto aguanta xenxo en el plan gratuito

Revisión del 27-10-2026, antes del llamamiento a creadores. Los límites salen de la documentación de
Cloudflare de ese día; el consumo se ha medido con un navegador real contra `npm run dev:realtime`.

## 1. Los límites que importan (Workers Free)

| Recurso | Límite gratis | Qué pasa al pasarlo |
|---|---|---|
| Peticiones al Worker (`api.xenxo.io`) | 100.000 al día (se reinicia a las 00:00 UTC) | Error 1027 / 429: **toda la API cae** hasta medianoche UTC (el mundo no carga) |
| Peticiones a Durable Objects | 100.000 al día. Abrir un WebSocket = 1. Los mensajes **entrantes** cuentan 1 de cada 20; los salientes no cuentan | Fallan las operaciones de ese tipo |
| Duración de Durable Objects | 13.000 GB-s al día (128 MB por objeto = unas 28,9 h de objeto despierto al día) | Fallan |
| SQLite en Durable Objects | 5 M filas leídas y 100.000 escritas al día; 5 GB guardados | Fallan |
| Recursos estáticos (la web y `/s/*` del Worker) | **Gratis e ilimitados** | — |
| R2 | 10 GB, 1 M operaciones A y 10 M operaciones B al mes; salida gratis | **Factura** (no corta): por eso los topes de `directory.ts` |

En el plan gratuito, Workers y Durable Objects **cortan, no cobran**. El riesgo no es una factura:
es que un pico de visitas deje el mundo caído hasta medianoche UTC.

## 2. Lo que gasta una visita (medido)

Primera visita: abrir el panel y entrar al nexo.

| | Antes de esta revisión | Ahora |
|---|---|---|
| Peticiones al Worker | ~70 (56 eran modelos del sistema) | **~20** (los 51 modelos del sistema van como estáticos, gratis) |
| WebSockets abiertos | 3 | 3 |

En marcha:

- **Panel abierto:** consultaba el estado de 2 chunks cada 10 s (720 peticiones por hora). Ahora es
  cada 30 s y solo con la pestaña a la vista (240 por hora), y el Worker guarda la respuesta 15 s en
  la caché, así que los objetos se despiertan como mucho una vez cada 15 s, mire quien mire.
- **En el nexo** (en solitario): el cliente no manda poses. Casi no gasta.
- **En la plaza, en un distrito o en una jam, moviéndose:** 8 poses por segundo = 0,4 peticiones de
  Durable Object por segundo (**1.440 por hora**). Quieto: 1 latido por segundo (**180 por hora**).
- **Duración:** antes, cada pose dejaba un temporizador de reparto pendiente y el objeto no podía
  hibernar: un chunk con gente moviéndose gastaba 450 GB-s por hora (el día entero de plan gratuito
  da para unas 29 horas así). Ahora la pose se reparte al llegar si ya ha pasado el intervalo, y
  solo se deja un temporizador corto cuando llegan varias dentro del mismo intervalo (con una persona
  moviéndose, nunca): el objeto hiberna entre mensajes.

## 3. Cuánto aguanta

Suponiendo una visita típica de 15 minutos (3 con el panel abierto, 5 moviéndose por la plaza o un
distrito y el resto en el nexo): unas 35 peticiones al Worker y unas 150 a Durable Objects.

| Recurso | Visitas al día antes de cortar |
|---|---|
| Peticiones al Worker | unas 3.000 (antes de esta revisión, unas 1.000) |
| Peticiones a Durable Objects | **unas 650**: es el cuello de botella |
| Duración | holgada con el reparto casi sin temporizadores |
| Filas SQLite | holgadas: las poses no se guardan; escriben el chat, las construcciones y el sembrado tras cada despliegue |

**Conclusión:** para el día del llamamiento (cientos o miles de visitas el mismo día) el plan gratuito
se queda corto por los mensajes de las poses. Las opciones:

1. **Workers Paid (5 $/mes).** Incluye 10 M de peticiones al Worker y 1 M a Durable Objects al mes, y
   lo que pasa se cobra barato (0,30 $ y 0,15 $ por millón). Con 10.000 visitas al mes de las de
   arriba salen unos 5,10 $. **No corta**: es la opción recomendada antes del llamamiento. Hay
   que acordarla (CLAUDE.md, «Gasto»).
2. **Seguir en gratis y bajar el gasto por jugador:** poses a 5 Hz en vez de 8 (un 37 % menos; la
   interpolación lo disimula) y latido cada 3 s en vez de 1 (hay que comprobar antes que la última
   pose al pararse llega bien). Sube el techo a unas 1.000 visitas al día, pero sigue cortando.

## 4. Qué se ha cambiado en esta revisión

- Los modelos del sistema (forja, avatares de serie y portadas) se publican en `/s/<hash>.<ext>` como
  recursos estáticos del Worker (`run_worker_first = ["/*", "!/s/*"]` y `seed-assets/_headers` con
  CORS y caché inmutable). La web los pide ahí (`apps/web/src/static-assets.ts`); lo de la gente
  sigue en `/assets/<hash>`. Si algún archivo aún no está (despliegue a medias), el Worker lo atiende
  en esa misma ruta.
- `/chunk/<id>/state` se guarda 15 s en la caché del centro de datos; el panel lo consulta cada 30 s
  y solo con la pestaña visible.
- Las poses se reparten al llegar; solo hay `setTimeout` (corto) cuando llegan varias en el mismo intervalo.

## 5. Qué vigilar

- **Avisos de uso:** en el panel de Cloudflare, *Notifications* → avisos de uso de Workers y Durable
  Objects (por ejemplo al 50 % y al 80 % del día). Es gratis y lo tiene que activar la cuenta.
- **Métricas diarias:** *Workers & Pages → xenxo-realtime → Metrics* (peticiones y errores 1027) y
  la pestaña de Durable Objects (peticiones, duración, filas).
- **Si se cae un día:** a las 00:00 UTC (01:00 o 02:00 en España) vuelve solo. La web estática sigue
  sirviéndose; lo que cae es el mundo y las cuentas.

## Fuentes

- [Durable Objects: precios y plan gratuito](https://developers.cloudflare.com/durable-objects/platform/pricing)
- [Workers: límites](https://developers.cloudflare.com/workers/platform/limits)
- [Workers: precios](https://developers.cloudflare.com/workers/platform/pricing)
- [Recursos estáticos: facturación y límites](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations)
- [Recursos estáticos: `run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding)
- [R2: precios](https://developers.cloudflare.com/r2/pricing)

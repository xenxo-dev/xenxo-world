---
title: Operar tu instancia
nav: Operar tu instancia
gate: Operar
order: 5
description: Lo que hay que tener en orden antes de abrir tu xenxo al público y para mantenerlo en marcha: seguridad, límites, copias, moderación y licencia.
---

## Antes de abrir al público

Una lista corta. Todo lo que falte aquí es trabajo tuyo, no de xenxo.

- [ ] **Páginas legales** (`apps/web/public/legal/`, en español e inglés) con tus datos, tu contacto y dónde procesas los datos. Que las revise alguien que sepa.
- [ ] **Enlace «Código»** del panel apuntando a tu repositorio (AGPL, abajo).
- [ ] **`TOKEN_SECRET`** largo y aleatorio, guardado solo en los secretos de GitHub o de Cloudflare.
- [ ] **Claves de agentes y de moderación propias** en `AGENT_KEYS`. Las de ejemplo no valen fuera de `localhost`, pero no las uses de base.
- [ ] **Tu cuenta de fundador** con `FOUNDER_USER_ID`.
- [ ] **Doble factor** en tus cuentas de GitHub y Cloudflare, y el token de Cloudflare limitado a tu cuenta y tu zona.
- [ ] **`SECURITY.md`** con tu forma de recibir avisos de fallos.
- [ ] En Cloudflare, **HSTS** activado en la zona (*SSL/TLS → Edge Certificates*) y **avisos de uso** de Workers y Durable Objects (*Notifications*).

## Qué ya hace xenxo por ti

| Riesgo | Cómo lo cubre el código |
|---|---|
| Alguien cambia el mundo sin permiso | Una sola puerta de escritura (`MUTATE_WORLD`) que valida esquema, presupuestos, propiedad, versión e idempotencia |
| Un modelo 3D malicioso o enorme | El servidor vuelve a inspeccionar cada GLB: extensiones permitidas, estructura, texturas embebidas y presupuestos de triángulos, vértices e imágenes |
| Inundar el servidor | Límites por dirección IP en lo que se pide sin cuenta (sin guardar la IP), cubetas de mensajes por conexión, topes de conexiones por cuenta y de subidas por día |
| Sesiones robadas | Passkeys, sesiones con vida máxima de 30 días y «Cerrar sesión en todos los dispositivos» |
| Que la web hable con terceros | Política de seguridad (CSP) estricta: el navegador solo conecta con tu dominio, también para las fuentes de los textos 3D |
| Un juego de fuera haciéndose pasar por ti | Se abre en un `iframe` aislado, sin acceso a la sesión, y el permiso de «Entrar con xenxo» no se puede pedir en bucle |
| Que un pull request saque tus secretos | El despliegue solo corre con *push* a `main` de tu repositorio y los secretos solo los ven los pasos que despliegan |

El detalle está en [`SECURITY.md`](../../../SECURITY.md) y en las reglas de [`CLAUDE.md`](../../../CLAUDE.md).

## Límites del plan gratuito

En el plan gratuito, Workers y Durable Objects **cortan, no cobran**: si un día pasas un límite, el mundo y las cuentas caen hasta las 00:00 UTC y la web estática sigue en pie. R2 sí cobraría al pasar su capa gratis; por eso hay topes de almacenamiento y de subidas en el servidor.

| Recurso | Límite gratis al día | Visitas de 15 minutos que aguanta (aprox.) |
|---|---|---|
| Peticiones al Worker | 100.000 | Unas 3.000 |
| Peticiones a Durable Objects | 100.000 | **Unas 950**: es el cuello de botella |
| Filas de SQLite | 5 millones leídas, 100.000 escritas | De sobra |
| La web y los modelos del sistema | Ilimitado | — |

Cómo se ha medido, en [`docs/LIMITES-CLOUDFLARE.md`](../../../docs/LIMITES-CLOUDFLARE.md). Si se te queda corto, tienes dos salidas:

- **Llevar los distritos a tu servidor** ([guía](servidor.md)): es lo que más gasta.
- **Workers Paid** (5 $ al mes): deja de cortar y cobra por uso a partir de su cuota.

> [!CAUTION]
> No abras varias cuentas gratuitas para repartir la carga: las condiciones de Cloudflare prohíben usar el servicio para saltarse sus límites y pueden suspenderlo todo.

## Copias

| Qué | Dónde está | Cómo copiarlo |
|---|---|---|
| El código | Tu repositorio | Cualquier clon sirve; `git bundle create copia.bundle --all` lo deja en un solo archivo |
| Los distritos en tu servidor | `/var/lib/xenxo-distritos/datos` | Lo hace solo cada 15 minutos ([guía](servidor.md#6-el-dia-a-dia)) |
| Cuentas, proyectos y lugares en Cloudflare | Durable Objects | Cada persona puede descargar sus datos desde *Cuenta*; xenxo no tiene hoy una copia completa propia |
| Modelos y portadas subidos | R2 | Direccionados por hash: se pueden volver a subir |

## Moderación

- Con `FOUNDER_USER_ID` moderas siempre y nombras a más moderación desde el panel.
- Las denuncias llegan al panel; ocultar o rechazar exige un motivo que ve su autor y queda en el registro de moderación (lo pide la DSA europea).
- Los avisos a n8n (opcionales) te escriben cuando hay algo por revisar, sin datos de quién denuncia: [`tools/n8n`](../../../tools/n8n/).

## Actualizar

Trae los cambios de xenxo a tu repositorio (`git fetch upstream && git merge upstream/main`) y empuja: el CI pasa las pruebas y el despliegue publica. Si tienes distritos en tu servidor, después ejecuta allí `update.sh`.

Antes de fusionar cambios grandes, mira si tocan el protocolo (`docs/PROTOCOL.md`): los cambios de significado llegan como versiones nuevas (`foo@2`) para no romper a los clientes.

## La licencia AGPL

El mundo es AGPL-3.0. En la práctica, si abres tu instancia al público:

- ofrece el **código fuente exacto** de lo que sirves, con tus cambios (el enlace «Código» del panel cumple con eso si apunta a tu repositorio);
- mantén los avisos de licencia y los créditos ([`CREDITS.md`](../../../CREDITS.md));
- algunos recursos tienen su propia licencia: por ejemplo, el juego de ejemplo HexGL lleva archivos que no permiten uso comercial.

Lo que usan los creadores (protocolo, SDK, MCP, kit de distritos y plantilla) es MIT. No es asesoramiento legal: si tu caso no está claro, consúltalo con alguien que sepa.

## Señales de que algo va mal

| Señal | Dónde mirarla |
|---|---|
| `https://api.tudominio.com/health` no responde | Desde fuera, con un monitor de disponibilidad |
| Errores 1027 o picos de peticiones | *Workers & Pages → xenxo-realtime → Metrics* |
| El túnel de los distritos se cae | *Notifications → Tunnel health* en Cloudflare |
| Despliegues fallidos | La pestaña *Actions* de tu repositorio |

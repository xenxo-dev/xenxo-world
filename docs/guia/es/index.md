---
title: Guía para desarrolladores
nav: Portada
order: 0
hero: Levanta tu propio xenxo
lead: xenxo es código abierto. Arráncalo en tu ordenador en cinco minutos, publica tu propia copia en Cloudflare sin pagar nada o lleva los distritos a un servidor de tu casa. Esta guía cuenta cada camino de principio a fin.
description: Cómo arrancar xenxo en local, desplegar tu propia instancia en Cloudflare y alojar los distritos en tu servidor.
---

## Elige por dónde empezar

<ul class="paths">
<li><a href="local"><b>En tu ordenador</b><span>El mundo entero en local: web, servidor de tiempo real, cuentas y distritos. Para tocar el código o probar antes de nada.</span><em>Node 22, unos 5 minutos, gratis</em></a></li>
<li><a href="cloudflare"><b>Tu instancia en Cloudflare</b><span>Tu propia copia de xenxo en internet, con tu dominio, desplegada sola en cada push desde GitHub.</span><em>Tu dominio, unos 30 minutos, plan gratuito</em></a></li>
<li><a href="servidor"><b>Los distritos en tu servidor</b><span>Las ciudades multijugador en un equipo de tu casa o un VPS, detrás de un túnel sin abrir puertos.</span><em>Ubuntu o Debian, una hora, tu luz y tu conexión</em></a></li>
<li><a href="crear"><b>Crear sobre xenxo.io</b><span>Sin desplegar el mundo: haz un juego con «Entrar con xenxo», un distrito de la comunidad o deja que tu agente construya en tu parcela.</span><em>npm create xenxo, licencia MIT</em></a></li>
</ul>

Si vas a abrir tu instancia al público, lee también [Operar tu instancia](operar.md): seguridad, copias, límites del plan gratuito y lo que exige la licencia.

## Cómo está hecho

xenxo son piezas pequeñas que hablan un mismo protocolo. La web solo dibuja; la verdad del mundo la tiene un servidor por cada trozo del mapa.

```text
 navegador (panel 2D + mundo 3D, WebXR)
      │  HTTPS y WebSocket
      ▼
 api.tudominio ── Worker de Cloudflare (apps/realtime)
      ├── Directory ........ cuentas con passkey, proyectos, juegos, moderación
      ├── ChunkRoom × N .... un Durable Object por lugar: nexo, plaza, distritos
      └── R2 ............... modelos 3D y portadas, por hash
                     │  pases firmados (Ed25519)
                     ▼
 distritos.tudominio ── opcional: el mismo ChunkRoom en tu servidor (workerd + túnel)
```

| Pieza | Dónde está en el repositorio | Qué hace |
|---|---|---|
| Protocolo | [`packages/protocol`](../../../packages/protocol/) | El contrato: entidades, componentes y mensajes, con Zod |
| Servidor de tiempo real | [`apps/realtime`](../../../apps/realtime/) | Valida cada cambio del mundo, guarda el estado en SQLite y reparte las poses |
| Web | [`apps/web`](../../../apps/web/) | Panel 2D y mundo 3D (React Three Fiber), en escritorio, móvil y gafas |
| Servidor de distritos | [`tools/district-host`](../../../tools/district-host/) | El mismo código de los chunks, en una máquina tuya con workerd |
| Lo que usan los creadores | `packages/sdk`, `mcp`, `district-kit`, `create-xenxo` | SDK de juegos, servidor MCP, kit de distritos y plantilla (MIT) |

El contrato completo está en [`docs/PROTOCOL.md`](../../../docs/PROTOCOL.md).

## Qué necesitas en cada camino

| | En tu ordenador | En Cloudflare | En tu servidor |
|---|---|---|---|
| Sistema | Windows, macOS o Linux | El que uses para tu cuenta de GitHub | Ubuntu 24.04 o Debian 12 |
| Software | Node.js 22 y git | Una cuenta de GitHub | Node.js 22, git y cloudflared |
| Cuentas | Ninguna | Cloudflare (gratis) y GitHub | Las de Cloudflare |
| Dominio | No | Sí, gestionado en Cloudflare | Un subdominio del mismo |
| Coste | 0 € | 0 € en el plan gratuito (más el dominio) | Luz y conexión |
| Lo que más importa | — | Los límites diarios del plan gratuito | La velocidad de **subida** de tu conexión |

> [!NOTE]
> El servidor de distritos amplía una instancia en Cloudflare: las cuentas, la web y los archivos siguen allí. Hoy no hay una forma soportada de llevar **todo** xenxo a un servidor propio sin Cloudflare.

## La licencia, en dos frases

El mundo (servidor, web y herramientas) es [AGPL-3.0](../../../LICENSE): puedes usarlo, cambiarlo y montar tu copia, y si la abres al público tienes que publicar tu código con tus cambios. Lo que usan los creadores (protocolo, SDK, MCP, kit de distritos y plantilla) es MIT: conectar tu juego o tu agente no cambia la licencia de tu código.

## Ayuda

- Dudas y fallos: [issues en GitHub](https://github.com/xenxo-dev/xenxo-world/issues).
- Un fallo de seguridad: no lo publiques; sigue [`SECURITY.md`](../../../SECURITY.md).
- Todo lo demás: [contact@xenxo.io](mailto:contact@xenxo.io).

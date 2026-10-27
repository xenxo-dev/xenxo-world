# Distritos como ciudades completas: cómo y dónde alojarlos sin salir del plan gratuito

Propuesta del 27-10-2026, pendiente de decidir. Contexto: `docs/LIMITES-CLOUDFLARE.md`.

## La meta

Cada distrito tiene que ser **una ciudad entera para explorar**: calles, edificios, actividades y
minijuegos, más las parcelas con los proyectos de la gente. Es multijugador y se pasa tiempo dentro.
Eso es justo lo que más gasta en Cloudflare Free: cada pose de cada persona cuenta contra las 100.000
peticiones diarias de Durable Objects. Hoy, con una manzana por distrito y las poses a 5 Hz, una
cuenta aguanta unas 950 visitas al día. Con ciudades grandes y gente quedándose, mucho menos.

## Qué se queda en Cloudflare y qué se va

| En Cloudflare (gratis) | En tu servidor |
|---|---|
| La web (estática, gratis e ilimitada) | **Los distritos**: su ciudad, su gente, sus actividades y sus parcelas |
| Cuentas, proyectos, juegos y moderación (`Directory`) | (más adelante, si hace falta) la plaza |
| El nexo (en solitario: casi no gasta) | Copias de seguridad de cada distrito en el NAS |
| Los archivos (R2, con sus topes) | |

## Opciones para los distritos

| | Qué es | Coste | Riesgo |
|---|---|---|---|
| **A. Seguir en Cloudflare Free** | Lo de hoy, con todo el ahorro posible | 0 € | Techo bajo: no da para ciudades con gente dentro |
| **B. Varias cuentas gratuitas** | Un distrito por cuenta | 0 € | **No.** Las condiciones de Cloudflare (§2.2.1 c) prohíben usar el servicio para eludir sus límites de uso. Si lo ven así, pueden suspenderlo todo, xenxo.io incluido |
| **C. Tu servidor** (Xeon, 32 GB) | El mismo código, con **workerd** (el motor de Workers, de código abierto: Durable Objects con SQLite en disco) detrás de un **Cloudflare Tunnel** (gratis, sin abrir puertos en casa) | Luz y conexión de casa | Disponibilidad de tu casa y tu ancho de subida |
| **D. Otro proveedor gratuito** | Fly.io, Deno Deploy… | 0 € a ratos | Habría que reescribir el chunk, y sus capas gratis cambian a menudo |

**Recomendación: C para los distritos**, y lo demás en Cloudflare.

## Cómo sería un distrito grande

1. **Una sala por distrito, más grande que un chunk.** Como el nexo (que ya se sale de su chunk con
   `WELCOME.walk`), pero multijugador: por ejemplo, 256 × 256 m con su ciudad, sus barrios y sus
   parcelas. Es más sencillo y robusto que coser varios chunks (no hay cambios de servidor al cruzar
   una calle).
2. **Solo te llega lo que tienes cerca.** El servidor reparte las poses de quien está a menos de unos
   60 m, no las de todo el distrito. Ahorra subida y CPU, y deja meter mucha más gente.
3. **Actividades y minijuegos:**
   - los juegos web que ya existen (con su ficha `xenxo.json`), con un portal en la ciudad;
   - actividades dentro del mundo (carreras, búsquedas, retos) como módulos del servidor del
     distrito, con sus puntuaciones.
4. **Parcelas:** las mismas reglas de hoy (clave `xk_`, presupuestos, revisión), pero más grandes y
   repartidas por los barrios.

## Qué hay que construir

- **Protocolo:** cada sala dice dónde vive (un `host` opcional en `districts.json`, `WELCOME` y
  `portal@1`), y `walk` también para las salas multijugador. Son campos opcionales: compatible, con su
  escenario en la conformidad.
- **Tokens:** el `Directory` firma las sesiones con su clave Ed25519 (como en «Entrar con xenxo») y el
  servidor de casa solo necesita la clave pública (`/.well-known/jwks.json`, que ya existe). Ningún
  secreto sale de Cloudflare.
- **Llamadas del `Directory` al distrito** (colocar el portal de un proyecto, la zona de un agente):
  pasan a ser HTTP firmado entre el Worker y tu servidor.
- **Interés por distancia** en el reparto de poses y una sala por distrito con límites de caminar.
- **En tu servidor:** workerd como servicio, `cloudflared` para el túnel (`rt-distritos.xenxo.io`),
  copia nocturna de las bases SQLite al NAS y un aviso si se cae. Si tu casa se cae, los distritos
  dicen «fuera de servicio» y el resto del mundo sigue.

## Cuánto aguanta tu casa

La CPU y la memoria sobran. Lo que manda es la **subida** de la conexión. Con interés por distancia,
cada persona recibe las poses de las que tiene cerca (pongamos 15) a 5 Hz, de unos 150 bytes cada una:

- 100 personas a la vez en los distritos ≈ 100 × 15 × 5 × 150 B ≈ **1,1 MB/s (unos 9 Mbit/s)**.
- Sin interés por distancia, con 100 personas en el mismo distrito, serían unos 60 Mbit/s.

Con fibra simétrica hay de sobra; con ADSL o 4G, no.

**Para decidir:** qué subida tiene la conexión de casa, y si preparo C.

## Fuentes

- [Condiciones de Cloudflare (Self-Serve Subscription Agreement)](https://www.cloudflare.com/en-ca/terms/)
- [Durable Objects: precios y plan gratuito](https://developers.cloudflare.com/durable-objects/platform/pricing)

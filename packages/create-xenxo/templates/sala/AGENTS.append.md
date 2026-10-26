
## Multijugador (`sala/` y `src/multijugador.js`)

- `sala/index.js` es el servidor (Worker + Durable Object `Sala`, con hibernación). Solo reenvía:
  no conoce las reglas del juego. Si hace falta autoridad (puntuaciones, quién gana), añádela ahí,
  en el Durable Object, nunca te fíes de lo que diga un cliente.
- `src/multijugador.js` es el cliente: `iniciarMultijugador({ jugador })` → `{ otros, enviar,
  evento, on }`. `enviar(estado)` manda tu estado como mucho 10 veces por segundo y solo si cambia;
  manda lo mínimo (números redondeados), no objetos grandes.
- Identidad: con «Entrar con xenxo» el cliente manda el `idToken` y la sala lo comprueba con la clave
  pública de xenxo (`/.well-known/jwks.json`), su emisor, su caducidad y que sea para tu
  `XENXO_CLIENT_ID`. Solo entonces `jugador.verificado` es `true` y el número y el avatar son de fiar.
- Límites de la sala: 16 jugadores, 30 mensajes por segundo, 1,5 KB por mensaje. Cámbialos en
  `sala/index.js` con cabeza: es el plan gratuito de la persona.
- Comandos: `npm run sala` (local, puerto 8788) y `npm run deploy:sala`.


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
- Invitados (sin `idToken` comprobado): su nombre llega sin `#` y sin número ni avatar; enséñalos
  **siempre** como invitados, nunca como «nombre #número».
- Límites de la sala (`sala/index.js`): 16 jugadores (solo cuentan quienes ya dijeron `hola`),
  48 conexiones en total, 8 desde la misma red, 10 s para decir `hola`, 30 mensajes por segundo y
  1,5 KB por mensaje. Cámbialos con cabeza: es el plan gratuito de la persona.
- Códigos de cierre: 4001 sala llena · 4002 conectado en otro sitio · 4003 no saludó a tiempo ·
  4004 demasiadas conexiones desde la misma red. Con 4001, 4002 y 4004 el cliente no reconecta solo:
  si tocas `src/multijugador.js`, mantenlo así (reconectar en bucle no arregla ninguno).
- Comandos: `npm run sala` (local, puerto 8788) y `npm run deploy:sala`.


## Multiplayer (`sala/` and `src/multijugador.js`)

- `sala/index.js` is the server (Worker + Durable Object `Sala`, with hibernation). It only relays:
  it doesn't know the game's rules. If you need authority (scores, who wins), add it there, in the
  Durable Object; never trust what a client says.
- `src/multijugador.js` is the client: `iniciarMultijugador({ jugador })` → `{ otros, enviar,
  evento, on }`. `enviar(estado)` sends your state at most 10 times per second and only when it
  changes; send the minimum (rounded numbers), not big objects.
- Identity: with "Sign in with xenxo" the client sends the `idToken` and the room checks it with
  xenxo's public key (`/.well-known/jwks.json`), its issuer, its expiry and that it is for your
  `XENXO_CLIENT_ID`. Only then is `jugador.verificado` `true` and the number and avatar trustworthy.
- Guests (no verified `idToken`): their name arrives without `#` and without number or avatar; show
  them **always** as guests, never as "name #number".
- Room limits (`sala/index.js`): 16 players (only those who said `hola` count), 48 connections in
  total, 8 from the same network, 10 s to say `hola`, 30 messages per second and 1.5 KB per message.
  Change them carefully: it's the person's free plan.
- Close codes: 4001 room full · 4002 connected elsewhere · 4003 didn't say hello in time · 4004 too
  many connections from the same network. On 4001, 4002 and 4004 the client doesn't reconnect by
  itself: if you touch `src/multijugador.js`, keep it that way (reconnecting in a loop fixes none of them).
- Commands: `npm run sala` (local, port 8788) and `npm run deploy:sala`.

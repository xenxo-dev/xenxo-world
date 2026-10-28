
## Multijugador · Multiplayer

El juego trae una **sala** (`sala/`): un Worker con un Durable Object que reenvía el estado de cada
jugador a los demás. Va en **tu** cuenta gratuita de Cloudflare, no en la de xenxo.

```sh
npm run sala          # en otra terminal, junto a npm run dev: ws://localhost:8788
npm run deploy:sala   # publícala: te da https://{{name}}-sala.<tu-subdominio>.workers.dev
```

Después:

1. En `sala/wrangler.toml`, pon en `ORIGENES` la dirección de tu juego publicado y, si ya lo
   registraste en xenxo, tu `client_id` en `XENXO_CLIENT_ID` (así nombre, número y avatar vienen
   comprobados por xenxo; sin él, todos entran como invitados). Vuelve a `npm run deploy:sala`.
2. Crea `.env.production` con `VITE_SALA_URL=wss://{{name}}-sala.<tu-subdominio>.workers.dev` y
   `npm run deploy`.

Salas distintas con `?sala=nombre` en la dirección. Límites de cada sala:

- **16 jugadores**: solo cuentan quienes ya han dicho `hola`; quien no lo dice en **10 s** se cierra
  (código 4003) cuando llega otra conexión.
- **48 conexiones** en total (contando las que aún no han saludado; si se pasa, 4001 «sala llena»)
  y **8 desde la misma red** (4004; el cliente no reconecta solo).
- 30 mensajes por segundo y 1,5 KB por mensaje.

Sin «Entrar con xenxo» comprobado, se entra como **invitado**: con el nombre que diga, sin `#` (no
puede hacerse pasar por «nombre #número») y siempre marcado como invitado. En el plan gratuito, los
límites cortan, no cobran.

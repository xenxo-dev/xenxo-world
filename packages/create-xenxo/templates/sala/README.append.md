
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

Salas distintas con `?sala=nombre` en la dirección. Máximo 16 jugadores por sala, 30 mensajes por
segundo y 1,5 KB por mensaje. En el plan gratuito, los límites cortan, no cobran.

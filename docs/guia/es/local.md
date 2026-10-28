---
title: xenxo en tu ordenador
nav: En tu ordenador
gate: Tu ordenador
order: 1
description: El mundo entero en local, con cuentas, distritos y el banco de pruebas, en unos cinco minutos.
---

Todo xenxo corre en tu equipo con dos procesos: el servidor de tiempo real (`wrangler dev`, el mismo motor que usa Cloudflare) y la web (Vite). No hace falta ninguna cuenta ni ninguna clave.

## Antes de empezar

- **Node.js 22** o más nuevo (`node -v`). En Windows, macOS y Linux.
- **git**.
- Unos 2 GB libres: el repositorio trae los modelos 3D del mundo y las dependencias ocupan otros 700 MB.

## Arrancar

1. **Clona el repositorio e instala.**

   ```bash
   git clone https://github.com/xenxo-dev/xenxo-world
   cd xenxo-world
   npm install
   ```

2. **Copia la configuración de ejemplo.** Trae claves de prueba que solo valen en `localhost`.

   ```bash
   cp apps/realtime/.dev.vars.example apps/realtime/.dev.vars
   cp apps/web/.env.example apps/web/.env
   ```

   En Windows (PowerShell), `copy` en lugar de `cp`.

3. **Arranca el servidor** en una terminal. Queda en `http://localhost:8787`.

   ```bash
   npm run dev:realtime
   ```

4. **Arranca la web** en otra terminal. Queda en `http://localhost:5173`.

   ```bash
   npm run dev:web
   ```

5. **Entra.** Abre `http://localhost:5173` en dos pestañas y pulsa *Enter world* en las dos: os veréis moveros en el nexo. Cruza una puerta para ir a la plaza o a un distrito.

> [!TIP]
> Comprueba que el servidor responde con `curl http://localhost:8787/health`. Tiene que devolver `{"ok":true,"protocol":0}`.

## Cuentas, moderación y datos en local

- **Crear una cuenta:** *Cuenta → Crear cuenta* con una passkey. En local funcionan porque el dominio de las passkeys es `localhost` (`RP_ID` en `.dev.vars`).
- **Ser el jugador #0 y moderar:** descarga tus datos (*Cuenta → Descargar mis datos*), copia tu `id` y añade `FOUNDER_USER_ID=<id>` a `apps/realtime/.dev.vars`. Reinicia el servidor.
- **Claves de prueba:** `dev-agent-key-change-me` construye y sube modelos; `dev-admin-key-change-me` además modera. Fuera de `localhost` el servidor las rechaza.
- **Empezar de cero:** para el servidor y borra `apps/realtime/.wrangler/state`. Al arrancar se vuelven a sembrar el nexo, la plaza y los distritos.

## El banco de pruebas

Con el servidor en marcha, el banco de conformidad recorre el protocolo de punta a punta: más de 60 escenarios con cuentas, mundo, distritos, juegos, moderación y RGPD.

```bash
XENXO_AGENT_KEY=dev-agent-key-change-me XENXO_ADMIN_KEY=dev-admin-key-change-me npm run conformance
```

Antes de proponer un cambio, pasa también:

```bash
npm run typecheck
npm run build
```

Las reglas del repositorio (qué se puede tocar y cómo) están en [`CLAUDE.md`](../../../CLAUDE.md), que es también lo que lee tu agente de IA si trabajas con uno.

> [!NOTE]
> En local no se aplican los límites por dirección IP: el banco de pruebas crea cientos de cuentas desde tu equipo. Para probarlos, añade `RATE_LIMIT_LOCAL=1` a `.dev.vars`.

## Probar desde el móvil

El móvil tiene que llegar a los dos procesos por la IP de tu ordenador (por ejemplo `192.168.1.20`):

1. Arranca el servidor escuchando en la red:

   ```bash
   npm run dev -w @xenxo/realtime -- --ip 0.0.0.0
   ```

2. En `apps/web/.env`, apunta la web a esa IP: `VITE_REALTIME_URL=http://192.168.1.20:8787`.
3. En `apps/realtime/.dev.vars`, permite el origen de la web: `ALLOWED_ORIGINS=http://localhost:5173,http://192.168.1.20:5173`.
4. Reinicia la web y abre `http://192.168.1.20:5173` en el móvil.

Fuera de `localhost` las passkeys no funcionan: entra como invitado.

> [!IMPORTANT]
> La realidad virtual (WebXR) exige HTTPS. Para probar en unas Meta Quest, lo más sencillo es [tu instancia en Cloudflare](cloudflare.md).

## Regenerar el mundo

Los edificios y los distritos no se editan a mano: se **forjan** con scripts de Python que usan Blender sin pantalla. Solo lo necesitas si cambias la arquitectura.

| Qué | Orden | Necesita |
|---|---|---|
| Todo el mundo | `npm run forge` | Python 3 y Blender 5 como módulo (`pip install bpy`) |
| Solo el nexo | `npm run forge:nexo` | Lo mismo |
| Solo los distritos | `npm run forge:districts` | Lo mismo |

Detalles en [`tools/forge/README.md`](../../../tools/forge/README.md).

## Problemas frecuentes

| Lo que ves | Qué hacer |
|---|---|
| `EADDRINUSE` al arrancar | Otro proceso usa el 8787 o el 5173. Ciérralo o cambia el puerto. |
| La web carga pero dice «sin conexión» | El servidor no está en marcha o `VITE_REALTIME_URL` no apunta a él. |
| `Unsupported engine` o errores raros al instalar | Necesitas Node.js 22. Borra `node_modules` y vuelve a `npm install`. |
| La passkey falla | Usa `http://localhost:5173`, no la IP. En Firefox de Linux puede no haber gestor de passkeys: prueba Chrome. |
| Respuestas `429` | Has activado `RATE_LIMIT_LOCAL=1`: espera un minuto o quítalo. |

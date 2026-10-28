---
title: Tu instancia en Cloudflare
nav: Tu instancia en Cloudflare
gate: Cloudflare
order: 2
description: Tu propia copia de xenxo en internet, con tu dominio y desplegada sola desde GitHub, en el plan gratuito de Cloudflare.
---

xenxo.io funciona así: cada vez que el CI pasa en `main`, GitHub Actions despliega el servidor en `api.<dominio>` y la web en `<dominio>`. Tu copia hace exactamente lo mismo con tus cuentas.

| Pieza | Dónde queda | Servicio de Cloudflare |
|---|---|---|
| La web | `tudominio.com` y `www.tudominio.com` | Workers (recursos estáticos, gratis e ilimitados) |
| El servidor | `api.tudominio.com` | Workers + Durable Objects con SQLite |
| Los modelos 3D y las portadas | Bucket `xenxo-assets`, en la UE | R2 |
| Los juegos de ejemplo | `xenxo-<juego>.<tu-subdominio>.workers.dev` | Workers |

## Antes de empezar

- Una cuenta de **GitHub**.
- Una cuenta de **Cloudflare** (el plan gratuito vale).
- Un **dominio** gestionado en Cloudflare. Si lo compraste en otro sitio, cambia sus servidores DNS a los que te dé Cloudflare. Las passkeys van atadas a ese dominio.

> [!IMPORTANT]
> Decide **dónde se guardan los datos** antes del primer despliegue. `DO_JURISDICTION = "eu"` en `apps/realtime/wrangler.toml` los deja en la UE. Si lo cambias después, los Durable Objects nuevos empiezan vacíos.

## 1. Tu copia del repositorio

1. Haz un **fork** de [xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world) (o súbelo a un repositorio tuyo).
2. En la pestaña **Actions** del fork, activa los flujos de trabajo (GitHub los deja apagados en los forks).

Antes de abrirla al público, cambia lo que es de xenxo.io:

| Archivo | Qué cambiar |
|---|---|
| `apps/web/public/legal/` | Quién es el responsable, tu contacto y dónde guardas los datos. Están en español e inglés y tienen los huecos entre corchetes. |
| `apps/web/src/panel/Panel.tsx` | El enlace «Código» tiene que llevar a **tu** repositorio: la AGPL exige ofrecer el código de lo que sirves. |
| `apps/realtime/wrangler.toml` | `GITHUB_OWNER`: la cuenta cuyos repositorios salen en el panel. |
| `SECURITY.md` | Dónde avisarte de un fallo de seguridad. |

> [!NOTE]
> xenxo.io es la instancia original. Si publicas la tuya, que se vea que es otra: tu nombre, tu dominio y tus páginas legales.

## 2. Prepara Cloudflare

1. **Añade tu dominio** a Cloudflare y espera a que esté activo.
2. **Activa R2** en el panel (R2 Object Storage). Cloudflare puede pedirte un método de pago aunque no cobre mientras estés dentro de su capa gratuita; xenxo tiene topes de almacenamiento y subidas para no pasarte.
3. **Abre una vez *Workers & Pages*** para que tu cuenta tenga su subdominio `workers.dev` (el despliegue lo crea si falta, pero así no falla la primera vez).
4. **Crea un token de API:** *My Profile → API Tokens → Create Token →* plantilla **Edit Cloudflare Workers**, limitado a tu cuenta y a la zona de tu dominio.
5. Copia también tu **Account ID** (columna derecha de la página del dominio).

## 3. Secretos y variables en GitHub

En tu fork: *Settings → Secrets and variables → Actions*.

| Nombre | Tipo | Valor |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secreto | El token del paso anterior |
| `CLOUDFLARE_ACCOUNT_ID` | Secreto | Tu Account ID |
| `TOKEN_SECRET` | Secreto | Una cadena larga aleatoria: `openssl rand -hex 32`. No la cambies después o se cerrarán todas las sesiones |
| `WEB_DOMAIN` | Variable | Tu dominio, por ejemplo `tudominio.com` (sin `https://`) |
| `AGENT_KEYS` | Secreto, opcional | Claves de agentes y de moderación (abajo) |
| `FOUNDER_USER_ID` | Variable, opcional | El id de tu cuenta, para ser el jugador #0 y moderar siempre |
| `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` | Variable y secreto, opcionales | «Entrar con Google» (abajo) |
| `DISTRICT_SIGNING_KEY` | Secreto, opcional | Solo si quieres fijar tú la clave de los nodos; si no, la crea el servidor ([Los distritos en tu servidor](servidor.md)) |

Sin los tres primeros el despliegue se salta solo y lo avisa: no rompe nada.

## 4. Despliega

Empuja a `main` o lanza *Actions → Desplegar → Run workflow*. En unos dos minutos el flujo:

1. crea el subdominio `workers.dev` de la cuenta si no existe;
2. crea el bucket `xenxo-assets` en la UE (solo la primera vez);
3. publica el servidor en `api.tudominio.com` con tus secretos;
4. compila la web apuntando a ese servidor, adapta su política de seguridad (CSP) a tu dominio y la publica;
5. publica los juegos de ejemplo y comprueba que todo responde.

Comprueba tú también:

```bash
curl https://api.tudominio.com/health
```

Tiene que devolver `{"ok":true,"protocol":0}`. Abre `https://tudominio.com` y entra en el mundo.

> [!TIP]
> El flujo solo despliega lo que llega por *push* a `main` de tu propio repositorio, nunca el código de un pull request. Así nadie puede sacar tus secretos con un PR.

## 5. Tu cuenta de fundador

1. Entra en tu web y crea una cuenta (*Cuenta → Crear cuenta*).
2. *Cuenta → Descargar mis datos* y copia tu `id`.
3. Guárdalo en la variable `FOUNDER_USER_ID` y vuelve a desplegar.

Desde entonces eres el **jugador #0**, moderas siempre y puedes nombrar a más gente de moderación desde el panel.

## Opcional

### Claves de agentes y de moderación

Genera la huella de una clave (la clave en claro solo la guardas tú):

```bash
npm run hash-key -w @xenxo/headless -- "una-clave-larga-y-aleatoria"
```

Y pon en `AGENT_KEYS` las entradas separadas por comas: `builder-01:<huella>` para un agente que construye y `admin-01:<huella>:build|upload|admin` para moderar desde la terminal. Las claves de ejemplo de `.dev.vars.example` no valen fuera de `localhost`.

### Entrar con Google

1. En Google Cloud, crea un cliente OAuth de tipo **aplicación web**.
2. URI de redirección autorizada: `https://api.tudominio.com/auth/google/callback`.
3. Guarda `GOOGLE_CLIENT_ID` (variable) y `GOOGLE_CLIENT_SECRET` (secreto) y despliega.

xenxo solo pide `openid` y guarda la huella del identificador, nunca el identificador. Sin estas dos, el botón no aparece.

### Avisos de moderación

Con `N8N_WEBHOOK_URL` y `N8N_WEBHOOK_SECRET`, el servidor avisa a un flujo de n8n cuando hay algo por revisar. Puesta en marcha en [`tools/n8n`](../../../tools/n8n/).

### Distritos en tu servidor

Las ciudades multijugador son lo que más gasta del plan gratuito. Puedes llevarlas a un equipo tuyo: [Los distritos en tu servidor](servidor.md).

## Sin GitHub Actions

Si prefieres desplegar desde tu ordenador:

1. Edita la sección `[vars]` de `apps/realtime/wrangler.toml`: `RP_ID = "tudominio.com"` y `ALLOWED_ORIGINS = "https://tudominio.com,https://www.tudominio.com"`.
2. Despliega el servidor:

   ```bash
   npx wrangler login
   cd apps/realtime
   npx wrangler r2 bucket create xenxo-assets --jurisdiction eu
   npx wrangler deploy --domain api.tudominio.com
   openssl rand -hex 32 | npx wrangler secret put TOKEN_SECRET
   cd ../..
   ```

3. Compila la web contra tu servidor, cambia `*.xenxo.io` por `*.tudominio.com` en `apps/web/dist/_headers` y publícala:

   ```bash
   VITE_REALTIME_URL=https://api.tudominio.com npm run build -w @xenxo/web
   cd apps/web
   npx wrangler deploy --domain tudominio.com --domain www.tudominio.com
   ```

## Mantenerla al día

Trae los cambios de xenxo cuando quieras; el CI los prueba y el despliegue los publica:

```bash
git remote add upstream https://github.com/xenxo-dev/xenxo-world
git fetch upstream
git merge upstream/main
git push
```

## Problemas frecuentes

| Lo que ves | Qué hacer |
|---|---|
| El despliegue dice «Faltan CLOUDFLARE_API_TOKEN…» | Revisa los nombres de los tres secretos obligatorios. |
| «No se pudo crear el subdominio workers.dev» | Abre una vez *Workers & Pages* en el panel de Cloudflare y relanza. |
| Falla al crear el bucket | Activa R2 en el panel. |
| `api.tudominio.com` no resuelve | El dominio aún no está activo en Cloudflare o `WEB_DOMAIN` no coincide. |
| La web abre pero no conecta | Mira la consola del navegador: si es la CSP, comprueba que el despliegue cambió `*.xenxo.io` por tu dominio en `_headers`. |
| Error 1027 o 429 a ciertas horas | Has llegado al límite diario del plan gratuito; vuelve a las 00:00 UTC. Ver [Operar tu instancia](operar.md). |

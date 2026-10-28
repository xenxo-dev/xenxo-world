---
title: Los distritos en tu servidor
nav: Los distritos en tu servidor
gate: Tu servidor
order: 3
description: Convierte un equipo de tu casa o un VPS en un nodo que aloja distritos, con el mismo código, sin abrir puertos y con relevo automático si se cae.
---

Los distritos son lo que más gasta del plan gratuito de Cloudflare: cada pose de cada persona cuenta contra las peticiones del día. Un **nodo** es una máquina que ejecuta exactamente el mismo código de los distritos (`ChunkRoom`) con [workerd](https://github.com/cloudflare/workerd), el motor de código abierto de Cloudflare Workers. Puede haber varios nodos, y cada distrito vive en uno o en Cloudflare.

```text
navegador ──wss──▶ Cloudflare (túnel) ──▶ cloudflared ──▶ workerd en 127.0.0.1:8788 (NODE_ID)
                        ▲                                    │ un SQLite por distrito
api.tudominio ──────────┘ pases y llamadas firmadas          └─▶ copia cada 15 min (NAS o disco)
      │
      └── cada 2 min: ¿responde? ¿cambió algo? → copia en R2 · 3 fallos → el distrito vuelve a Cloudflare
```

- **Se queda en Cloudflare:** la web, las cuentas, «Entrar con xenxo», la moderación, el nexo, la plaza y los archivos.
- **Se va al nodo:** los distritos que se le asignen, con su gente, sus actividades y sus parcelas.
- **Sin puertos abiertos:** entra solo por un Cloudflare Tunnel.
- **Sin secretos en el nodo:** solo guarda la clave **pública** del Worker y su propio id. Todo lo que el Worker le firma va a su nombre, así que no le sirve a otro nodo.
- **Si se cae:** quien intenta entrar ve «este distrito no está disponible ahora» y, a los pocos minutos, el distrito vuelve solo a Cloudflare con su última copia.

> [!NOTE]
> Esta guía sirve para **tu instancia** (necesitas [tenerla desplegada](cloudflare.md)) y para **aportar un nodo a xenxo.io**. En el segundo caso haces los pasos 1, 2 y 4 en tu máquina, y quien lleva xenxo.io te da el id del nodo y lo da de alta. Escribe a [contact@xenxo.io](mailto:contact@xenxo.io). Por ahora, solo por invitación.

## Qué máquina hace falta

La CPU y la memoria sobran: un portátil de hace unos años vale. Lo que manda es la **subida** de tu conexión.

| Gente a la vez en los distritos del nodo | Subida necesaria (aprox.) |
|---|---|
| 20 | 2 Mbit/s |
| 100 | 9 Mbit/s |
| 300 | 27 Mbit/s |

Cada persona recibe las poses de quien tiene cerca (unos 60 m) cinco veces por segundo. Con fibra simétrica va sobrado; con ADSL o 4G, no.

- **Sistema:** Ubuntu Server 24.04 LTS o Debian 12, en x86-64.
- **Red:** por cable y con IP fija en el router (reserva DHCP).
- **Disco:** unos pocos GB para el repositorio y las bases de datos.
- **Copias (recomendado):** una carpeta de un NAS o de otro disco.

## 1. Prepara la máquina

Instala Node.js 22 y git:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

Las copias van a `/mnt/nas/xenxo-distritos`. Monta ahí la carpeta de tu NAS (por NFS, por ejemplo) o de otro disco antes de instalar.

## 2. Instala el nodo

```bash
sudo git clone https://github.com/xenxo-dev/xenxo-world /opt/xenxo-world
sudo bash /opt/xenxo-world/tools/district-host/install.sh
```

Si es para tu instancia, clona **tu** repositorio. El instalador:

- crea el usuario de sistema `xenxo` y las carpetas de datos;
- compila el nodo (`npm run build:district-host`) y lo instala como el servicio `xenxo-distritos`, escuchando solo en `127.0.0.1:8788`;
- programa la copia cada 15 minutos y activa las actualizaciones de seguridad automáticas;
- hace que cerrar la tapa de un portátil no lo suspenda.

El servicio va endurecido con systemd: sin privilegios nuevos, sistema de archivos de solo lectura y escritura solo en sus datos.

## 3. Las claves y el id del nodo

**Una sola vez por instancia** (no por nodo): el Worker necesita su clave para firmar. En tu ordenador, con el repositorio y `npx wrangler login` hecho:

```bash
node tools/district-host/keys.mjs
npx wrangler secret put DISTRICT_SIGNING_KEY --config apps/realtime/wrangler.toml < distrito-privada.jwk
rm distrito-privada.jwk
```

La clave privada queda solo en Cloudflare. Si despliegas con GitHub Actions, guárdala en su lugar como secreto `DISTRICT_SIGNING_KEY` del repositorio (el contenido del archivo, en una línea) y borra el archivo: el despliegue la pone. Desde ese momento, tu Worker reparte la pública en `/nodes/key`.

**En cada nodo**, edita `/etc/xenxo-distritos.env`:

```bash
NODE_ID=casa-1
DISTRICT_PUBLIC_KEY={"kty":"OKP","crv":"Ed25519","x":"…"}
HOSTED_CHUNKS=*
ASSETS_URL=https://api.tudominio.com
```

- `NODE_ID`: el id con el que lo darás de alta (3–32 letras minúsculas, números y guiones).
- `DISTRICT_PUBLIC_KEY`: la línea que devuelve `curl https://api.tudominio.com/nodes/key`.
- `HOSTED_CHUNKS`: qué distritos aceptas llevar (`*` = los que te asignen, o una lista como `c_1_0,c_-1_0`).

Reinicia y comprueba:

```bash
sudo systemctl restart xenxo-distritos
curl http://127.0.0.1:8788/node
```

Tiene que responder con tu id: `{"id":"casa-1","chunks":["*"],"protocol":0}`.

> [!WARNING]
> La clave privada no se pega en ningún chat ni se sube al repositorio. Si se filtra, genera otra, vuelve a ponerla con `wrangler secret put` y cambia la pública en cada nodo.

## 4. El túnel

En el panel de Cloudflare: *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*.

1. Llámalo como el nodo y ejecuta en la máquina la orden de instalación que te da para Debian/Ubuntu. Lleva un token: es un secreto.
2. **Public hostname:** por ejemplo `casa-1.tudominio.com` → servicio `HTTP` → `localhost:8788`.
3. Desde fuera: `curl https://casa-1.tudominio.com/node` tiene que responder con su id.
4. Activa *Notifications → Tunnel health* para enterarte si se cae.

La política de seguridad de la web ya permite conectar con cualquier subdominio tuyo. Si el nodo está en otro dominio (por ejemplo, un nodo aportado por otra persona), añade su origen `wss://…` a `connect-src` en `apps/web/public/_headers`.

## 5. Dalo de alta y llévale distritos

En tu web, con la cuenta de fundador: *Cuenta → Nodos*.

1. **Dar de alta un nodo:** su id (el mismo `NODE_ID`), un nombre (lo verá la gente: «este distrito lo aloja…») y su dirección `https://…`. Si responde con su id, sale **En línea**.
2. **Dónde vive cada distrito:** elige el nodo junto al distrito y pulsa **Llevar**. Se copia todo lo de la gente (portales de proyectos, lo construido, actividades y chat) y, en cuanto termina, la gente entra ya en el nodo.

Lo que cambie en el distrito mientras se copia (unos segundos) se pierde: hazlo con poca gente dentro.

Lo mismo desde la terminal, con una clave de moderación de `AGENT_KEYS`:

```bash
T=$(curl -s -X POST https://api.tudominio.com/auth/agent -H "Authorization: Bearer $XENXO_ADMIN_KEY" | jq -r .token)
curl -s -X POST https://api.tudominio.com/mod/nodes -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"id":"casa-1","name":"Casa de Ana","url":"https://casa-1.tudominio.com"}'
curl -s -X POST https://api.tudominio.com/mod/chunks/c_1_0/move -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"to":"casa-1"}'
```

Los chunks de los distritos:

| Distrito | Chunk |
|---|---|
| Arcade | `c_1_0` |
| Píxel | `c_-1_0` |
| Ágora | `c_0_1` |
| Taller | `c_0_-1` |
| Frontera | `c_1_-1` |
| Distrito Cero | `c_-1_-1` |
| Vertical | `c_-1_1` |
| Distritos de la comunidad | `c_1000_<n>` |

> [!IMPORTANT]
> Antes de llevar el primero, añade a tu política de privacidad (en `apps/web/public/legal/`, en los dos idiomas) que los distritos pueden procesarse en servidores de la comunidad y dónde. Quien opera un nodo ve el chat, las poses y la dirección IP de quien entra en sus distritos: para la ley es tu encargado de tratamiento.

## 6. Si un nodo se cae

| Cuándo | Qué pasa |
|---|---|
| Al momento | Quien intenta entrar ve «este distrito no está disponible ahora», con un botón para volver al nexo. Se sigue intentando solo. |
| Cada 2 minutos | El Worker pregunta a cada nodo quién es. Si el distrito cambió, guarda su copia en R2. |
| Tras 3 rondas sin respuesta (unos 6 minutos) | Los distritos del nodo vuelven a Cloudflare con su última copia. El panel lo marca como relevo y, si tienes n8n, llega el aviso `node.down`. |
| Cuando el nodo vuelve | Sigue sin distritos hasta que pulses **Llevar** otra vez. Así nunca hay dos sitios escribiendo el mismo distrito. |

**Apagar** un nodo desde el panel hace lo mismo al momento: úsalo si una máquina se comporta mal.

## 7. El día a día

| Para | Orden |
|---|---|
| Actualizar tras un cambio en el repositorio | `sudo /opt/xenxo-world/tools/district-host/update.sh` |
| Ver si está en marcha | `systemctl status xenxo-distritos` |
| Ver los registros | `journalctl -u xenxo-distritos -f` |
| Ver las copias locales | `ls /mnt/nas/xenxo-distritos/ultima/` |

**Copias locales:** una coherente de cada distrito cada 15 minutos en `ultima/` y una al día durante 30 días en `AAAA-MM-DD/`. Para restaurar: para el servicio, copia los `.sqlite` a `/var/lib/xenxo-distritos/datos/` y arráncalo. Además, el Worker guarda en R2 la última copia de cada distrito para el relevo.

**Relevo en el NAS:** si tienes un NAS Synology con Docker, puede hacer de este mismo nodo (mismo `NODE_ID` y mismo túnel) con la última copia: [relevo en el NAS](../../../tools/district-host/relevo/README.md).

**Cambiar de máquina:** misma instalación en la nueva, copia `/var/lib/xenxo-distritos/datos/` con el servicio parado y cambia el túnel al equipo nuevo. El id del nodo no cambia.

## Problemas frecuentes

| Lo que ves | Qué hacer |
|---|---|
| `curl 127.0.0.1:8788/node` da `"id":null` | Falta `NODE_ID` en `/etc/xenxo-distritos.env`. Sin él, el nodo no acepta nada firmado. |
| El panel dice que no responde, pero el túnel va | El `NODE_ID` del nodo no coincide con el id del alta. |
| **Llevar** devuelve `node_refuses` | El distrito no está en el `HOSTED_CHUNKS` del nodo. |
| **Llevar** devuelve `node_unreachable` | El nodo no responde por su dirección `https://…`: revisa el túnel. |
| *Cuenta → Nodos* dice que los nodos están apagados | Falta el secreto `DISTRICT_SIGNING_KEY` en el Worker (paso 3). |
| Los modelos de la gente no salen en el distrito | `ASSETS_URL` tiene que ser tu `https://api.tudominio.com`. |
| El navegador no conecta con un nodo de otro dominio | Añade su `wss://…` a `connect-src` en `apps/web/public/_headers`. |

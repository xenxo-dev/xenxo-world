---
title: Los distritos en tu servidor
nav: Los distritos en tu servidor
gate: Tu servidor
order: 3
description: Lleva las ciudades multijugador de tu instancia a un equipo de tu casa o a un VPS, con el mismo código y sin abrir puertos.
---

Los distritos son lo que más gasta del plan gratuito de Cloudflare: cada pose de cada persona cuenta contra las peticiones del día. El **servidor de distritos** ejecuta exactamente el mismo código de los chunks (`ChunkRoom`) en una máquina tuya, con [workerd](https://github.com/cloudflare/workerd), el motor de código abierto de Cloudflare Workers.

```text
navegador ──wss──▶ Cloudflare (túnel) ──▶ cloudflared ──▶ workerd en 127.0.0.1:8788
                        ▲                                    │ un SQLite por distrito
api.tudominio ──────────┘ pases y llamadas firmadas          └─▶ copia cada 15 min (NAS o disco)
```

- **Se queda en Cloudflare:** la web, las cuentas, el nexo, la plaza y los archivos.
- **Se va a tu máquina:** los distritos que elijas, con su gente, sus actividades y sus parcelas.
- **Sin puertos abiertos:** entra solo por un Cloudflare Tunnel.
- **Sin secretos en tu máquina:** solo guarda la clave **pública** con la que comprueba lo que firma tu Worker.

> [!NOTE]
> Esta guía amplía [tu instancia en Cloudflare](cloudflare.md): hace falta tenerla desplegada. Hoy los distritos de xenxo.io los aloja su equipo; si quieres aportar un servidor a xenxo.io, escribe a [contact@xenxo.io](mailto:contact@xenxo.io).

## Qué máquina hace falta

La CPU y la memoria sobran: un portátil de hace unos años vale. Lo que manda es la **subida** de tu conexión.

| Gente a la vez en los distritos | Subida necesaria (aprox.) |
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

## 2. Instala el servidor

Clona **tu** repositorio y lanza el instalador:

```bash
sudo git clone https://github.com/<tu-usuario>/xenxo-world /opt/xenxo-world
sudo bash /opt/xenxo-world/tools/district-host/install.sh
```

El instalador:

- crea el usuario de sistema `xenxo` y las carpetas de datos;
- compila el servidor (`npm run build:district-host`) y lo instala como el servicio `xenxo-distritos`, escuchando solo en `127.0.0.1:8788`;
- programa la copia cada 15 minutos y activa las actualizaciones de seguridad automáticas;
- hace que cerrar la tapa de un portátil no lo suspenda.

El servicio va endurecido con systemd: sin privilegios nuevos, sistema de archivos de solo lectura y escritura solo en sus datos.

## 3. Las claves

Tu Worker firma los pases para entrar en los distritos y las llamadas que les hace; tu máquina solo comprueba la firma. En **tu ordenador**, con el repositorio y `npx wrangler login` hecho:

```bash
node tools/district-host/keys.mjs
npx wrangler secret put DISTRICT_SIGNING_KEY --config apps/realtime/wrangler.toml < distrito-privada.jwk
rm distrito-privada.jwk
```

La clave privada queda solo en Cloudflare. El script enseña la **pública** (una línea JSON). Edita `/etc/xenxo-distritos.env` en la máquina:

```bash
DISTRICT_PUBLIC_KEY={"kty":"OKP","crv":"Ed25519","x":"…"}
HOSTED_CHUNKS=c_1_0,c_-1_0,c_0_1,c_0_-1,c_1_-1,c_-1_-1,c_-1_1
ASSETS_URL=https://api.tudominio.com
```

Reinicia y comprueba:

```bash
sudo systemctl restart xenxo-distritos
curl http://127.0.0.1:8788/health
```

Tiene que responder `ok`.

> [!WARNING]
> La clave privada no se pega en ningún chat ni se sube al repositorio. Si se filtra, genera otra y vuelve a hacer este paso.

## 4. El túnel

En el panel de Cloudflare: *Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared*.

1. Llámalo `xenxo-distritos` y ejecuta en la máquina la orden de instalación que te da para Debian/Ubuntu. Lleva un token: es un secreto.
2. **Public hostname:** `distritos.tudominio.com` → servicio `HTTP` → `localhost:8788`.
3. Desde fuera: `curl https://distritos.tudominio.com/health` tiene que responder `ok`.
4. Activa *Notifications → Tunnel health* para enterarte si se cae.

La política de seguridad de la web ya permite conectar con cualquier subdominio tuyo, así que no hay que tocarla.

## 5. Lleva los distritos

Los chunks de los distritos son estos:

| Distrito | Chunk |
|---|---|
| Arcade | `c_1_0` |
| Píxel | `c_-1_0` |
| Ágora | `c_0_1` |
| Taller | `c_0_-1` |
| Frontera | `c_1_-1` |
| Distrito Cero | `c_-1_-1` |
| Vertical | `c_-1_1` |

Ve de uno en uno:

1. **Di a tu Worker dónde está el servidor.** En `apps/realtime/wrangler.toml`, sección `[vars]`, pon `DISTRICT_HOST = "https://distritos.tudominio.com"` y despliega.
2. **Copia lo que tiene el distrito** (portales de proyectos, lo construido y el chat) a tu máquina, con una clave de moderación de `AGENT_KEYS`:

   ```bash
   T=$(curl -s -X POST https://api.tudominio.com/auth/agent -H "Authorization: Bearer $XENXO_ADMIN_KEY" | jq -r .token)
   curl -s -X POST https://api.tudominio.com/mod/chunks/c_-1_1/move \
     -H "Authorization: Bearer $T" -H 'Content-Type: application/json' -d '{"to":"remote"}'
   ```

3. **Cambia el distrito de sitio:** añádelo a `REMOTE_CHUNKS` (separados por comas, por ejemplo `REMOTE_CHUNKS = "c_-1_1"`) y despliega.
4. Entra en el distrito y comprueba que está todo. Luego el siguiente.

Lo que cambie en el distrito entre el paso 2 y el 3 se pierde: hazlo con poca gente dentro.

**Volver a Cloudflare:** al revés. Primero `{"to":"local"}` en `/mod/chunks/<id>/move`, después quita el chunk de `REMOTE_CHUNKS` y despliega.

> [!IMPORTANT]
> Antes de llevar el primero, añade a tu política de privacidad (en `apps/web/public/legal/`, en los dos idiomas) dónde se procesan los distritos.

## 6. El día a día

| Para | Orden |
|---|---|
| Actualizar tras un cambio en el repositorio | `sudo /opt/xenxo-world/tools/district-host/update.sh` |
| Ver si está en marcha | `systemctl status xenxo-distritos` |
| Ver los registros | `journalctl -u xenxo-distritos -f` |
| Ver las copias | `ls /mnt/nas/xenxo-distritos/ultima/` |

**Copias:** una coherente de cada distrito cada 15 minutos en `ultima/` y una al día durante 30 días en `AAAA-MM-DD/`. Para restaurar: para el servicio, copia los `.sqlite` a `/var/lib/xenxo-distritos/datos/` y arráncalo.

**Si la máquina se cae,** sus distritos dejan de estar disponibles y el resto del mundo sigue. Si tienes un NAS Synology con Docker, puede tomar el relevo solo con la última copia: [relevo en el NAS](../../../tools/district-host/relevo/README.md).

**Cambiar de máquina:** misma instalación en la nueva, copia `/var/lib/xenxo-distritos/datos/` con el servicio parado y cambia el túnel al equipo nuevo.

## Problemas frecuentes

| Lo que ves | Qué hacer |
|---|---|
| `curl 127.0.0.1:8788/health` no responde | `journalctl -u xenxo-distritos -n 50`. Suele ser `DISTRICT_PUBLIC_KEY` vacía o mal copiada. |
| El túnel responde 502 | El servicio está parado o el hostname apunta a otro puerto. |
| `move` devuelve «falta DISTRICT_HOST» | Despliega primero con `DISTRICT_HOST` y el secreto `DISTRICT_SIGNING_KEY`. |
| No se puede entrar en el distrito | El Worker no llega a tu máquina: revisa el túnel y que `HOSTED_CHUNKS` incluye ese chunk. |
| Los modelos de la gente no salen en el distrito | `ASSETS_URL` tiene que ser tu `https://api.tudominio.com`. |

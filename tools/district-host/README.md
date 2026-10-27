# Servidor de distritos en una máquina propia

Guía para alojar los distritos de xenxo en el portátil (MSI GP62VR: i7-7700HQ, 16 GB, SSD) con el
mismo código que en Cloudflare. Por qué y cuánto aguanta: `docs/ALOJAMIENTO-DISTRITOS.md`.

```
navegador ──wss──▶ Cloudflare (túnel) ──▶ cloudflared ──▶ workerd :8788 (solo en la máquina)
                        ▲                                     │ SQLite por distrito (/var/lib/xenxo-distritos)
api.xenxo.io (Worker) ──┘ pases y llamadas firmadas          └─▶ copia cada noche al NAS
```

- La web, las cuentas, el nexo, la plaza y los archivos siguen en Cloudflare.
- La máquina no abre puertos y no guarda secretos de xenxo: solo la clave **pública** con la que
  comprueba lo que firma el Worker (pases para entrar, llamadas para colocar portales, etc.).

## 1. Preparar el portátil

1. BIOS al día. Si se puede, «encender al volver la corriente» (en portátiles no suele estar).
2. **Ubuntu Server 24.04 LTS** en el SSD, con OpenSSH. Usuario normal con sudo.
3. **Cable de red** (no Wi-Fi). IP fija en el router (reserva DHCP).
4. Ventiladores limpios y pasta térmica nueva si nunca se ha cambiado. Tapa abierta o bien ventilado.
5. **Batería:** que no esté abombada. Opcional: limitar la carga al 60–80 % con
   [msi-ec](https://github.com/BeardOverflow/msi-ec) si el modelo está soportado
   (`echo 80 | sudo tee /sys/class/power_supply/BAT1/charge_control_end_threshold`).
6. Node.js 22:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt-get install -y nodejs git
   ```
7. El NAS montado en `/mnt/nas` (NFS o SMB) con una carpeta `xenxo-distritos` para las copias.

## 2. Instalar

```bash
sudo git clone https://github.com/xenxo-dev/xenxo-world /opt/xenxo-world
sudo bash /opt/xenxo-world/tools/district-host/install.sh
```

El instalador crea el usuario `xenxo`, las carpetas, el servicio `xenxo-distritos` (workerd en
`127.0.0.1:8788`), la copia nocturna al NAS (04:30) y hace que cerrar la tapa no suspenda.

## 3. Las claves (una vez)

En tu ordenador, con el repo y la sesión de Wrangler de xenxo:

```bash
node tools/district-host/keys.mjs            # crea distrito-privada.jwk y enseña la pública
npx wrangler secret put DISTRICT_SIGNING_KEY --config apps/realtime/wrangler.toml < distrito-privada.jwk
rm distrito-privada.jwk                      # la privada solo vive en Cloudflare
```

Copia la **pública** (la línea JSON) en `/etc/xenxo-distritos.env` del portátil (`DISTRICT_PUBLIC_KEY=…`)
y reinicia: `sudo systemctl restart xenxo-distritos`. Comprueba: `curl http://127.0.0.1:8788/health` → `ok`.

## 4. El túnel de Cloudflare

En el panel de Cloudflare: **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared**.

1. Nombre: `xenxo-distritos`. Copia la orden de instalación para Debian/Ubuntu (lleva un token: es un
   secreto, ejecútala tal cual en el portátil, no la pegues en ningún chat).
2. **Public hostname:** `distritos.xenxo.io` → servicio `HTTP` → `localhost:8788`.
3. Comprueba desde fuera: `curl https://distritos.xenxo.io/health` → `ok`.
4. Avisos: **Notifications → Tunnel health** para que te llegue un correo si se cae.

## 5. Encender los distritos remotos

En `apps/realtime/wrangler.toml`, sección `[vars]`:

```toml
DISTRICT_HOST = "https://distritos.xenxo.io"
REMOTE_CHUNKS = "c_-1_1"          # empieza por un distrito (Vertical) y ve añadiendo
```

Despliega (push a `main`). Desde ese momento ese distrito vive en el portátil, recién sembrado. Copia
lo que tenía en Cloudflare (portales de proyectos, lo construido y el chat) con la clave de
administración:

```bash
T=$(curl -s -X POST https://api.xenxo.io/auth/agent -H "Authorization: Bearer $XENXO_ADMIN_KEY" | jq -r .token)
curl -s -X POST https://api.xenxo.io/mod/chunks/c_-1_1/move -H "Authorization: Bearer $T" \
  -H 'Content-Type: application/json' -d '{"to":"remote"}'
```

Entra en el distrito y comprueba que todo está. Luego el siguiente. Los chunks de los distritos:
Arcade `c_1_0`, Píxel `c_-1_0`, Ágora `c_0_1`, Taller `c_0_-1`, Frontera `c_1_-1`,
Distrito Cero `c_-1_-1`, Vertical `c_-1_1`.

**Volver a Cloudflare** (si el portátil va a estar parado): primero
`{"to":"local"}` en `/mod/chunks/<id>/move`, después quita el chunk de `REMOTE_CHUNKS` y despliega.

**Antes de encender el primero:** añade a la política de privacidad (ES y EN, `apps/web/public/legal/`)
que los distritos se procesan en un servidor propio en España, sin guardar IP.

## 6. Mantenimiento

- **Actualizar** (después de cada cambio en el repo que toque los chunks):
  `sudo /opt/xenxo-world/tools/district-host/update.sh`
- **Estado:** `systemctl status xenxo-distritos` · registros: `journalctl -u xenxo-distritos -f`
- **Copias:** `/mnt/nas/xenxo-distritos/AAAA-MM-DD/` (30 días). Restaurar: parar el servicio, copiar
  los `.sqlite` del día a `/var/lib/xenxo-distritos/datos/`, arrancar.
- **Actualizaciones de seguridad:** automáticas (`unattended-upgrades`).
- **Pasar al DL380 algún día:** misma instalación allí, copiar `/var/lib/xenxo-distritos/datos/` con el
  servicio parado y cambiar el túnel al nuevo equipo.

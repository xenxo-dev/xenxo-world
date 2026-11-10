# Copia propia de xenxo

En Cloudflare, las cuentas, los proyectos y lo que la gente construye viven en Durable Objects y en
R2. Cloudflare guarda 30 días de historial de cada objeto, pero esa copia no es tuya: si se pierde la
cuenta, o alguien borra el Worker, se va con ella. Esto saca **una copia a un equipo tuyo** (un NAS,
el servidor de distritos) cada día, y la puede volver a poner.

## Qué se copia

| Qué | De dónde | Cómo queda |
|---|---|---|
| Cuentas, passkeys (solo la parte pública), proyectos, juegos, jams, moderación, distritos de la comunidad, insignias, inventarios… | El `Directory`, tabla a tabla | `snapshots/<fecha>/directory/<tabla>.jsonl.enc`, cifrado |
| Lo que la gente ha puesto en cada lugar: portales, lo construido, actividades y chat | Cada chunk (`dumpState`), viva en Cloudflare o en un nodo | `snapshots/<fecha>/chunks/<chunk>.json.enc`, cifrado |
| Modelos y portadas subidos | R2, por su hash | `assets/<hash>` y `assets/<hash>.json`; solo se baja lo nuevo |

**No se copian**, porque el servidor no las entrega: la clave privada de «Entrar con xenxo», la de
los nodos y lo que es de un momento (retos de las passkeys, códigos de un uso). Tras restaurar se
crean de nuevo. Qué tablas salen está en [`apps/realtime/src/ops.ts`](../../apps/realtime/src/ops.ts)
(`BACKUP_TABLES`): una tabla nueva con datos de la gente se añade ahí.

Sí va la **sal de los identificadores**: con ella sale el identificador de cada persona en cada juego
de «Entrar con xenxo». Sin ella, tras restaurar, los juegos no reconocerían a nadie. No sirve para
firmar nada ni para entrar en ninguna cuenta, pero es otra razón para que la copia vaya cifrada.

La copia lleva datos de personas (nombres visibles, claves públicas, la huella de la cuenta de
Google, denuncias): por eso las tablas y los lugares se guardan **cifrados** (AES-256-GCM, con la
clave derivada de tu frase). Sin la frase no se puede leer: guárdala fuera del equipo de las copias.
Los archivos subidos no se cifran: ya son públicos (cualquiera puede pedirlos por su hash).

## Puesta en marcha (una vez)

1. **Una clave solo para copias.** En tu equipo:

   ```sh
   openssl rand -hex 32                                   # la clave (guárdala)
   npm run hash-key -w @xenxo/headless -- <la-clave>      # su huella
   ```

   Añade `copias-01:<huella>:backup` al secreto `AGENT_KEYS` de GitHub (las entradas van separadas
   por comas) y despliega. Esa clave solo puede leer la copia: no modera, no construye y no restaura.

2. **En el equipo de las copias** (Node.js 22 o más nuevo y este repositorio clonado):

   ```sh
   sudo install -m 600 tools/backup/xenxo-backup.env.example /etc/xenxo-backup.env
   sudo nano /etc/xenxo-backup.env        # la clave, una frase larga y la carpeta
   sudo cp tools/backup/xenxo-backup.service tools/backup/xenxo-backup.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now xenxo-backup.timer
   sudo systemctl start xenxo-backup.service && journalctl -u xenxo-backup -n 20   # la primera, a mano
   ```

   El servicio espera el repositorio en `/opt/xenxo-world`; si está en otro sitio, cambia la ruta en
   `xenxo-backup.service`. La carpeta puede ser un recurso del NAS montado (NFS o SMB).

   En un Synology, sin systemd: *Panel de control → Programador de tareas → Script definido por el
   usuario*, cada día, con `set -a; . /volume1/…/xenxo-backup.env; set +a; node /volume1/…/tools/backup/backup.mjs`.

Cada copia gasta alrededor de un centenar de peticiones del plan gratuito (una por cada 400 filas de
cada tabla, una por lugar y dos por archivo nuevo): nada al lado de las 100.000 del día. Se guardan
las últimas 30 (`XENXO_BACKUP_KEEP`).

## Restaurar

Restaurar **sustituye** lo que haya en el destino. Hace falta otra clave, con el permiso `restore`
(`restaurar-01:<huella>:restore` en `AGENT_KEYS`); créala solo cuando la necesites y quítala después.

```sh
set -a; . /etc/xenxo-backup.env; set +a
XENXO_BACKUP_KEY=<la clave de restaurar> \
  node tools/backup/restore.mjs /ruta/copias/snapshots/2026-11-10T03-30-00Z --confirm api.tudominio.com
```

El orden lo lleva el programa: primero los archivos, después las tablas, después cada lugar y, al
final, vuelve a colocar lo que el mundo saca de las cuentas (el escaparate del nexo, las
máquinas-portal, los anuncios y las puertas de la comunidad). Quien esté dentro de un lugar se
reconecta solo. Después:

1. «Entrar con xenxo» no hay que tocarlo: en un despliegue nuevo su clave se crea sola, los juegos
   la leen solos y, como la sal va en la copia, reconocen a cada persona igual que antes;
2. si tenías nodos, da de alta la clave de nodos y pon la pública nueva en cada uno
   ([guía de los distritos en tu servidor](../../docs/guia/es/servidor.md));
3. entra y comprueba que tu cuenta, un proyecto y un distrito están como esperas.

Prueba la restauración alguna vez contra tu instancia local (`XENXO_URL=http://localhost:8787`, con
las claves de ejemplo de `.dev.vars.example`): una copia que nunca se ha restaurado no es una copia.

## Variables

| Variable | Qué es |
|---|---|
| `XENXO_URL` | La API (por defecto `https://api.xenxo.io`) |
| `XENXO_BACKUP_KEY` | La clave de copias (o la de restaurar) |
| `XENXO_BACKUP_PASSPHRASE` | La frase con la que se cifra (16 caracteres o más) |
| `XENXO_BACKUP_DIR` | La carpeta de las copias |
| `XENXO_BACKUP_KEEP` | Cuántas copias se guardan (30) |
| `XENXO_BACKUP_PLAINTEXT=1` | Sin cifrar. Solo si la carpeta ya está cifrada por su cuenta |

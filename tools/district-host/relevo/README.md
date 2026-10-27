# Relevo de los distritos en el NAS

Si el portátil se para (avería, se cuelga, se apaga), el NAS (Synology DS1815+) arranca **el mismo
servidor de distritos** con la última copia y se engancha al mismo túnel de Cloudflare. Es un relevo
«en frío»:

- se pierden como mucho **15 minutos** de cambios en los distritos (lo construido y los portales; el
  chat es efímero);
- tarda unos **3–4 minutos** en entrar (3 comprobaciones de un minuto);
- **no cubre** un corte de luz o de internet en casa: los dos equipos están en la misma conexión;
- la vuelta al portátil es **a mano**, para que nunca atiendan los dos a la vez.

```
portátil ── cada 15 min ──▶ NAS: ultima/  (copia coherente de cada distrito)
              update.sh ──▶ NAS: bundle/  (el mismo servidor: district-host.js, distritos.capnp, workerd)
NAS: vigia.sh cada minuto ── ¿responde distritos.xenxo.io? ── no, 3 veces (e internet sí) ──▶
     marca RELEVO · copia ultima/ → relevo/datos · docker compose up (workerd + cloudflared)
portátil: xenxo-relevo.timer ve la marca RELEVO ──▶ para su túnel y su servidor y no los arranca
```

## 1. Preparar el NAS (una vez)

1. **DSM 7.2** con **Container Manager** (Centro de paquetes). En DSM 7.1 se llama «Docker» y vale igual.
2. Carpeta compartida `xenxo-distritos` en `volume1`. Permisos: lectura y escritura para el portátil.
3. **NFS** (Panel de control → Servicios de archivos → NFS → activar) y en la carpeta, **Permisos NFS**:
   IP del portátil, lectura/escritura, «Asignar todos los usuarios a admin». En el portátil:
   ```bash
   sudo apt-get install -y nfs-common
   echo '192.168.31.251:/volume1/xenxo-distritos /mnt/nas/xenxo-distritos nfs defaults,_netdev,soft,timeo=50 0 0' | sudo tee -a /etc/fstab
   sudo mkdir -p /mnt/nas/xenxo-distritos && sudo mount -a
   ```
4. En el portátil, `sudo /opt/xenxo-world/tools/district-host/update.sh`: copia al NAS `bundle/` y
   `relevo/` (esta carpeta), y la primera copia llega a `ultima/` en menos de 15 minutos.
5. En el NAS, dentro de `xenxo-distritos/relevo/`:
   - `distritos.env`: copia de `distritos.env.example` con la clave **pública** (la misma que el portátil);
   - `tunel.env`: copia de `tunel.env.example` con el **token del túnel**. Es secreto: créalo desde
     File Station o por SSH, nunca lo pegues en un chat.
6. **Prueba** (SSH al NAS como admin, `sudo -i`):
   ```bash
   cd /volume1/xenxo-distritos/relevo
   docker run --rm -v /volume1/xenxo-distritos/bundle:/b:ro debian:bookworm-slim /b/workerd --version
   ```
   Si enseña la versión, el procesador del NAS vale para workerd. Si falla con «Illegal instruction»,
   el NAS no sirve para el relevo y hay que ir al DL380.
7. **Programador de tareas** de DSM → Crear → Tarea activada → Script definido por el usuario:
   usuario `root`, cada día, **cada minuto** de 00:00 a 23:59, script:
   ```bash
   bash /volume1/xenxo-distritos/relevo/vigia.sh
   ```

## 2. Comprobar que funciona (con los distritos encendidos)

1. En el portátil: `sudo systemctl stop cloudflared` (simula que se cae).
2. A los 3–4 minutos, en el NAS: `cat /volume1/xenxo-distritos/relevo/vigia.log` dice
   `RELEVO TOMADO` y `curl https://distritos.xenxo.io/health` → `ok` (ahora lo sirve el NAS).
3. Entra en un distrito: todo está (salvo lo de los últimos minutos).
4. Devuélvelo (abajo).

## 3. Devolver los distritos al portátil

Cuando el portátil esté bien otra vez (al arrancar ya no levanta ni el túnel ni el servidor):

1. **NAS** (SSH, `sudo -i`): `bash /volume1/xenxo-distritos/relevo/devolver.sh` — para el relevo y
   deja sus datos en `devuelto/`.
2. **Portátil:** `sudo /opt/xenxo-distritos/recuperar.sh` — pone esos datos, quita la marca, arranca el
   servidor y el túnel y hace una copia nueva. Lo que tenía el portátil antes queda en
   `/var/lib/xenxo-distritos/datos.antes-<fecha>` por si acaso.

## Notas

- **Nada de secretos de xenxo en el NAS:** solo la clave pública y el token del túnel (que solo sirve
  para ese túnel).
- **Dos equipos, un túnel:** Cloudflare repartiría entre los dos si estuvieran a la vez. Por eso el
  portátil se aparta solo cuando ve `RELEVO` y no arranca mientras exista (`relevo-check.sh`).
- **Si el NAS no está montado** en el portátil, el portátil sigue como estaba (sin NAS tampoco hay relevo).
- **El DS1815+ lleva un Atom C2538:** esa familia tuvo un defecto de fábrica (deja de arrancar con los
  años). Si el tuyo ya se reparó o lleva años bien, vale como relevo; como servidor principal, no.
- Cuando llegue el DL380, el relevo puede ser él, con los mismos archivos (Docker en Linux).

#!/usr/bin/env bash
# Recupera los distritos en este equipo después de un relevo del NAS (paso 2 de 2; el 1 es
# relevo/devolver.sh en el NAS). Como root: sudo /opt/xenxo-distritos/recuperar.sh
set -euo pipefail
NAS=${XENXO_BACKUP_DIR:-/mnt/nas/xenxo-distritos}
DATA=${XENXO_DATA:-/var/lib/xenxo-distritos/datos}
[ -e "$NAS/RELEVO" ] || { echo "el NAS no tiene el relevo: nada que recuperar"; exit 1; }
[ -e "$NAS/relevo/PARADO" ] && [ -e "$NAS/devuelto/HECHA" ] || { echo "primero, en el NAS: relevo/devolver.sh"; exit 1; }
systemctl stop cloudflared xenxo-distritos || true
stamp=$(date +%Y%m%d-%H%M%S)
mv "$DATA" "$DATA.antes-$stamp"
cp -a "$NAS/devuelto" "$DATA"
rm -f "$DATA/HECHA"
chown -R xenxo:xenxo "$DATA"
rm -f "$NAS/RELEVO" "$NAS/relevo/PARADO" "$NAS/relevo/.fallos"
systemctl start xenxo-distritos cloudflared
sleep 2
curl -fsS http://127.0.0.1:8788/health && echo " · distritos de vuelta en este equipo"
"$(dirname "$0")/backup.sh"
echo "Lo que tenía este equipo antes del relevo queda en $DATA.antes-$stamp (bórralo cuando compruebes que todo está)."

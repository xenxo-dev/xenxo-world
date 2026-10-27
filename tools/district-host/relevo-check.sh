#!/usr/bin/env bash
# ¿Tiene el NAS el relevo de los distritos? (existe <NAS>/RELEVO)
#   relevo-check.sh antes     → sale con error si lo tiene: el servicio no arranca (ExecCondition: se salta sin fallar).
#   relevo-check.sh vigilar   → si lo tiene, para el túnel y el servidor de este equipo.
# Si el NAS no está montado, no se sabe: se sigue como estaba (sin NAS tampoco hay relevo).
set -uo pipefail
NAS=${XENXO_BACKUP_DIR:-/mnt/nas/xenxo-distritos}
[ -e "$NAS/RELEVO" ] || exit 0
case "${1:-vigilar}" in
  antes)
    echo "el NAS tiene el relevo de los distritos: no arranco (tools/district-host/relevo/README.md)" >&2
    exit 1 ;;
  *)
    if systemctl is-active --quiet cloudflared || systemctl is-active --quiet xenxo-distritos; then
      echo "el NAS tiene el relevo: paro cloudflared y xenxo-distritos"
      systemctl stop cloudflared xenxo-distritos
    fi ;;
esac

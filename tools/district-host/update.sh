#!/usr/bin/env bash
# Actualiza el servidor de distritos desde el repositorio: compila y reinicia.
#   sudo /opt/xenxo-distritos/update.sh            (como root; el repo está en /opt/xenxo-world)
set -euo pipefail
REPO=${XENXO_REPO:-/opt/xenxo-world}
cd "$REPO"
sudo -u xenxo git pull --ff-only
sudo -u xenxo npm ci --no-audit --no-fund
sudo -u xenxo npm run build:district-host
install -m 644 dist/distritos/district-host.js dist/distritos/distritos.capnp /opt/xenxo-distritos/
install -m 755 node_modules/workerd/bin/workerd /opt/xenxo-distritos/workerd
for f in backup.sh relevo-check.sh recuperar.sh; do install -m 755 "tools/district-host/$f" "/opt/xenxo-distritos/$f"; done
# El relevo del NAS usa exactamente el mismo servidor: se le copia en cada actualización.
NAS=${XENXO_BACKUP_DIR:-/mnt/nas/xenxo-distritos}
if [ -d "$NAS" ]; then
  mkdir -p "$NAS/bundle" "$NAS/relevo"
  cp dist/distritos/district-host.js dist/distritos/distritos.capnp node_modules/workerd/bin/workerd "$NAS/bundle/"
  chmod 755 "$NAS/bundle/workerd"
  cp tools/district-host/relevo/{docker-compose.yml,vigia.sh,devolver.sh,distritos.env.example,tunel.env.example,README.md} "$NAS/relevo/"
  echo "servidor copiado al NAS para el relevo ($NAS/bundle)"
fi
systemctl restart xenxo-distritos
sleep 2
curl -fsS http://127.0.0.1:8788/health && echo " · servidor de distritos en marcha"

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
install -m 755 tools/district-host/backup.sh /opt/xenxo-distritos/backup.sh
systemctl restart xenxo-distritos
sleep 2
curl -fsS http://127.0.0.1:8788/health && echo " · servidor de distritos en marcha"

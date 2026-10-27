#!/usr/bin/env bash
# Instala el servidor de distritos en Ubuntu Server 24.04 (o Debian 12). Ejecútalo como root:
#   sudo bash tools/district-host/install.sh
# Antes: Node.js 22 instalado y este repositorio clonado en /opt/xenxo-world (ver README.md).
set -euo pipefail
REPO=${XENXO_REPO:-/opt/xenxo-world}
apt-get update -y
apt-get install -y sqlite3 curl unattended-upgrades
id xenxo >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/xenxo-home --shell /usr/sbin/nologin xenxo
chown -R xenxo:xenxo "$REPO"
install -d -o xenxo -g xenxo -m 750 /var/lib/xenxo-distritos /var/lib/xenxo-distritos/datos
install -d -m 755 /opt/xenxo-distritos
if [ ! -f /etc/xenxo-distritos.env ]; then
  install -m 640 -o root -g xenxo "$REPO/tools/district-host/xenxo-distritos.env.example" /etc/xenxo-distritos.env
  echo "Edita /etc/xenxo-distritos.env y pon la clave pública (DISTRICT_PUBLIC_KEY)."
fi
install -m 644 "$REPO/tools/district-host/xenxo-distritos.service" /etc/systemd/system/
install -m 644 "$REPO/tools/district-host/xenxo-distritos-backup.service" /etc/systemd/system/
install -m 644 "$REPO/tools/district-host/xenxo-distritos-backup.timer" /etc/systemd/system/
systemctl daemon-reload
# El portátil no se suspende al cerrar la tapa.
mkdir -p /etc/systemd/logind.conf.d
printf '[Login]\nHandleLidSwitch=ignore\nHandleLidSwitchExternalPower=ignore\nHandleLidSwitchDocked=ignore\n' > /etc/systemd/logind.conf.d/xenxo-tapa.conf
XENXO_REPO="$REPO" bash "$REPO/tools/district-host/update.sh"
systemctl enable --now xenxo-distritos xenxo-distritos-backup.timer
echo "Listo. Falta el túnel de Cloudflare (README.md, paso 5)."

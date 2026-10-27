#!/usr/bin/env bash
# Devuelve los distritos al portátil (paso 1 de 2, en el NAS, como root). Para el relevo y deja sus
# datos en <NAS>/devuelto/. Después, en el portátil: sudo /opt/xenxo-distritos/recuperar.sh
# El Programador de tareas de DSM no incluye /usr/local/bin (donde está docker).
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
set -euo pipefail
BASE=${XENXO_NAS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
HERE="$BASE/relevo"
[ -e "$BASE/RELEVO" ] || { echo "el NAS no tiene el relevo: nada que devolver"; exit 1; }
touch "$HERE/PARADO"   # el vigía no lo vuelve a levantar
if docker compose version >/dev/null 2>&1; then docker compose -p xenxo-relevo -f "$HERE/docker-compose.yml" down
else docker-compose -p xenxo-relevo -f "$HERE/docker-compose.yml" down; fi
rm -rf "$BASE/devuelto"
cp -a "$HERE/datos" "$BASE/devuelto"
date -Is > "$BASE/devuelto/HECHA"
echo "Relevo parado. Datos en $BASE/devuelto. Ahora, en el portátil: sudo /opt/xenxo-distritos/recuperar.sh"

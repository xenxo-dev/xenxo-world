#!/usr/bin/env bash
# Vigía del relevo de los distritos. Va en el NAS y lo lanza el Programador de tareas de DSM cada minuto
# (como root). Si el servidor de distritos no responde desde fuera durante FALLOS_MAX minutos seguidos,
# pero internet sí funciona, el NAS toma el relevo con la última copia (como mucho 15 min de cambios
# perdidos) y deja la marca RELEVO: el portátil, al volver, se aparta solo (relevo-check.sh).
# Devolverlo al portátil es a mano: devolver.sh aquí y recuperar.sh allí.
# El Programador de tareas de DSM no incluye /usr/local/bin (donde está docker).
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
set -uo pipefail
BASE=${XENXO_NAS_DIR:-$(cd "$(dirname "$0")/.." && pwd)}
HERE="$BASE/relevo"
URL=${XENXO_DISTRITOS_URL:-https://distritos.xenxo.io/health}
CONTROL=${XENXO_CONTROL_URL:-https://api.xenxo.io/health}
FALLOS_MAX=${XENXO_FALLOS_MAX:-3}
COUNT="$HERE/.fallos"
LOG="$HERE/vigia.log"

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose -f "$HERE/docker-compose.yml" "$@"
  else docker-compose -f "$HERE/docker-compose.yml" "$@"; fi
}
log() { echo "$(date -Is) $*" >> "$LOG"; }

# Con el relevo tomado: que siga en marcha (salvo que se esté devolviendo).
if [ -e "$BASE/RELEVO" ]; then
  [ -e "$HERE/PARADO" ] && exit 0
  compose up -d >/dev/null 2>&1 || log "no se pudo levantar el relevo"
  exit 0
fi

if curl -fsS -m 10 -o /dev/null "$URL" 2>/dev/null; then
  rm -f "$COUNT"
  exit 0
fi
# Si tampoco llega a Cloudflare, el problema es la conexión de casa: el relevo no ayudaría.
if ! curl -fsS -m 10 -o /dev/null "$CONTROL" 2>/dev/null; then
  log "sin internet: no hago nada"
  exit 0
fi
n=$(( $(cat "$COUNT" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$COUNT"
log "los distritos no responden ($n/$FALLOS_MAX)"
[ "$n" -lt "$FALLOS_MAX" ] && exit 0

# Tomar el relevo.
if [ ! -e "$BASE/ultima/HECHA" ] || [ ! -x "$BASE/bundle/workerd" ]; then
  log "no hay copia o servidor en $BASE (ultima/, bundle/): no puedo tomar el relevo"
  exit 1
fi
{ date -Is; echo "el NAS ha tomado el relevo; copia de $(cat "$BASE/ultima/HECHA")"; } > "$BASE/RELEVO"
rm -rf "$HERE/datos.antes"
[ -d "$HERE/datos" ] && mv "$HERE/datos" "$HERE/datos.antes"
cp -a "$BASE/ultima" "$HERE/datos"
rm -f "$HERE/datos/HECHA" "$COUNT"
if compose up -d; then log "RELEVO TOMADO con la copia de $(cat "$BASE/ultima/HECHA")"
else log "RELEVO: no se pudo arrancar (mira Container Manager)"; fi

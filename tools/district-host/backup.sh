#!/usr/bin/env bash
# Copia de seguridad de cada distrito (sus bases SQLite) al NAS. La lanza xenxo-distritos-backup.timer
# cada 15 minutos. Usa `sqlite3 .backup`, que hace una copia coherente aunque el servidor esté en marcha.
#
#   <NAS>/ultima/        la última copia (la que usa el relevo del NAS si el portátil cae)
#   <NAS>/AAAA-MM-DD/    una copia por día, 30 días
#
# Si el NAS tiene el relevo (existe <NAS>/RELEVO), no copia nada: lo de este equipo está viejo y
# pisaría lo bueno. Ver relevo/README.md.
set -euo pipefail
SRC=${XENXO_DATA:-/var/lib/xenxo-distritos/datos}
DEST_ROOT=${XENXO_BACKUP_DIR:-/mnt/nas/xenxo-distritos}
KEEP_DAYS=${XENXO_BACKUP_DAYS:-30}

if [ -e "$DEST_ROOT/RELEVO" ]; then
  echo "el NAS tiene el relevo: no se copia (ver tools/district-host/relevo/README.md)"
  exit 0
fi

# 1) Copia nueva en una carpeta temporal del NAS y, cuando está entera, se cambia por `ultima`.
tmp="$DEST_ROOT/.nueva-$$"
rm -rf "$tmp"
mkdir -p "$tmp"
find "$SRC" -name '*.sqlite' -print0 | while IFS= read -r -d '' f; do
  rel=${f#"$SRC"/}
  mkdir -p "$tmp/$(dirname "$rel")"
  sqlite3 "$f" ".backup '$tmp/$rel'"
done
date -Is > "$tmp/HECHA"
if [ -d "$DEST_ROOT/ultima" ]; then mv "$DEST_ROOT/ultima" "$DEST_ROOT/.vieja-$$"; fi
mv "$tmp" "$DEST_ROOT/ultima"
rm -rf "$DEST_ROOT/.vieja-$$"

# 2) La primera copia de cada día se guarda aparte.
day="$DEST_ROOT/$(date +%F)"
if [ ! -d "$day" ]; then cp -a "$DEST_ROOT/ultima" "$day"; fi

# 3) Borra las copias diarias de más de KEEP_DAYS días.
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20??-??-??' -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "copia hecha en $DEST_ROOT/ultima"

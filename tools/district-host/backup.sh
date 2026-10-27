#!/usr/bin/env bash
# Copia de seguridad de cada distrito (sus bases SQLite) al NAS. La lanza xenxo-distritos-backup.timer
# cada noche. Usa `sqlite3 .backup`, que hace una copia coherente aunque el servidor esté en marcha.
set -euo pipefail
SRC=${XENXO_DATA:-/var/lib/xenxo-distritos/datos}
DEST_ROOT=${XENXO_BACKUP_DIR:-/mnt/nas/xenxo-distritos}
KEEP_DAYS=${XENXO_BACKUP_DAYS:-30}
day=$(date +%F)
dest="$DEST_ROOT/$day"
mkdir -p "$dest"
find "$SRC" -name '*.sqlite' -print0 | while IFS= read -r -d '' f; do
  rel=${f#"$SRC"/}
  mkdir -p "$dest/$(dirname "$rel")"
  sqlite3 "$f" ".backup '$dest/$rel'"
done
# Borra las copias de más de KEEP_DAYS días.
find "$DEST_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf {} +
echo "copia hecha en $dest"

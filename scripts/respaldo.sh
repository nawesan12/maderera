#!/bin/sh
#
# El respaldo diario de la base. Corre adentro del servicio `respaldo` del
# compose, no se llama a mano.
#
# No es una comodidad: las facturas emitidas son documentación fiscal, y
# perderlas es un problema del cliente ante ARCA. Sin esto, la única copia de
# los comprobantes de un año vive en el disco de una sola máquina.
#
# Tres decisiones que no son obvias:
#
# - **Se fija una vez por hora si ya está el de hoy**, en vez de dormir
#   veinticuatro horas entre volcado y volcado. Con el `sleep 86400` de antes,
#   la hora del respaldo era la del último reinicio del contenedor, y cada
#   reinicio hacía uno de más. Así sale uno por día, pasadas las 3 de la
#   mañana, haya o no reinicios.
# - **Se escribe con otro nombre y se renombra al final.** Un volcado cortado a
#   la mitad —la máquina se reinició, se llenó el disco— no puede quedar con el
#   nombre de un respaldo bueno. Antes de renombrarlo, `pg_restore --list`
#   comprueba que se puede leer.
# - **La copia fuera de la máquina es opcional pero es la que importa.** Un
#   respaldo en el mismo disco no sobrevive a que se pierda el disco. Con
#   `RCLONE_REMOTE` declarado, cada volcado nuevo sube también a ese destino
#   (ver docs/SERVIDOR-PROPIO.md para configurarlo).
#
# Variables: POSTGRES_USER, POSTGRES_DB, PGPASSWORD (las pone el compose),
# RESPALDO_DIAS (14 por omisión), RCLONE_REMOTE y RCLONE_DIAS (90).

set -u

CARPETA=/respaldos
DIAS="${RESPALDO_DIAS:-14}"
HORA_MINIMA=3

if [ -n "${RCLONE_REMOTE:-}" ] && ! command -v rclone >/dev/null 2>&1; then
  echo "[respaldo] instalando rclone para la copia fuera de la máquina"
  apk add --no-cache rclone >/dev/null || echo "[respaldo] no se pudo instalar rclone; los respaldos quedan solo en el disco" >&2
fi

respaldar() {
  hoy="$(date +%Y-%m-%d)"
  destino="$CARPETA/mjbj-$hoy.dump"
  temporal="$destino.parcial"

  echo "[respaldo] volcando la base en $destino"
  if ! pg_dump -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c -f "$temporal"; then
    echo "[respaldo] FALLÓ el volcado de $hoy" >&2
    rm -f "$temporal"
    return 1
  fi

  if ! pg_restore --list "$temporal" >/dev/null; then
    echo "[respaldo] FALLÓ: el volcado de $hoy no se puede leer" >&2
    rm -f "$temporal"
    return 1
  fi

  mv "$temporal" "$destino"
  echo "[respaldo] listo: $(du -h "$destino" | cut -f1)"

  # Los de hace más de DIAS días se borran, incluidos los que deja
  # `desplegar.sh` antes de cada migración.
  find "$CARPETA" -name "mjbj-*.dump" -mtime +"$DIAS" -delete
  find "$CARPETA" -name "antes-de-migrar-*.dump" -mtime +"$DIAS" -delete

  if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
    if rclone copyto "$destino" "$RCLONE_REMOTE/mjbj-$hoy.dump"; then
      echo "[respaldo] copiado a $RCLONE_REMOTE"
      rclone delete "$RCLONE_REMOTE" --min-age "${RCLONE_DIAS:-90}d" --include "mjbj-*.dump" ||
        echo "[respaldo] no se pudieron borrar los viejos de $RCLONE_REMOTE" >&2
    else
      echo "[respaldo] FALLÓ la copia a $RCLONE_REMOTE; el respaldo local está" >&2
    fi
  fi
}

mkdir -p "$CARPETA"

while true; do
  hora="$(date +%H)"
  if [ ! -f "$CARPETA/mjbj-$(date +%Y-%m-%d).dump" ] && [ "${hora#0}" -ge "$HORA_MINIMA" ]; then
    respaldar
  fi
  sleep 3600
done

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
# **El correo** lo exporta `scripts/correo.sh respaldar` (el cron de las
# 2:30, ver «Correo propio» en docs/SERVIDOR-PROPIO.md): Stalwart guarda todo
# —buzones, casillas, llaves DKIM— en una base que no se puede copiar
# mientras escribe, así que se para unos segundos y se exporta. Acá solo se
# rota y se sube fuera de la máquina el `correo-<fecha>.tar.gz` que deja.
#
# **Y los archivos**: las fotos subidas y los adjuntos de WhatsApp. Nunca se
# reescriben (cada nombre lleva un UUID), así que no hace falta una copia por
# día: un `.tar.gz` local los domingos, y fuera de la máquina un `rclone copy`
# diario que solo sube lo nuevo. `copy` y no `sync`, a propósito: un archivo
# borrado por error en el servidor no se borra también de la copia.
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

respaldar_archivos() {
  hoy="$1"
  if [ -z "$(ls -A /archivos/subidas 2>/dev/null)$(ls -A /archivos/privado 2>/dev/null)" ]; then
    return 0
  fi

  # Domingo (`%u` = 7), o si todavía no hay ninguno.
  if [ "$(date +%u)" = "7" ] || ! ls "$CARPETA"/archivos-*.tar.gz >/dev/null 2>&1; then
    destino="$CARPETA/archivos-$hoy.tar.gz"
    temporal="$destino.parcial"
    echo "[respaldo] empaquetando las fotos y los adjuntos en $destino"
    if tar -czf "$temporal" -C /archivos subidas privado && tar -tzf "$temporal" >/dev/null; then
      mv "$temporal" "$destino"
      echo "[respaldo] archivos listos: $(du -h "$destino" | cut -f1)"
    else
      echo "[respaldo] FALLÓ el respaldo de los archivos de $hoy" >&2
      rm -f "$temporal"
    fi
  fi

  if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
    for carpeta in subidas privado; do
      rclone copy "/archivos/$carpeta" "$RCLONE_REMOTE/archivos/$carpeta" ||
        echo "[respaldo] FALLÓ la copia de $carpeta a $RCLONE_REMOTE" >&2
    done
  fi
}

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

  respaldar_archivos "$hoy"

  # Los de hace más de DIAS días se borran, incluidos los que deja
  # `desplegar.sh` antes de cada migración.
  find "$CARPETA" -name "mjbj-*.dump" -mtime +"$DIAS" -delete
  find "$CARPETA" -name "correo-*.tar.gz" -mtime +"$DIAS" -delete
  find "$CARPETA" -name "antes-de-migrar-*.dump" -mtime +"$DIAS" -delete
  # Los de archivos son semanales: se guardan los dos últimos domingos.
  find "$CARPETA" -name "archivos-*.tar.gz" -mtime +15 -delete

  if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
    if rclone copyto "$destino" "$RCLONE_REMOTE/mjbj-$hoy.dump"; then
      echo "[respaldo] copiado a $RCLONE_REMOTE"
      if [ -f "$CARPETA/correo-$hoy.tar.gz" ]; then
        rclone copyto "$CARPETA/correo-$hoy.tar.gz" "$RCLONE_REMOTE/correo-$hoy.tar.gz" ||
          echo "[respaldo] FALLÓ la copia del correo a $RCLONE_REMOTE" >&2
      fi
      rclone delete "$RCLONE_REMOTE" --min-age "${RCLONE_DIAS:-90}d" --include "mjbj-*.dump" --include "correo-*.tar.gz" ||
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

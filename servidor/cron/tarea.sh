#!/bin/sh
# Dispara una tarea programada contra la aplicación, por la red interna.
#
# crond no les pasa las variables de entorno a sus tareas: el secreto lo deja
# en /run/secreto el arranque del contenedor (ver docker-compose.prod.yml) y se
# lee de ahí. wget y no curl: viene en la imagen y alcanza para un POST.
set -eu
TAREA="$1"
SECRETO="$(cat /run/secreto)"

if ! SALIDA="$(wget -q -O - -T 300 \
  --header "Authorization: Bearer ${SECRETO}" \
  --post-data "" \
  "http://app:3000/api/tareas/${TAREA}" 2>&1)"; then
  echo "$(date -Iseconds) ${TAREA} FALLÓ: ${SALIDA}"
  exit 1
fi

# La de cada minuto solo se anota si hizo algo: si no, el registro sería una
# línea por minuto diciendo cero.
case "${TAREA}:${SALIDA}" in
  cada-minuto:*'"hechos":0,"reintentos":0,"fallidos":0'*) ;;
  *) echo "$(date -Iseconds) ${TAREA} ${SALIDA}" ;;
esac

#!/usr/bin/env bash
#
# Copia una casilla desde el proveedor actual (Zoho) a la casilla propia, con
# imapsync. Se corre en el servidor, desde la carpeta del proyecto, después de
# crear la casilla de destino con `scripts/correo.sh alta`:
#
#   scripts/traer-correo.sh ventas@mjbj.com.ar
#   scripts/traer-correo.sh ventas@mjbj.com.ar imap.zoho.com    # otro servidor de origen
#
# **Se puede correr las veces que haga falta.** imapsync copia solo lo que
# falta, así que el plan es: una pasada larga ahora, con el MX todavía en
# Zoho, y otra corta el día que se cambia el MX, para traer lo que entró en el
# medio. No borra nada en el origen.
#
# Las claves se piden por teclado y viajan en archivos dentro de una carpeta
# temporal que se borra al terminar: nunca como argumento, que queda en el
# historial y en `ps`.
#
# Ver «Mudar las casillas desde otro proveedor» en docs/SERVIDOR-PROPIO.md.

set -euo pipefail
cd "$(dirname "$0")/.."

ENTORNO=.env.produccion
COMPOSE=(docker compose --env-file "$ENTORNO" -f docker-compose.prod.yml)
# La versión fija, como el resto del compose.
IMAGEN=gilleslamiral/imapsync:2.326

casilla="${1:-}"
# `imappro.zoho.com` es el IMAP de los planes pagos de Zoho; el plan gratis
# no da IMAP a las cuentas nuevas (ver la guía). Otro servidor, como
# segundo argumento.
origen="${2:-imappro.zoho.com}"

if ! [[ "$casilla" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
  echo "Uso: scripts/traer-correo.sh <casilla> [servidor-de-origen]" >&2
  exit 1
fi

contenedor="$("${COMPOSE[@]}" ps -q correo 2>/dev/null || true)"
if [ -z "$contenedor" ]; then
  echo "El servidor de correo no está corriendo (ver «Encenderlo» en la guía)." >&2
  exit 1
fi
# imapsync corre en la misma red que el servidor de correo y entra por su
# alias `mail.<dominio>`, con el certificado verificado como cualquier otro
# programa de correo.
red="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$contenedor")"
destino="$(docker inspect -f '{{.Config.Hostname}}.{{.Config.Domainname}}' "$contenedor" | sed 's/\.$//')"

claves="$(mktemp -d)"
trap 'rm -rf "$claves"' EXIT
chmod 700 "$claves"

read -r -s -p "Clave de $casilla en $origen (en Zoho, una «contraseña de aplicación» si tiene doble factor): " clave
echo
printf '%s' "$clave" > "$claves/origen"
read -r -s -p "Clave de $casilla en este servidor (la que dio «correo.sh alta»): " clave
echo
printf '%s' "$clave" > "$claves/destino"
unset clave

# --automap: «Sent», «Enviados», «Papelera»… van a sus equivalentes.
# --useuid y --syncinternaldates: las repeticiones son rápidas y cada correo
# conserva su fecha, que es por la que ordena el programa de correo.
docker run --rm --network "$red" \
  -v "$claves:/claves:ro" \
  "$IMAGEN" imapsync \
  --host1 "$origen" --port1 993 --ssl1 --user1 "$casilla" --passfile1 /claves/origen \
  --host2 "$destino" --port2 993 --ssl2 --user2 "$casilla" --passfile2 /claves/destino \
  --automap --useuid --syncinternaldates \
  --nolog --noreleasecheck

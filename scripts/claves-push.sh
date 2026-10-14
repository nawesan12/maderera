#!/usr/bin/env bash
#
# El par de claves VAPID de los avisos del panel en el teléfono.
#
# Sin estas claves el push está apagado: el panel se instala igual, pero el
# botón de «Activar avisos» dice que faltan y ninguna venta hace sonar nada.
# Se generan **una sola vez**: cada teléfono que activa los avisos queda atado a
# la clave pública, y cambiarla los deja a todos mudos hasta que vuelvan a
# activarlos uno por uno.
#
#   scripts/claves-push.sh                     muestra las tres líneas
#   scripts/claves-push.sh .env.produccion     las agrega al archivo
#
# Con un archivo, **no pisa claves que ya estén**: si el archivo ya tiene
# VAPID_PUBLIC_KEY con valor, se niega y no cambia nada.
#
# Usa openssl y nada más —el servidor no tiene Node fuera de los contenedores—.
# Es lo mismo que `npx web-push generate-vapid-keys`: una clave P-256, la
# pública como punto sin comprimir (65 bytes) y la privada como escalar (32
# bytes), las dos en base64url.
#
# Ver el paso 8 de docs/SERVIDOR-PROPIO.md.

set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "Hace falta openssl." >&2
  exit 1
fi

DESTINO="${1:-}"

if [ -n "$DESTINO" ] && [ -f "$DESTINO" ] && grep -Eq '^VAPID_PUBLIC_KEY="?[^"[:space:]]+' "$DESTINO"; then
  echo "$DESTINO ya tiene VAPID_PUBLIC_KEY. No se cambia: los teléfonos que ya" >&2
  echo "activaron los avisos dejarían de recibirlos. Si de verdad hay que" >&2
  echo "regenerarlas, borrar las tres líneas VAPID_* a mano y volver a correr esto." >&2
  exit 1
fi

trabajo="$(mktemp -d)"
trap 'rm -rf "$trabajo"' EXIT
chmod 700 "$trabajo"

openssl ecparam -name prime256v1 -genkey -noout -out "$trabajo/clave.pem" 2>/dev/null
openssl ec -in "$trabajo/clave.pem" -outform DER -out "$trabajo/clave.der" 2>/dev/null

# La clave en DER (SEC1) es siempre igual de larga para P-256: la privada son
# los 32 bytes que siguen a la cabecera de 7, y la pública los últimos 65.
base64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
privada="$(head -c 39 "$trabajo/clave.der" | tail -c 32 | base64url)"
publica="$(tail -c 65 "$trabajo/clave.der" | base64url)"

# Una comprobación de forma, por si alguna versión de openssl escribiera el DER
# distinto: 65 bytes son 87 caracteres en base64url, y 32 bytes son 43.
if [ "${#publica}" -ne 87 ] || [ "${#privada}" -ne 43 ]; then
  echo "Las claves no salieron con el largo esperado (pública ${#publica}, privada ${#privada})." >&2
  exit 1
fi

lineas="VAPID_PUBLIC_KEY=\"$publica\"
VAPID_PRIVATE_KEY=\"$privada\"
VAPID_SUBJECT=\"mailto:info@mjbj.com.ar\""

if [ -z "$DESTINO" ]; then
  echo "$lineas"
  exit 0
fi

{
  echo
  echo "# Avisos del panel en el teléfono. Generadas con scripts/claves-push.sh el $(date +%Y-%m-%d)."
  echo "# No cambiarlas: los teléfonos que ya activaron los avisos quedan atados a esta clave."
  echo "$lineas"
} >> "$DESTINO"

echo "Listo: las claves están en $DESTINO."
echo "Para que la aplicación las tome hay que reiniciarla (scripts/desplegar.sh, o dc up -d --force-recreate app)."

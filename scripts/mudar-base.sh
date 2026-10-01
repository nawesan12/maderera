#!/usr/bin/env bash
#
# Mudanza de la base: de Neon al Postgres del servidor propio.
#
# Se corre **una vez**, en el servidor, el día de la mudanza. Vuelca la base de
# Neon entera y la carga en el contenedor `db` del compose, **borrando lo que
# haya ahí**. Por eso pregunta dos veces y muestra a qué se está conectando
# antes de tocar nada.
#
# Lo que no hace, y hay que hacer aparte:
#
# - **Frenar las escrituras en Vercel.** Todo lo que se venda en el sitio
#   viejo después del volcado no llega a la base nueva. Lo que corresponde es
#   avisar, hacer la mudanza fuera del horario del local y cambiar el DNS
#   enseguida (ver docs/SERVIDOR-PROPIO.md).
# - Mudar las fotos: eso es `scripts/mudar-subidas.ts`, después de esto.
#
# Uso:
#   NEON_URL='postgresql://usuario:clave@ep-....neon.tech/neondb?sslmode=require' \
#     ./scripts/mudar-base.sh
#
# La URL de Neon tiene que ser la **directa**, no la del pooler (la que dice
# `-pooler` en el host): `pg_dump` necesita una sesión entera y el pooler en
# modo transacción no se la da.

set -euo pipefail

cd "$(dirname "$0")/.."

ENTORNO=.env.produccion
COMPOSE=(docker compose --env-file "$ENTORNO" -f docker-compose.prod.yml)

if [ -z "${NEON_URL:-}" ]; then
  echo "Falta NEON_URL (la connection string directa de Neon). Ver el encabezado de este script." >&2
  exit 1
fi
if [ ! -f "$ENTORNO" ]; then
  echo "Falta $ENTORNO." >&2
  exit 1
fi
if [[ "$NEON_URL" == *-pooler* ]]; then
  echo "La URL apunta al pooler de Neon. Usá la conexión directa (sin -pooler en el host)." >&2
  exit 1
fi

# La misma versión de Postgres que corre en el servidor: un `pg_dump` más viejo
# que la base de origen se niega a volcarla.
IMAGEN_PG=postgres:17-alpine
VOLCADO="respaldos/neon-$(date +%Y-%m-%d-%H%M).dump"
mkdir -p respaldos

origen_host="$(sed -E 's#^[a-z]+://[^@]*@([^/:?]+).*#\1#' <<<"$NEON_URL")"

echo "Origen:  $origen_host (Neon)"
echo "Destino: el contenedor db de este servidor"
echo
echo "Se va a BORRAR todo lo que haya en la base del servidor y reemplazarlo"
echo "por lo de Neon."
read -r -p "¿Seguir? Escribí «mudar» para confirmar: " respuesta
if [ "$respuesta" != "mudar" ]; then
  echo "Cancelado. No se tocó nada."
  exit 1
fi

echo "→ Volcando Neon en $VOLCADO"
docker run --rm -e NEON_URL "$IMAGEN_PG" \
  sh -c 'pg_dump "$NEON_URL" -F c --no-owner --no-privileges' > "$VOLCADO"
echo "  $(du -h "$VOLCADO" | cut -f1)"

# Un volcado que no se puede leer no puede ser lo que reemplace a la base.
docker run --rm -i "$IMAGEN_PG" pg_restore --list < "$VOLCADO" > /dev/null
echo "  el volcado se lee bien"

echo "→ Levantando la base del servidor"
"${COMPOSE[@]}" up -d --wait db

# Lo que haya ahora en el servidor también se guarda: si la base ya tenía algo
# —una prueba, una mudanza anterior—, que se pueda volver.
previo="respaldos/antes-de-mudar-$(date +%Y-%m-%d-%H%M).dump"
# shellcheck disable=SC2016 # las variables las expande el shell del contenedor
"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c' > "$previo"
echo "  lo que había quedó en $previo"

read -r -p "Último aviso: ¿reemplazar la base del servidor? [s/N] " respuesta
if [ "$respuesta" != "s" ] && [ "$respuesta" != "S" ]; then
  echo "Cancelado. El volcado de Neon quedó en $VOLCADO."
  exit 1
fi

# La aplicación no puede estar escribiendo mientras se reemplaza la base.
"${COMPOSE[@]}" stop app 2>/dev/null || true

echo "→ Cargando en el servidor"
# shellcheck disable=SC2016 # las variables las expande el shell del contenedor
"${COMPOSE[@]}" exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -q' <<'SQL'
DROP SCHEMA IF EXISTS drizzle CASCADE;
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
SQL

# Sin `--exit-on-error` a propósito: el volcado de Neon puede traer cosas
# propias de Neon —extensiones, permisos de sus roles— que acá no existen y no
# hacen falta. `pg_restore` las informa, sigue con el resto y al final avisa
# que hubo errores. Hay que leerlos: si son de eso, está bien; si alguno nombra
# una tabla de la aplicación, no.
# shellcheck disable=SC2016
if ! "${COMPOSE[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges' < "$VOLCADO"; then
  echo
  echo "pg_restore informó errores (arriba). Revisalos antes de seguir."
fi

echo "→ Comprobando"
# shellcheck disable=SC2016
"${COMPOSE[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' <<'SQL'
SELECT 'tablas: ' || count(*) FROM information_schema.tables WHERE table_schema = 'public';
SELECT 'migraciones aplicadas: ' || count(*) FROM drizzle.__drizzle_migrations;
SELECT 'productos: ' || count(*) FROM products;
SQL

echo
echo "Listo. Lo que sigue (ver docs/SERVIDOR-PROPIO.md):"
echo "  1. scripts/mudar-subidas.ts, para traer las fotos de Vercel Blob."
echo "  2. ./scripts/desplegar.sh --sin-pull"

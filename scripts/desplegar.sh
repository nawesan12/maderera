#!/usr/bin/env bash
#
# Despliegue en el servidor propio.
#
# Reemplaza al push que disparaba el deploy en Vercel. Hace lo mismo que se
# hacía a mano, en el orden que importa:
#
#   1. Trae el código.
#   2. Construye las dos imágenes: la de la aplicación y la del migrador.
#   3. **Respalda la base antes de migrar.** Una migración que sale mal con el
#      respaldo de ayer pierde un día de facturación; con el de hace un minuto,
#      no pierde nada.
#   4. Migra, en un contenedor de un solo uso. **Si falla, se corta acá**: la
#      aplicación que está corriendo sigue siendo la vieja, contra el esquema
#      viejo, y no se entera de nada.
#   5. Recién ahí cambia el contenedor de la aplicación por el nuevo.
#
# El orden es el de siempre y por el mismo motivo: si se levanta primero el
# código nuevo, corre contra el esquema viejo.
#
# Uso: ./scripts/desplegar.sh            (trae el código con git pull)
#      ./scripts/desplegar.sh --sin-pull (despliega lo que ya hay en la carpeta)

set -euo pipefail

cd "$(dirname "$0")/.."

ENTORNO=.env.produccion
COMPOSE=(docker compose --env-file "$ENTORNO" -f docker-compose.prod.yml)

if [ ! -f "$ENTORNO" ]; then
  echo "Falta $ENTORNO. Copiá .env.example y completalo (ver docs/SERVIDOR-PROPIO.md)." >&2
  exit 1
fi

# Lo mínimo para que el despliegue tenga sentido. El compose también se queja
# si falta alguna, pero tarde y en inglés.
faltan=()
for variable in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DOMINIO APP_URL BETTER_AUTH_SECRET BETTER_AUTH_URL; do
  if ! grep -Eq "^${variable}=\"?[^\"[:space:]]+" "$ENTORNO"; then
    faltan+=("$variable")
  fi
done
if [ ${#faltan[@]} -gt 0 ]; then
  echo "En $ENTORNO faltan: ${faltan[*]}" >&2
  exit 1
fi

# Lo que no frena el despliegue pero apaga algo que la clienta pidió. Se avisa
# y se sigue: el sitio anda igual, y cortar acá dejaría sin desplegar un
# arreglo urgente por una clave que se puede agregar después.
avisos=()
for variable in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY; do
  if ! grep -Eq "^${variable}=\"?[^\"[:space:]]+" "$ENTORNO"; then
    avisos+=("$variable")
  fi
done
if [ ${#avisos[@]} -gt 0 ]; then
  echo "Aviso: en $ENTORNO faltan ${avisos[*]}." >&2
  echo "  Sin eso, el panel no avisa en el teléfono cuando entra una venta." >&2
  echo "  Se generan una sola vez con: scripts/claves-push.sh $ENTORNO" >&2
  echo >&2
fi

if [ "${1:-}" != "--sin-pull" ]; then
  echo "→ Trayendo el código"
  git pull --ff-only
fi

GIT_SHA="$(git rev-parse --short=12 HEAD)"
export GIT_SHA
echo "→ Desplegando $GIT_SHA"

# Las carpetas que el compose monta desde el disco del servidor. Si no
# existieran, Docker las crearía como root y vacías; mejor que existan desde ya.
mkdir -p respaldos secretos/arca secretos/rclone

echo "→ Levantando la base (el build la necesita)"
"${COMPOSE[@]}" up -d --wait db

# La imagen que está corriendo queda guardada con otro nombre: es la vuelta
# atrás si la nueva sale mal (ver «Volver a la versión anterior» en
# docs/SERVIDOR-PROPIO.md).
if docker image inspect mjbj-app:latest >/dev/null 2>&1; then
  docker image tag mjbj-app:latest mjbj-app:anterior
fi

# Primero el migrador y la migración, después la aplicación. El build de la
# aplicación prerenderiza páginas que leen la base: si el código nuevo lee una
# columna que trae la migración, construirlo contra el esquema viejo falla. Al
# revés el riesgo es menor —la versión que sigue corriendo convive un par de
# minutos con columnas que no conoce—, y si el build falla después de migrar,
# la anterior sigue sirviendo.
echo "→ Construyendo el migrador"
"${COMPOSE[@]}" --profile herramientas build migrador

echo "→ Respaldando la base antes de migrar"
mkdir -p respaldos
respaldo="respaldos/antes-de-migrar-$(date +%Y-%m-%d-%H%M).dump"
# shellcheck disable=SC2016 # las variables las expande el shell del contenedor
"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -F c' > "$respaldo"
echo "  $respaldo ($(du -h "$respaldo" | cut -f1))"

echo "→ Migrando"
if ! "${COMPOSE[@]}" --profile herramientas run --rm migrador; then
  echo >&2
  echo "La migración FALLÓ. No se tocó la aplicación: sigue corriendo la versión anterior." >&2
  echo "El respaldo de antes de migrar está en $respaldo." >&2
  exit 1
fi

echo "→ Construyendo la aplicación"
if ! "${COMPOSE[@]}" build app; then
  echo >&2
  echo "El build FALLÓ después de migrar. La aplicación anterior sigue corriendo." >&2
  exit 1
fi

echo "→ Cambiando la aplicación por la nueva"
# `--wait` espera a que el chequeo de salud dé bien: si la imagen nueva no
# arranca —por ejemplo, porque falta APP_URL—, el script termina con error y
# lo dice, en vez de dar por bueno un contenedor que se reinicia en bucle.
if ! "${COMPOSE[@]}" up -d --no-deps --wait --wait-timeout 180 app; then
  echo >&2
  echo "La aplicación nueva no arrancó. Ver: docker compose --env-file $ENTORNO -f docker-compose.prod.yml logs app" >&2
  echo "Para volver a la anterior, ver «Volver a la versión anterior» en docs/SERVIDOR-PROPIO.md." >&2
  exit 1
fi

echo "→ Levantando el resto"
"${COMPOSE[@]}" up -d --no-deps web respaldo cron

# El correo propio solo si está encendido (`COMPOSE_PROFILES=correo` en
# $ENTORNO). Nombrarlo en `up` lo encendería aunque el perfil esté apagado: por
# eso se pregunta antes qué servicios ve el compose.
if "${COMPOSE[@]}" config --services | grep -qx correo; then
  echo "→ Levantando el correo"
  "${COMPOSE[@]}" up -d --no-deps correo webmail

  # **La primera vez, el servidor de correo se apaga si en dos minutos no
  # tiene ninguna casilla** (y vuelve a arrancar y a esperar, en bucle). Se
  # avisa acá, que es donde alguien está mirando.
  sleep 5
  if ! "${COMPOSE[@]}" exec -T correo test -s /tmp/docker-mailserver/postfix-accounts.cf 2>/dev/null; then
    echo
    echo "  El correo no tiene casillas todavía. En los próximos dos minutos:"
    dominio="$(grep -E '^DOMINIO=' "$ENTORNO" | tail -n1 | cut -d= -f2- | tr -d '"')"
    echo "    scripts/correo.sh alta postmaster@${dominio}"
    echo "  Ver «Correo propio» en docs/SERVIDOR-PROPIO.md."
  fi
fi

echo "→ Limpiando imágenes viejas"
docker image prune -f >/dev/null

echo
echo "Listo: $GIT_SHA. Estado:"
"${COMPOSE[@]}" ps

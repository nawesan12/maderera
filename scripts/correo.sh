#!/usr/bin/env bash
#
# El correo propio (Stalwart): la puesta en marcha, las casillas, los alias,
# los registros DNS y la recarga del certificado. Se corre en el servidor,
# desde la carpeta del proyecto:
#
#   scripts/correo.sh iniciar
#   scripts/correo.sh alta ventas@mjbj.com.ar
#   scripts/correo.sh alias info@mjbj.com.ar ventas@mjbj.com.ar
#   scripts/correo.sh dns
#
# Habla con Stalwart por su API de administración (JMAP, puerto 8080 dentro
# de la red de Docker, nunca publicado) con `stalwart-cli` en un contenedor de
# un solo uso. Valida lo que se escribe antes de tocar nada y genera las
# claves en vez de pedir que alguien invente una (una clave inventada en el
# mostrador es «maderera2026»).
#
# Ver «Correo propio» en docs/SERVIDOR-PROPIO.md.

set -euo pipefail
cd "$(dirname "$0")/.."

ENTORNO="${CORREO_ENTORNO:-.env.produccion}"
COMPOSE=(docker compose --env-file "$ENTORNO" -f docker-compose.prod.yml)
# Para ensayar en otra máquina: un compose más que pisa lo que ahí no puede
# ser igual. En el servidor no se declara.
if [ -n "${COMPOSE_ENSAYO:-}" ]; then
  COMPOSE+=(-f "$COMPOSE_ENSAYO")
fi

# La versión de la herramienta, fija como la del servidor. Habla con el
# servidor leyendo su esquema, así que no tiene que coincidir número a número.
CLI_IMAGEN="stalwartlabs/cli:1.0.13"

if [ ! -f "$ENTORNO" ]; then
  echo "Falta $ENTORNO (ver docs/SERVIDOR-PROPIO.md)." >&2
  exit 1
fi

# Vacía si no está: sin el `|| true`, un `grep` sin resultado cortaba el
# script en silencio (por el `pipefail`) cuando faltaba CORREO_DOMINIO.
leer_variable() {
  { grep -E "^$1=" "$ENTORNO" || true; } | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"
}
DOMINIO="$(leer_variable CORREO_DOMINIO)"
[ -n "$DOMINIO" ] || DOMINIO="$(leer_variable DOMINIO)"
if [ -z "$DOMINIO" ]; then
  echo "En $ENTORNO falta DOMINIO." >&2
  exit 1
fi
HOST="mail.$DOMINIO"
ADMIN="admin@$DOMINIO"
ADMIN_CLAVE="$(leer_variable CORREO_ADMIN_CLAVE)"

uso() {
  cat <<EOF
Uso: scripts/correo.sh <comando> [argumentos]

Puesta en marcha
  iniciar                        La primera vez: el servidor, el dominio $DOMINIO,
                                 la llave DKIM, el puerto 587 y el certificado de Caddy.
                                 Se puede volver a correr: lo que ya está no se toca.
  dns                            Los registros DNS que propone el servidor, para el panel del dominio.
  recargar-certificado           Que tome el certificado nuevo de Caddy (el worker lo hace solo cada día).
  respaldar                      Exporta todo (casillas, correos, llaves) a respaldos/correo-<fecha>.tar.gz.
                                 Para el correo unos segundos. Lo corre el cron de las 2:30.
  restaurar <archivo.tar.gz>     Vuelve a un respaldo. BORRA lo que hay ahora. Pide confirmación.

Casillas
  listar                         Las casillas.
  alta <correo> [clave]          Crea la casilla. Sin clave, genera una y la muestra una sola vez.
  clave <correo> [clave]         Cambia la clave. Sin clave, genera una.
  baja <correo>                  Borra la casilla Y SUS CORREOS. Pide confirmación.

Alias (otra dirección que llega a la misma casilla)
  alias <alias> <casilla>        Por ejemplo: alias info@$DOMINIO ventas@$DOMINIO

El panel web de Stalwart (cola, rechazos, IP bloqueadas, filtros) no se
publica: se entra con un túnel, «ssh -L 8081:127.0.0.1:8081 <servidor>», y
http://127.0.0.1:8081 con $ADMIN y CORREO_ADMIN_CLAVE.
EOF
}

corriendo() {
  "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx correo
}

# La red del compose, para que el contenedor de la herramienta llegue a
# `correo:8080` sin publicar el puerto.
red() {
  docker inspect -f '{{range $nombre, $_ := .NetworkSettings.Networks}}{{$nombre}}{{end}}' \
    "$("${COMPOSE[@]}" ps -q correo)"
}

# stalwart-cli con un usuario y una clave dados. La clave va por variable de
# entorno y no por argumento: un argumento se ve en `ps`. Sin `-i`: con él,
# la herramienta se comía lo que se escribe después (la confirmación de
# `baja`). Solo `aplicar` lo usa, para leer el plan.
cli_como() {
  local usuario="$1" clave="$2"
  shift 2
  STALWART_PASSWORD="$clave" docker run --rm ${CLI_ENTRADA:+-i} --network "$(red)" -e STALWART_PASSWORD \
    "$CLI_IMAGEN" --no-color --url http://correo:8080 --user "$usuario" "$@"
}

cli() {
  if [ -z "$ADMIN_CLAVE" ]; then
    echo "En $ENTORNO falta CORREO_ADMIN_CLAVE (ver docs/SERVIDOR-PROPIO.md)." >&2
    exit 1
  fi
  if ! corriendo; then
    echo "El servidor de correo no está corriendo. ¿Está COMPOSE_PROFILES=correo en $ENTORNO y se desplegó?" >&2
    exit 1
  fi
  cli_como "$ADMIN" "$ADMIN_CLAVE" "$@"
}

validar_correo() {
  local correo="$1"
  if ! [[ "$correo" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
    echo "«${correo}» no parece una dirección de correo (en minúsculas, sin espacios)." >&2
    exit 1
  fi
  if [[ "$correo" != *"@$DOMINIO" ]]; then
    echo "«${correo}» no es del dominio $DOMINIO: este servidor solo tiene casillas de su dominio." >&2
    exit 1
  fi
}

# 20 caracteres sin los que se confunden al dictarlos (0/O, 1/l/I). Se lee
# una cantidad fija de azar y se recorta con `cut`, que lee todo: con
# `tr < /dev/urandom | head`, el `head` corta la tubería y `pipefail` aborta
# el script.
clave_nueva() {
  head -c 1024 /dev/urandom | LC_ALL=C tr -dc 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789' | cut -c1-20
}

validar_clave() {
  local clave="$1"
  if [ "${#clave}" -lt 12 ]; then
    echo "La clave tiene que tener al menos 12 caracteres." >&2
    exit 1
  fi
  # Va adentro de un JSON: sin comillas ni barras invertidas.
  if [[ "$clave" == *'"'* || "$clave" == *'\'* ]]; then
    echo "La clave no puede llevar comillas dobles ni barras invertidas." >&2
    exit 1
  fi
}

mostrar_clave() {
  echo
  echo "  Casilla: $1"
  echo "  Clave:   $2"
  echo
  echo "Se muestra una sola vez: anotala ahora. Si se pierde, se cambia con «clave»."
}

# El id de una fila de `query`, por el valor de una columna.
id_de() {
  local objeto="$1" columna="$2" valor="$3"
  cli query "$objeto" | awk -v c="$columna" -v v="$valor" 'NR > 1 && $c == v { print $1; exit }'
}

id_dominio() {
  local id
  id="$(id_de Domain 2 "$DOMINIO")"
  if [ -z "$id" ]; then
    echo "El dominio $DOMINIO no está en el servidor: corré «scripts/correo.sh iniciar»." >&2
    exit 1
  fi
  echo "$id"
}

id_casilla() {
  local id
  id="$(id_de Account 2 "$1")"
  if [ -z "$id" ]; then
    echo "No existe la casilla $1 (ver «scripts/correo.sh listar»)." >&2
    exit 1
  fi
  echo "$id"
}

# La ruta del certificado que saca Caddy para mail.<dominio> (bloque `mail.`
# del Caddyfile, con el emisor fijo en Let's Encrypt), vista desde Stalwart.
CERTIFICADOS="/srv/caddy/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$HOST"

iniciar() {
  if [ -z "$ADMIN_CLAVE" ]; then
    echo "En $ENTORNO falta CORREO_ADMIN_CLAVE. Generala con «openssl rand -base64 24» y volvé a correr." >&2
    exit 1
  fi
  validar_clave "$ADMIN_CLAVE"

  # Los volúmenes son del usuario de Stalwart (2000), que no es root.
  "${COMPOSE[@]}" run --rm --no-deps -T --user 0 --entrypoint chown correo -R 2000:2000 /etc/stalwart /var/lib/stalwart

  local primera=0
  if ! "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint test correo -f /etc/stalwart/config.json; then
    primera=1
  fi

  if [ "$primera" = 1 ]; then
    echo "→ Primera vez: el servidor arranca en modo de instalación"
    local temporal
    temporal="$(clave_nueva)"
    CORREO_RECUPERACION="admin:$temporal" "${COMPOSE[@]}" up -d --no-deps --force-recreate correo
    sleep 8
    # Lo mismo que pide el asistente web. El registro va a la consola (con
    # archivo, en un contenedor no se ve nada) y el certificado no lo pide
    # Stalwart: lo saca Caddy.
    # La respuesta trae el administrador permanente que generó el servidor
    # («secret: "..."»): se usa una vez, para ponerle la clave de .env.
    local respuesta generado
    respuesta="$(cli_como admin "$temporal" update Bootstrap --json "{\"serverHostname\":\"$HOST\",\"defaultDomain\":\"$DOMINIO\",\"requestTlsCertificate\":false,\"generateDkimKeys\":true,\"tracer\":{\"@type\":\"Stdout\",\"enable\":true,\"level\":\"info\",\"ansi\":false}}")"
    generado="$(printf '%s\n' "$respuesta" | sed -n 's/^ *secret: "\(.*\)"$/\1/p' | head -n 1)"
    if [ -z "$generado" ]; then
      echo "No se pudo leer el administrador que generó el servidor." >&2
      exit 1
    fi
    echo "→ Instalado: arranca normal"
    "${COMPOSE[@]}" up -d --no-deps --force-recreate correo
    sleep 8
    # El administrador queda con la clave de .env.produccion, no con la que
    # inventó el servidor.
    local id_admin
    id_admin="$(cli_como "$ADMIN" "$generado" query Account | awk -v v="$ADMIN" 'NR > 1 && $2 == v { print $1; exit }')"
    cli_como "$ADMIN" "$generado" update Account "$id_admin" --json "{\"credentials\":{\"0\":{\"@type\":\"Password\",\"secret\":\"$ADMIN_CLAVE\"}}}" >/dev/null
    # Las llaves DKIM ya están generadas: que no roten solas. Con rotación
    # automática, cada 90 días saca llaves nuevas que habría que cargar a
    # mano en el DNS, y hasta entonces lo que sale falla DKIM. Para rotarlas
    # sin tocar el DNS hace falta darle a Stalwart la API de Cloudflare.
    local id_dominio_nuevo
    id_dominio_nuevo="$(cli_como "$ADMIN" "$ADMIN_CLAVE" query Domain | awk -v v="$DOMINIO" 'NR > 1 && $2 == v { print $1; exit }')"
    cli_como "$ADMIN" "$ADMIN_CLAVE" update Domain "$id_dominio_nuevo" --json '{"dkimManagement":{"@type":"Manual"}}' >/dev/null
  elif ! corriendo; then
    "${COMPOSE[@]}" up -d --no-deps correo
    sleep 8
  fi

  echo "→ El puerto 587 (envío con STARTTLS): los programas de correo y la app"
  printf '%s\n' '{"@type":"upsert","object":"NetworkListener","matchOn":["name"],"value":{"l":{"name":"submission","protocol":"smtp","bind":{"[::]:587":true}}}}' |
    CLI_ENTRADA=1 cli apply --file /dev/stdin >/dev/null 2>&1

  echo "→ El certificado de Caddy"
  if ! "${COMPOSE[@]}" exec -T correo test -f "$CERTIFICADOS/$HOST.crt"; then
    echo "  Caddy todavía no sacó el certificado de $HOST (¿el registro A de mail apunta acá?)."
    echo "  Cuando lo tenga, volvé a correr «scripts/correo.sh iniciar»."
  elif [ -z "$(cli query Certificate | awk 'NR > 1 { print $1; exit }')" ]; then
    cli create Certificate --json "{\"certificate\":{\"@type\":\"File\",\"filePath\":\"$CERTIFICADOS/$HOST.crt\"},\"privateKey\":{\"@type\":\"File\",\"filePath\":\"$CERTIFICADOS/$HOST.key\"}}" >/dev/null
    local certificado
    certificado="$(cli query Certificate | awk 'NR > 1 { print $1; exit }')"
    cli update SystemSettings --json "{\"defaultCertificateId\":\"$certificado\"}" >/dev/null
    cli create Action/ReloadTlsCertificates >/dev/null
  fi

  # Un puerto nuevo (el 587) recién escucha después de reiniciar.
  "${COMPOSE[@]}" restart correo >/dev/null

  echo
  echo "Listo. Lo que sigue:"
  echo "  scripts/correo.sh alta avisos@$DOMINIO   (la casilla con que manda la app: SMTP_USUARIO y SMTP_CLAVE)"
  echo "  scripts/correo.sh dns                     (los registros para el panel del dominio)"
}

comando="${1:-}"
[ $# -gt 0 ] && shift

case "$comando" in
  iniciar)
    iniciar
    ;;

  listar)
    cli query Account
    ;;

  alta)
    [ $# -ge 1 ] || { uso; exit 1; }
    validar_correo "$1"
    clave="${2:-$(clave_nueva)}"
    validar_clave "$clave"
    if [ -n "$(id_de Account 2 "$1")" ]; then
      echo "La casilla $1 ya existe (para cambiarle la clave: «clave»)." >&2
      exit 1
    fi
    cli create Account/User --json "{\"name\":\"${1%@*}\",\"domainId\":\"$(id_dominio)\",\"credentials\":{\"0\":{\"@type\":\"Password\",\"secret\":\"$clave\"}}}" >/dev/null
    mostrar_clave "$1" "$clave"
    ;;

  clave)
    [ $# -ge 1 ] || { uso; exit 1; }
    validar_correo "$1"
    clave="${2:-$(clave_nueva)}"
    validar_clave "$clave"
    cli update Account "$(id_casilla "$1")" --json "{\"credentials\":{\"0\":{\"@type\":\"Password\",\"secret\":\"$clave\"}}}" >/dev/null
    mostrar_clave "$1" "$clave"
    ;;

  baja)
    [ $# -eq 1 ] || { uso; exit 1; }
    validar_correo "$1"
    if [ "$1" = "$ADMIN" ]; then
      echo "$ADMIN es el administrador del servidor: no se borra." >&2
      exit 1
    fi
    id="$(id_casilla "$1")"
    echo "Se borra $1 con TODOS sus correos. No se puede deshacer (salvo desde un respaldo)."
    read -r -p "Escribí la dirección para confirmar: " confirmacion
    if [ "$confirmacion" != "$1" ]; then
      echo "No coincide; no se borró nada."
      exit 1
    fi
    cli delete Account --ids "$id" >/dev/null
    echo "Borrada."
    ;;

  alias)
    [ $# -eq 2 ] || { uso; exit 1; }
    validar_correo "$1"
    validar_correo "$2"
    if [ -n "$(id_de Account 2 "$1")" ]; then
      echo "$1 es una casilla, no puede ser alias de otra." >&2
      exit 1
    fi
    id="$(id_casilla "$2")"
    # Los alias son una lista: el nuevo va en la próxima posición.
    posicion="$(cli get Account "$id" | awk '/Email Aliases:/ { en = 1; next } en && /^    [0-9]+ / { n++ } en && /^[A-Z]/ { en = 0 } END { print n + 0 }')"
    cli update Account "$id" --field "aliases/$posicion={\"name\":\"${1%@*}\",\"domainId\":\"$(id_dominio)\"}" >/dev/null
    echo "Listo: lo que llegue a $1 entra en $2."
    ;;

  dns)
    cli get Domain "$(id_dominio)" --fields dnsZoneFile
    cat <<EOF

Así lo propone el servidor para un dominio que recibe todo acá. Antes de
cargarlo, mirá qué hay hoy en el panel del dominio:

- Si $DOMINIO todavía recibe en otro lado (Zoho, Google), no cambies el MX ni
  pongas «p=reject» en _dmarc hasta mudar las casillas: sumá esta IP al SPF
  que ya está (ip4:<IP>) y cargá las dos llaves DKIM (._domainkey).
- Los registros A o CNAME de mail, autoconfig y mta-sts van **sin el proxy**
  de Cloudflare (nube gris): el correo no pasa por Cloudflare.
- El PTR (DNS inverso) de la IP se pide en el panel de Hostinger: $HOST.
- Los CAA limitan quién emite certificados: si ya hay CAA en el dominio, que
  quede letsencrypt.org.
EOF
    ;;

  recargar-certificado)
    cli create Action/ReloadTlsCertificates >/dev/null
    echo "Listo: las conexiones nuevas usan el certificado que tiene Caddy hoy."
    ;;

  respaldar)
    # Sin el correo encendido no hay nada que respaldar (el cron corre igual).
    if ! corriendo; then
      exit 0
    fi
    hoy="$(TZ=America/Argentina/Buenos_Aires date +%Y-%m-%d)"
    mkdir -p respaldos
    destino="respaldos/correo-$hoy.tar.gz"
    # La base de Stalwart no se puede copiar mientras escribe: se para, se
    # exporta y se vuelve a levantar. Lo que llegue en esos segundos lo
    # reintenta el servidor que lo manda; nada se pierde.
    "${COMPOSE[@]}" stop correo >/dev/null
    if "${COMPOSE[@]}" run --rm --no-deps -T --entrypoint sh correo -c \
      'stalwart --config /etc/stalwart/config.json --export /tmp/exportado >/dev/null && tar -czf - -C /tmp/exportado .' \
      >"$destino.parcial" && [ -s "$destino.parcial" ] && tar -tzf "$destino.parcial" >/dev/null; then
      mv "$destino.parcial" "$destino"
      echo "Correo respaldado en $destino ($(du -h "$destino" | cut -f1))."
    else
      rm -f "$destino.parcial"
      echo "FALLÓ el respaldo del correo." >&2
      fallo=1
    fi
    "${COMPOSE[@]}" up -d --no-deps correo >/dev/null
    exit "${fallo:-0}"
    ;;

  restaurar)
    [ $# -eq 1 ] || { uso; exit 1; }
    [ -f "$1" ] || { echo "No existe $1." >&2; exit 1; }
    tar -tzf "$1" >/dev/null || { echo "$1 no es un respaldo válido." >&2; exit 1; }
    echo "Se reemplaza TODO el correo del servidor (casillas, correos, llaves) por el de $1."
    read -r -p "Escribí «restaurar» para seguir: " confirmacion
    [ "$confirmacion" = "restaurar" ] || { echo "No se tocó nada."; exit 1; }
    "${COMPOSE[@]}" stop correo >/dev/null
    "${COMPOSE[@]}" run --rm --no-deps -T --user 0 --entrypoint sh correo -c \
      'rm -rf /var/lib/stalwart/* /tmp/r && mkdir -p /tmp/r && tar -xzf - -C /tmp/r && chown -R 2000:2000 /var/lib/stalwart /tmp/r && su -s /bin/sh stalwart -c "stalwart --config /etc/stalwart/config.json --import /tmp/r" >/dev/null' <"$1"
    "${COMPOSE[@]}" up -d --no-deps correo >/dev/null
    echo "Restaurado. Probá entrar a una casilla."
    ;;

  ""|-h|--help|ayuda)
    uso
    ;;

  *)
    echo "No conozco «${comando}»." >&2
    uso
    exit 1
    ;;
esac

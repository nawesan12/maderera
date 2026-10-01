#!/usr/bin/env bash
#
# Las casillas de correo propias: altas, bajas, claves, alias, DKIM y los
# registros DNS. Se corre en el servidor, desde la carpeta del proyecto:
#
#   scripts/correo.sh alta ventas@mjbj.ar
#   scripts/correo.sh alias info@mjbj.ar ventas@mjbj.ar,admin@mjbj.ar
#   scripts/correo.sh dns
#
# Es una capa fina sobre `setup`, la herramienta de docker-mailserver, con dos
# cosas que agrega: valida lo que se escribe antes de tocar nada, y genera las
# claves en vez de pedir que alguien invente una (una clave inventada en el
# mostrador es «maderera2026»).
#
# Ver «Correo propio» en docs/SERVIDOR-PROPIO.md.

set -euo pipefail
cd "$(dirname "$0")/.."

ENTORNO=.env.produccion
COMPOSE=(docker compose --env-file "$ENTORNO" -f docker-compose.prod.yml)

if [ ! -f "$ENTORNO" ]; then
  echo "Falta $ENTORNO (ver docs/SERVIDOR-PROPIO.md)." >&2
  exit 1
fi

# El dominio, del mismo archivo que usa el compose. Sin comillas.
DOMINIO="$(grep -E '^DOMINIO=' "$ENTORNO" | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "$DOMINIO" ]; then
  echo "En $ENTORNO falta DOMINIO." >&2
  exit 1
fi

uso() {
  cat <<EOF
Uso: scripts/correo.sh <comando> [argumentos]

Casillas
  listar                         Las casillas y cuánto ocupan.
  alta <correo> [clave]          Crea la casilla. Sin clave, genera una y la muestra una sola vez.
  clave <correo> [clave]         Cambia la clave. Sin clave, genera una.
  baja <correo>                  Borra la casilla Y SUS CORREOS. Pide confirmación.

Alias (una dirección que reparte a otras)
  alias <alias> <destino>[,<destino>...]   Por ejemplo: alias info@$DOMINIO ventas@$DOMINIO,admin@$DOMINIO
  alias-listar
  alias-quitar <alias> <destino>

Puesta en marcha y control
  dkim                           Genera la llave DKIM (una vez) y muestra el registro DNS.
  dns                            Todos los registros DNS que hay que cargar, con la IP de este servidor.
  relay <host> <puerto> <usuario>   Manda todo lo que sale por un servicio de envío (pide la clave).
                                 Para cuando el límite de Hostinger (5 por minuto) no alcanza.
  cola                           Los correos que esperan salir (si hay muchos, algo anda mal).
  baneados                       Las IP que fail2ban bloqueó por probar claves.
  desbanear <ip>
EOF
}

# El servidor de correo tiene que estar levantado para todo menos `dns`.
setup() {
  if ! "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx correo; then
    echo "El servidor de correo no está corriendo. ¿Está COMPOSE_PROFILES=correo en $ENTORNO y se desplegó?" >&2
    exit 1
  fi
  "${COMPOSE[@]}" exec -T correo setup "$@"
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
}

mostrar_clave() {
  echo
  echo "  Casilla: $1"
  echo "  Clave:   $2"
  echo
  echo "Se muestra una sola vez: anotala ahora. Si se pierde, se cambia con «clave»."
}

ip_publica() {
  curl -fsS -4 --max-time 5 https://ifconfig.me 2>/dev/null || echo "<IP-DEL-SERVIDOR>"
}

comando="${1:-}"
[ $# -gt 0 ] && shift

case "$comando" in
  listar)
    setup email list
    ;;

  alta)
    [ $# -ge 1 ] || { uso; exit 1; }
    validar_correo "$1"
    clave="${2:-$(clave_nueva)}"
    validar_clave "$clave"
    setup email add "$1" "$clave"
    mostrar_clave "$1" "$clave"
    ;;

  clave)
    [ $# -ge 1 ] || { uso; exit 1; }
    validar_correo "$1"
    clave="${2:-$(clave_nueva)}"
    validar_clave "$clave"
    setup email update "$1" "$clave"
    mostrar_clave "$1" "$clave"
    ;;

  baja)
    [ $# -eq 1 ] || { uso; exit 1; }
    validar_correo "$1"
    echo "Se borra $1 con TODOS sus correos. No se puede deshacer (salvo desde un respaldo)."
    read -r -p "Escribí la dirección para confirmar: " confirmacion
    if [ "$confirmacion" != "$1" ]; then
      echo "No coincide; no se borró nada."
      exit 1
    fi
    setup email del -y "$1"
    ;;

  alias)
    [ $# -eq 2 ] || { uso; exit 1; }
    validar_correo "$1"
    IFS=',' read -r -a destinos <<<"$2"
    for destino in "${destinos[@]}"; do
      # El destino puede ser de afuera (un Gmail personal): solo se valida la forma.
      if ! [[ "$destino" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]]; then
        echo "«${destino}» no parece una dirección de correo." >&2
        exit 1
      fi
      setup alias add "$1" "$destino"
    done
    ;;

  alias-listar)
    setup alias list
    ;;

  alias-quitar)
    [ $# -eq 2 ] || { uso; exit 1; }
    setup alias del "$1" "$2"
    ;;

  dkim)
    # Una llave RSA de 2048: la de 1024 ya la marcan como débil, y las de 4096
    # no entran en un solo registro TXT en algunos paneles de DNS.
    setup config dkim keysize 2048 domain "$DOMINIO"
    echo
    echo "Registro a cargar en el DNS (tipo TXT):"
    "${COMPOSE[@]}" exec -T correo sh -c 'cat /tmp/docker-mailserver/rspamd/dkim/*.public.dns.txt 2>/dev/null || cat /tmp/docker-mailserver/rspamd/dkim/*.public.txt'
    ;;

  dns)
    ip="$(ip_publica)"
    cat <<EOF
Registros DNS para $DOMINIO (en el panel donde está el dominio).
Reemplazá <IP> si no salió sola: $ip

  Tipo  Nombre                     Valor
  ----  -------------------------  ---------------------------------------------
  A     mail                       $ip
  A     webmail                    $ip
  A     autoconfig                 $ip
  MX    @                          mail.$DOMINIO   (prioridad 10)
  TXT   @                          v=spf1 mx -all
  TXT   _dmarc                     v=DMARC1; p=none; rua=mailto:postmaster@$DOMINIO; adkim=s; aspf=s
  TXT   mail._domainkey            (lo da «scripts/correo.sh dkim»)
  SRV   _submissions._tcp          0 1 465 mail.$DOMINIO
  SRV   _imaps._tcp                0 1 993 mail.$DOMINIO

Y en el panel de Hostinger (no en el DNS): el PTR / DNS inverso de la IP $ip
tiene que ser mail.$DOMINIO.

Si las casillas van a estar en otro lado (correo de Hostinger, Google
Workspace), el MX y el SPF son los que diga ese proveedor, no estos.
EOF
    ;;

  relay)
    # La clave se pide por teclado y no por argumento: un argumento queda en
    # el historial del shell. `setup relay` la guarda en el volumen de
    # configuración, no en variables de entorno, como recomienda la
    # documentación de docker-mailserver.
    [ $# -eq 3 ] || { uso; exit 1; }
    read -r -s -p "Clave de $3 en $1: " clave_relay
    echo
    [ -n "$clave_relay" ] || { echo "Sin clave no se configura." >&2; exit 1; }
    setup relay add-domain "$DOMINIO" "$1" "$2"
    setup relay add-auth "$DOMINIO" "$3" "$clave_relay"
    echo "Listo: lo que sale de @$DOMINIO va por $1:$2. Probalo mandando un correo a una casilla de afuera."
    ;;

  cola)
    "${COMPOSE[@]}" exec -T correo postqueue -p
    ;;

  baneados)
    setup fail2ban
    ;;

  desbanear)
    [ $# -eq 1 ] || { uso; exit 1; }
    setup fail2ban unban "$1"
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

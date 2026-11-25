#!/usr/bin/env bash
# El benchmark de la migración, TS contra Go (ver README.md). Cada lado
# importa los mismos archivos sobre la misma base recién copiada de `tanda2`
# (bench_t13), con su servidor solo en la máquina: Go en :8213, TS en :8313.
#   BIN=<binario mjbj-t13> bench/tanda13/correr.sh
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
raiz="$(cd "$dir/../.." && pwd)"
cd "$raiz"
BIN="${BIN:-$dir/mjbj-t13}"
PG="${PG:-postgres://postgres:prueba@127.0.0.1:55480}"
BASE="$PG/bench_t13?sslmode=disable"
CORREO=bench13@prueba.test
CLAVE='una clave larga'
tsx="$(command -v tsx || true)"
[ -n "$tsx" ] || tsx="$raiz/node_modules/.bin/tsx"
[ -x "$tsx" ] || tsx="$raiz/../../../node_modules/.bin/tsx" # desde un worktree

[ -d "$dir/archivos" ] || "$tsx" "$dir/generar.ts"
mkdir -p "$dir/resultados"

recrear() {
  docker exec mjbj-go-pg dropdb -U postgres --if-exists --force bench_t13
  docker exec mjbj-go-pg createdb -U postgres -T tanda2 bench_t13
  DATABASE_URL="$BASE" "$BIN" usuario staff --email "$CORREO" --password "$CLAVE" --name Bench --role admin > /dev/null
}

esperar() { for _ in $(seq 1 120); do curl -sf "$1" > /dev/null 2>&1 && return 0; sleep 0.5; done; echo "no levantó $1"; exit 1; }

# --- Go ---
recrear
DATABASE_URL="$BASE" BETTER_AUTH_SECRET=secreto-del-benchmark-de-la-tanda-13-xx BETTER_AUTH_URL=http://localhost:3100 \
  API_ESCUCHAR=127.0.0.1:8213 "$BIN" api > "$dir/resultados/go.log" 2>&1 &
pid_go=$!
esperar http://127.0.0.1:8213/salud
cookie=$(curl -si -X POST http://127.0.0.1:8213/api/v1/sesion -H 'content-type: application/json' \
  -d "{\"correo\":\"$CORREO\",\"clave\":\"$CLAVE\"}" | awk -F': ' 'tolower($1)=="set-cookie"{split($2,a,";"); printf "%s; ", a[1]}')
"$tsx" "$dir/medir.ts" go http://127.0.0.1:8213 "$pid_go" "$cookie" | tee "$dir/resultados/go.txt"
kill "$pid_go"; wait "$pid_go" 2>/dev/null || true

# --- TS ---
recrear
usuario=$(docker exec mjbj-go-pg psql -U postgres -d bench_t13 -At -c "select id from \"user\" where email = '$CORREO'")
TZ=UTC DATABASE_URL="$BASE" DATABASE_POOL_MAX=20 BENCH_USUARIO="$usuario" PUERTO=8313 \
  "$tsx" --tsconfig tsconfig.json --conditions=react-server "$dir/ts-servidor.ts" > "$dir/resultados/ts.log" 2>&1 &
pid_ts=$!
esperar http://127.0.0.1:8313/salud
# El proceso que atiende es el hijo de tsx (el de más memoria).
pid_nodo=$(for p in $(pgrep -f "bench/tanda13/ts-servidor.ts"); do echo "$(ps -o rss= -p "$p") $p"; done | sort -rn | head -1 | awk '{print $2}')
"$tsx" "$dir/medir.ts" ts http://127.0.0.1:8313 "$pid_nodo" | tee "$dir/resultados/ts.txt"
kill "$pid_ts" 2>/dev/null || true; pkill -f "bench/tanda13/ts-servidor.ts" || true

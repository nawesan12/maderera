#!/usr/bin/env bash
# Levanta un lado del benchmark contra la base bench_t5 (ver README.md).
#   bench/tanda5/servir.sh go   # :8205 (binario mjbj-t5)
#   bench/tanda5/servir.sh ts   # :8305 (el TS de antes, node:http)
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
export DATABASE_URL="${BENCH_BASE:-postgres://postgres:prueba@127.0.0.1:55480/bench_t5?sslmode=disable}"
export DATABASE_POOL_MAX=20
case "$1" in
  go)
    export BETTER_AUTH_SECRET=secreto-del-benchmark-t5-de-32-caracteres BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8205
    exec "${BENCH_BINARIO:-$dir/mjbj-t5}" api
    ;;
  ts)
    export API_URL=http://127.0.0.1:8205 BENCH_USUARIO="$(docker exec mjbj-go-pg psql -U postgres -d bench_t5 -Atc "select id from \"user\" where email = 'bench5@mjbj.test'")"
    cd "$dir/../.."
    exec npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda5/ts-servidor.ts
    ;;
esac

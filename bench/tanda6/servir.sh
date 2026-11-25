#!/usr/bin/env bash
# Levanta un lado del benchmark contra la base bench_t6 (ver README.md).
#   bench/tanda6/servir.sh go   # :8206 (binario mjbj-t6, BENCH_BINARIO)
#   bench/tanda6/servir.sh ts   # :8306 (el TS de antes, node:http)
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)"
export DATABASE_URL="${BENCH_BASE:-postgres://postgres:prueba@127.0.0.1:55480/bench_t6?sslmode=disable}"
export DATABASE_POOL_MAX=20
# La clave del webhook del banco (no es de nadie): la misma en los dos lados.
export MP_WEBHOOK_SECRET="${FIRMA_SECRETO:-clave-del-banco}"
case "$1" in
  go)
    export BETTER_AUTH_SECRET=secreto-del-benchmark-t6-de-32-caracteres BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8206
    exec "${BENCH_BINARIO:-$dir/mjbj-t6}" api
    ;;
  ts)
    cd "$dir/../.."
    exec npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda6/ts-servidor.ts
    ;;
esac

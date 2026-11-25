#!/usr/bin/env bash
# Levanta el lado TS del benchmark en :8388 (ver README.md).
#   DATABASE_URL=…/bench_t8 BENCH_USUARIO=<id del admin> bench/tanda8/levantar-ts.sh
set -euo pipefail
raiz="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$raiz"
tsx="$(command -v tsx || true)"
[ -n "$tsx" ] || tsx="$raiz/node_modules/.bin/tsx"
[ -x "$tsx" ] || tsx="$raiz/../../../node_modules/.bin/tsx" # desde un worktree
export DATABASE_POOL_MAX="${DATABASE_POOL_MAX:-20}"
exec "$tsx" --tsconfig tsconfig.json --conditions=react-server bench/tanda8/ts-servidor.ts

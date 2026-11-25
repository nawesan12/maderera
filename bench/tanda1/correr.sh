#!/usr/bin/env bash
# El benchmark de la lectura de sesión, TS contra Go (ver README.md).
#   bench/tanda1/correr.sh <cookie> [vus] [duracion]
# Con los dos servidores ya levantados: Go en :8081, TS en :8091.
set -euo pipefail
cookie="$1"; vus="${2:-50}"; dur="${3:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { # pid archivo: rss (KB) y %cpu cada medio segundo
  while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done
}

medir() { # nombre url pid
  local nombre="$1" url="$2" pid="$3"
  echo "== $nombre (pid $pid)"
  # Calentar: el JIT de V8 y el pool de conexiones, para no medir el arranque.
  k6 run -q -e URL="$url" -e COOKIE="$cookie" -e VUS=10 -e DURACION=5s "$dir/sesion.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e COOKIE="$cookie" -e VUS="$vus" -e DURACION="$dur" \
     --summary-export "$salida/$nombre-k6.json" "$dir/sesion.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY'
import json, sys
k = json.load(open(sys.argv[1]))
d = k["metrics"]["http_req_duration"]
reqs = k["metrics"]["http_reqs"]
fallos = k["metrics"]["http_req_failed"]["value"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2:
        rss.append(int(p[0])); cpu.append(float(p[1]))
print(f'{sys.argv[3]:4} req/s={reqs["rate"]:8.0f}  p50={d["p(50)"]:6.2f}ms  p95={d["p(95)"]:6.2f}ms  p99={d["p(99)"]:6.2f}ms  '
      f'fallos={fallos*100:.2f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(pgrep -f "mjbj api" | head -1)
# tsx arranca un node hijo: el que hace el trabajo es el que más memoria usa.
pid_ts=$(for p in $(pgrep -f "bench/tanda1/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
medir go "http://127.0.0.1:8081/api/v1/sesion" "$pid_go"
medir ts "http://127.0.0.1:8091/" "$pid_ts"

#!/usr/bin/env bash
# El benchmark del plano de corte por HTTP, TS contra Go (ver README.md).
# Con los dos servidores levantados: Go en :8291, TS en :8391.
#   bench/tanda11/correr.sh [vus] [duracion]
set -euo pipefail
vus="${1:-20}"; dur="${2:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre url pid
  local nombre="$1" url="$2" pid="$3"
  k6 run -q -e URL="$url" -e VUS=5 -e DURACION=5s "$dir/plano.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e VUS="$vus" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/plano.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY'
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
print(f'{sys.argv[3]:10} req/s={k["metrics"]["http_reqs"]["rate"]:7.1f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'fallos={k["metrics"]["http_req_failed"]["value"]*100:.2f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(lsof -tiTCP:8291 -sTCP:LISTEN | head -1)
pid_ts=$(lsof -tiTCP:8391 -sTCP:LISTEN | head -1)
medir plano-go http://127.0.0.1:8291/api/v1/cortes/plano "$pid_go"
medir plano-ts http://127.0.0.1:8391/plano "$pid_ts"

#!/usr/bin/env bash
# El benchmark del catálogo público, TS contra Go (ver README.md).
# Con los dos servidores levantados contra la base tanda2: Go en :8082, TS en :8092.
#   bench/tanda2/correr.sh [vus] [duracion]
set -euo pipefail
vus="${1:-50}"; dur="${2:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # prueba lado url pid
  local nombre="$1-$2" url="$3" pid="$4"
  k6 run -q -e URL="$url" -e VUS=10 -e DURACION=5s "$dir/catalogo.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e VUS="$vus" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/catalogo.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY'
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
print(f'{sys.argv[3]:16} req/s={k["metrics"]["http_reqs"]["rate"]:7.0f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'fallos={k["metrics"]["http_req_failed"]["value"]*100:.2f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(pgrep -f "mjbj-bench api" | head -1)
pid_ts=$(for p in $(pgrep -f "bench/tanda2/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8082/api/v1/catalogo; T=http://127.0.0.1:8092
for lado in go ts; do
  if [ $lado = go ]; then pid=$pid_go; else pid=$pid_ts; fi
  [ $lado = go ] && u1="$G/productos/pagina?publico=true" || u1="$T/pagina"
  [ $lado = go ] && u2="$G/productos/pagina?busqueda=placa&publico=true" || u2="$T/pagina?busqueda=placa"
  [ $lado = go ] && u3="$G/productos/fenolico-{n}?publico=true" || u3="$T/ficha/fenolico-{n}"
  medir catalogo $lado "$u1" $pid
  medir busqueda $lado "$u2" $pid
  medir ficha $lado "$u3" $pid
done

#!/usr/bin/env bash
# El benchmark de los PDF, TS (pdf-lib) contra Go (internal/pdf). Ver README.md.
# Levanta los dos servidores (Go en :8292, TS en :8392), mide cada documento
# con su caso más grande del golden y los apaga.
#   bench/tanda12/correr.sh [vus] [duracion]
set -euo pipefail
vus="${1:-8}"; dur="${2:-10s}"
dir="$(cd "$(dirname "$0")" && pwd)"
raiz="$(cd "$dir/../.." && pwd)"
salida="$dir/resultados/vus-$vus"; mkdir -p "$salida"
tmp="$(mktemp -d)"

(cd "$raiz/backend" && go test -c -o "$tmp/pdf.test" ./internal/pdf)
(cd "$raiz/backend/internal/pdf" && PDF_BENCH_ESCUCHAR=127.0.0.1:8292 "$tmp/pdf.test" -test.run TestServidorBench -test.timeout 0 > "$tmp/go.log" 2>&1) &
(cd "$raiz" && npx tsx bench/tanda12/ts-servidor.ts > "$tmp/ts.log" 2>&1) &
trap 'pkill -f "$tmp/pdf.test" || true; pkill -f "bench/tanda12/ts-servidor.ts" || true; rm -rf "$tmp"' EXIT

for i in $(seq 1 60); do
  curl -sf -o /dev/null http://127.0.0.1:8292/remito/minimo && curl -sf -o /dev/null http://127.0.0.1:8392/remito/minimo && break
  sleep 1
done

pid_go=$(pgrep -f "$tmp/pdf.test" | head -1)
pid_ts=$(for p in $(pgrep -f "bench/tanda12/ts-servidor.ts"); do echo "$(ps -o rss= -p "$p") $p"; done | sort -rn | head -1 | awk '{print $2}')

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.25; done; }

medir() { # nombre url pid
  local nombre="$1" url="$2" pid="$3"
  k6 run -q -e URL="$url" -e VUS=2 -e DURACION=2s "$dir/pdf.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e VUS="$vus" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/pdf.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY' | tee -a "$salida/resumen.txt"
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
print(f'{sys.argv[3]:34} req/s={k["metrics"]["http_reqs"]["rate"]:8.1f}  p50={d["p(50)"]:8.2f}ms  p99={d["p(99)"]:8.2f}ms  '
      f'fallos={k["metrics"]["http_req_failed"]["value"]*100:.2f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

: > "$salida/resumen.txt"
for caso in \
  lista-precios/muy-larga reposicion/larga remito/muchas-lineas recibo/muchas-partes \
  resumen-cuenta/muy-largo certificado-retencion/largo comprobante/a-muchos-renglones \
  presupuesto/muchos-renglones corte/muchas-placas hoja-de-corte/muchas-placas reporte-ventas/larga \
  remito/minimo; do
  medir "${caso/\//-}-go" "http://127.0.0.1:8292/$caso" "$pid_go"
  medir "${caso/\//-}-ts" "http://127.0.0.1:8392/$caso" "$pid_ts"
done

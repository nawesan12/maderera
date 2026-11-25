#!/usr/bin/env bash
# El benchmark del mostrador y las ventas, TS contra Go (ver README.md).
# Con los dos lados levantados (servir.sh go / servir.sh ts) contra bench_t5.
#   bench/tanda5/correr.sh <cookie de Go> <sucursal> <variante> [vus] [duracion]
set -euo pipefail
cookie="$1"; sucursal="$2"; variante="$3"; vus="${4:-20}"; dur="${5:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre url pid modo [cookie] [vus]
  local nombre="$1" url="$2" pid="$3" modo="$4" ck="${5:-}" v="${6:-$vus}"
  local env=(-e URL="$url" -e COOKIE="$ck" -e MODO="$modo" -e SUCURSAL="$sucursal" -e VARIANTE="$variante")
  k6 run -q "${env[@]}" -e VUS=2 -e DURACION=3s "$dir/venta.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q "${env[@]}" -e VUS="$v" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/venta.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY'
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
ok = k["metrics"]["checks"]["value"] if "checks" in k["metrics"] else 1
print(f'{sys.argv[3]:14} req/s={k["metrics"]["http_reqs"]["rate"]:7.1f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'bien={ok*100:.1f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(pgrep -f "mjbj-t5 api" | head -1)
pid_ts=$(for p in $(pgrep -f "bench/tanda5/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8205/api/v1; T=http://127.0.0.1:8305
# La venta: 20 a la vez contra el mismo candado de la serie PED.
medir venta-go "$G/mostrador/ventas" "$pid_go" venta "$cookie"
medir venta-ts "$T/venta" "$pid_ts" venta
# La búsqueda del mostrador.
medir buscar-go "$G/mostrador/buscar?q=fenolico%2018&sucursal=$sucursal" "$pid_go" get "$cookie"
medir buscar-ts "$T/buscar?q=fenolico%2018&sucursal=$sucursal" "$pid_ts" get
# El listado de pedidos del panel.
medir pedidos-go "$G/admin/pedidos" "$pid_go" get "$cookie"
medir pedidos-ts "$T/pedidos" "$pid_ts" get
# La descarga de un lote de 25 ventas sin conexión, 5 cajas a la vez.
medir descarga-go "$G/mostrador/descarga" "$pid_go" descarga-go "$cookie" 5
medir descarga-ts "$T/descarga" "$pid_ts" descarga-ts "" 5

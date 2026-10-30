#!/usr/bin/env bash
# El benchmark del carrito, el webhook y la conciliación, TS contra Go (ver
# README.md). Con los dos lados levantados (servir.sh go / servir.sh ts).
#   bench/tanda6/correr.sh <cookie de Go> <sucursal> <variante> [duracion]
set -euo pipefail
cookie="$1"; sucursal="$2"; variante="$3"; dur="${4:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"
secreto="${FIRMA_SECRETO:-clave-del-banco}"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre url pid modo vus [cookie] [métrica]
  local nombre="$1" url="$2" pid="$3" modo="$4" v="$5" ck="${6:-}" metrica="${7:-http_req_duration}"
  local env=(-e URL="$url" -e COOKIE="$ck" -e MODO="$modo" -e SUCURSAL="$sucursal" -e VARIANTE="$variante" -e FIRMA_SECRETO="$secreto")
  k6 run -q "${env[@]}" -e VUS=2 -e DURACION=3s "$dir/checkout.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q "${env[@]}" -e VUS="$v" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/checkout.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" "$metrica" <<'PY'
import json, sys
k = json.load(open(sys.argv[1])); m = k["metrics"]; d = m[sys.argv[4]]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
ok = m["checks"]["value"] if "checks" in m else 1
rate = m["compras"]["rate"] if sys.argv[4] == "confirmar" and "compras" in m else m["http_reqs"]["rate"]
print(f'{sys.argv[3]:12} por_s={rate:7.1f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'bien={ok*100:.1f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(pgrep -f "mjbj-t6 api" | head -1)
pid_ts=$(for p in $(pgrep -f "bench/tanda6/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8206; T=http://127.0.0.1:8306
# Confirmar la compra, 20 a la vez (mismo candado de la serie PED).
medir compra-go "$G/api/v1" "$pid_go" compra-go 20 "" confirmar
medir compra-ts "$T" "$pid_ts" compra-ts 20 "" confirmar
# El webhook de Mercado Pago, firmado, 50 a la vez.
medir webhook-go "$G/api/pagos/webhook" "$pid_go" webhook 50
medir webhook-ts "$T/api/pagos/webhook" "$pid_ts" webhook 50
# La conciliación (3000 cobros, 2000 avisos), 20 a la vez.
medir pagos-go "$G/api/v1/admin/pagos?periodo=mes" "$pid_go" get 20 "$cookie"
medir pagos-ts "$T/pagos" "$pid_ts" get 20

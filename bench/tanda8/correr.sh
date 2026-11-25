#!/usr/bin/env bash
# El benchmark de compras, TS contra Go (ver README.md). Con los dos
# servidores levantados contra la base bench_t8: Go en :8288, TS en :8388.
#   bench/tanda8/correr.sh <cookie de Go> <id de un proveedor> <id del régimen IIBB-MI> [vus] [duracion]
set -euo pipefail
cookie="$1"; proveedor="$2"; regimen="$3"; vus="${4:-20}"; dur="${5:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre url pid cookie cuerpo vus
  local nombre="$1" url="$2" pid="$3" ck="$4" cuerpo="$5" v="$6"
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e CUERPO="$cuerpo" -e VUS=2 -e DURACION=3s "$dir/compras.k6.js" > /dev/null 2>&1 || true
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e CUERPO="$cuerpo" -e VUS="$v" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/compras.k6.js" > "$salida/$nombre-k6.txt" 2>&1 || true
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY' | tee -a "$salida/resumen.txt"
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
print(f'{sys.argv[3]:16} req/s={k["metrics"]["http_reqs"]["rate"]:7.1f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'fallos={k["metrics"]["http_req_failed"]["value"]*100:.2f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(for p in $(pgrep -f "mjbj-t8 api"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
pid_ts=$(for p in $(pgrep -f "bench/tanda8/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8288/api/v1/admin; T=http://127.0.0.1:8388
: > "$salida/resumen.txt"

medir proveedores-go "$G/proveedores" "$pid_go" "$cookie" "" "$vus"
medir proveedores-ts "$T/proveedores" "$pid_ts" "" "" "$vus"
medir ficha-go "$G/proveedores/$proveedor" "$pid_go" "$cookie" "" "$vus"
medir ficha-ts "$T/ficha?id=$proveedor" "$pid_ts" "" "" "$vus"
medir pagos-go "$G/compras/pagos" "$pid_go" "$cookie" "" "$vus"
medir pagos-ts "$T/pagos" "$pid_ts" "" "" "$vus"
medir libro-go "$G/compras/libro-iva/csv?periodo=2026-03" "$pid_go" "$cookie" "" "$vus"
medir libro-ts "$T/libro?periodo=2026-03" "$pid_ts" "" "" "$vus"
# Pagar con retención, 5 a la vez: Go toma el candado de los pagos; el TS no,
# y dos pagos simultáneos sacan el mismo número de certificado.
pago="{\"supplierId\":\"$proveedor\",\"total\":100000,\"medio\":\"transferencia\",\"retenciones\":[{\"regimenId\":\"$regimen\",\"base\":100000}]}"
medir pagar-go "$G/compras/pagos" "$pid_go" "$cookie" "$pago" 5
medir pagar-ts "$T/pagar?proveedor=$proveedor&regimen=$regimen" "$pid_ts" "" "" 5

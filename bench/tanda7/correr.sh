#!/usr/bin/env bash
# El benchmark de facturación, TS contra Go (ver README.md). Con el simulador
# de ARCA en :8407, Go en :8207 y el TS de antes en :8307, contra bench_t7.
#   bench/tanda7/correr.sh "<cookie de Go>" [vus] [duracion]
set -euo pipefail
cookie="$1"; vus="${2:-20}"; dur="${3:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"
secreto="Bearer secreto-interno-del-bench-t7"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre metodo url pid [cookie] [auth] [cuerpo] [autorizado]
  local nombre="$1" metodo="$2" url="$3" pid="$4" ck="${5:-}" au="${6:-}" cu="${7:-}" az="${8:-}"
  k6 run -q -e METODO="$metodo" -e URL="$url" -e COOKIE="$ck" -e AUTH="$au" -e CUERPO="$cu" -e VUS=5 -e DURACION=3s "$dir/facturacion.k6.js" > /dev/null 2>&1 || true
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e METODO="$metodo" -e URL="$url" -e COOKIE="$ck" -e AUTH="$au" -e CUERPO="$cu" -e AUTORIZADO="$az" -e VUS="$vus" -e DURACION="$dur" \
    --summary-export "$salida/$nombre-k6.json" "$dir/facturacion.k6.js" > "$salida/$nombre-k6.txt" 2>&1 || true
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY'
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
sin = k["metrics"].get("sin_cae", {}).get("count", 0)
n = k["metrics"]["http_reqs"]["count"]
print(f'{sys.argv[3]:16} req/s={k["metrics"]["http_reqs"]["rate"]:7.1f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'fallos={k["metrics"]["http_req_failed"]["value"]*100:.2f}%  sin_cae={sin}/{n}  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(for p in $(pgrep -f "bin/mjbj-t7 api"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
pid_ts=$(for p in $(pgrep -f "bench/tanda7/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8207/api/v1; T=http://127.0.0.1:8307
venta='{"orderId":"7e7e7e7e-0000-4000-8000-000000000007","receptorNombre":"Mostrador","usuarioId":"bench","lineas":[{"descripcion":"Clavos","unidad":"kg","cantidad":2,"precioUnitario":1500}]}'

# Emitir y pedir el CAE, 20 a la vez (la venta del mostrador), contra el ARCA
# simulado (60–180 ms por respuesta, y solo acepta el número siguiente).
medir emitir-go POST "$G/interno/facturacion/venta" "$pid_go" "" "$secreto" "$venta" 1
medir emitir-ts POST "$T/emitir" "$pid_ts" "" "" "" 1
# El libro IVA ventas de octubre en CSV (2000 comprobantes en el mes).
medir libro-go GET "$G/admin/facturacion/libro-iva/csv?periodo=2026-10" "$pid_go" "$cookie"
medir libro-ts GET "$T/libro?periodo=2026-10" "$pid_ts"
# El listado de la pantalla (los últimos 200, con lo cobrado y los medios).
medir listado-go GET "$G/admin/facturacion/comprobantes" "$pid_go" "$cookie"
medir listado-ts GET "$T/listado" "$pid_ts"

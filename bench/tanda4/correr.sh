#!/usr/bin/env bash
# El benchmark del panel de clientes, cuenta corriente, cheques y cobros, TS contra Go (ver README.md).
# Con los dos servidores levantados contra la base bench_t4: Go en :8284, TS en :8094.
#   bench/tanda4/correr.sh <cookie de Go> <id del cliente grande> [vus] [duracion]
set -euo pipefail
cookie="$1"; cliente="$2"; shift; vus="${2:-20}"; dur="${3:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre url pid [cookie] [cuerpo]
  local nombre="$1" url="$2" pid="$3" ck="${4:-}" cu="${5:-}"
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e CUERPO="$cu" -e VUS=5 -e DURACION=5s "$dir/panel.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e CUERPO="$cu" -e VUS="$vus" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/panel.k6.js" > "$salida/$nombre-k6.txt" 2>&1
  kill "$m" 2>/dev/null || true
  wait "$m" 2>/dev/null || true
  python3 - "$salida/$nombre-k6.json" "$salida/$nombre-recursos.txt" "$nombre" <<'PY'
import json, sys
k = json.load(open(sys.argv[1])); d = k["metrics"]["http_req_duration"]
rss, cpu = [], []
for l in open(sys.argv[2]):
    p = l.split()
    if len(p) == 2: rss.append(int(p[0])); cpu.append(float(p[1]))
print(f'{sys.argv[3]:14} req/s={k["metrics"]["http_reqs"]["rate"]:7.1f}  p50={d["p(50)"]:7.1f}ms  p95={d["p(95)"]:7.1f}ms  p99={d["p(99)"]:7.1f}ms  '
      f'fallos={k["metrics"]["http_req_failed"]["value"]*100:.2f}%  memoria_max={max(rss)/1024:.0f}MB  cpu_media={sum(cpu)/len(cpu):.0f}%')
PY
}

pid_go=$(pgrep -f "mjbj-bench api" | head -1)
pid_ts=$(for p in $(pgrep -f "bench/tanda4/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8284/api/v1/admin; T=http://127.0.0.1:8094
medir cartera-go "$G/clientes" "$pid_go" "$cookie"
medir cartera-ts "$T/clientes" "$pid_ts"
medir historial-go "$G/clientes/$cliente/historial?periodo=12m" "$pid_go" "$cookie"
medir historial-ts "$T/historial?id=$cliente" "$pid_ts"
medir cheques-go "$G/cheques" "$pid_go" "$cookie"
medir cheques-ts "$T/cheques" "$pid_ts"
# El cobro: un recibo de un peso por transferencia, 20 a la vez contra el mismo
# candado de la numeración.
medir cobro-go "$G/clientes/$cliente/cobros" "$pid_go" "$cookie" '{"partes":"[{\"medio\":\"transferencia\",\"importe\":\"1\"}]"}'
medir cobro-ts "$T/cobro?id=$cliente" "$pid_ts" "" "{}"


#!/usr/bin/env bash
# El benchmark de WhatsApp, TS contra Go (ver README.md). Con los dos
# servidores levantados contra la base bench_t9: Go en :8289, TS en :8389.
#   bench/tanda9/correr.sh <archivo con la cookie de Go> [vus] [duracion]
set -euo pipefail
cookie="$(cat "$1")"; vus="${2:-20}"; dur="${3:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"
base="${BASE:-postgres://postgres:prueba@127.0.0.1:55480/bench_t9}"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre script url pid vus [cookie] [prefijo]
  local nombre="$1" script="$2" url="$3" pid="$4" v="$5" ck="${6:-}" pre="${7:-x}"
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e VUS=5 -e DURACION=3s -e MENSAJES=200 -e PREFIJO="calienta-$pre" "$dir/$script" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e VUS="$v" -e DURACION="$dur" -e PREFIJO="$pre" --summary-export "$salida/$nombre-k6.json" "$dir/$script" > "$salida/$nombre-k6.txt" 2>&1
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

pendientes() { psql "$base" -tAc "select count(*) from trabajos where tipo = 'whatsapp.payload' and estado = 'pendiente'"; }

pid_go=$(for p in $(pgrep -f "mjbj-bench api"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
pid_ts=$(for p in $(pgrep -f "bench/tanda9/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')

# 1. Abrir la bandeja (1500 conversaciones, la primera con 20 mensajes).
# SOLO=bandeja corre solo esta parte.
medir bandeja-go bandeja.k6.js http://127.0.0.1:8289/api/v1/admin/whatsapp/bandeja "$pid_go" "$vus" "$cookie"
medir bandeja-ts bandeja.k6.js http://127.0.0.1:8389/bandeja "$pid_ts" "$vus"
[ "${SOLO:-}" = bandeja ] && exit 0

# 2. El webhook en ráfaga: 5000 mensajes, firma y a la cola (50 a la vez).
psql "$base" -qc "delete from trabajos where tipo = 'whatsapp.payload'"
medir webhook-go webhook.k6.js http://127.0.0.1:8289/api/whatsapp/webhook "$pid_go" 50 "" "go-$(date +%s)"
n_go=$(pendientes)
# 3. Y lo que tarda en procesarse lo encolado: los manejadores del worker de
# Go, sin la espera entre pasadas (internal/whatsapp/drenar_bench_test.go)…
(cd "$dir/../../backend" && MJBJ_BENCH_BASE="$base" go test -count=1 -run TestDrenarBench -v ./internal/whatsapp | grep drenaje-go) | tee -a "$salida/drenaje.txt"
echo "               ($n_go encolados)"

medir webhook-ts webhook.k6.js http://127.0.0.1:8389/api/whatsapp/webhook "$pid_ts" 50 "" "ts-$(date +%s)"
n_ts=$(pendientes)
# …y el manejador de antes (procesarPayload), de a uno como la cola del TS.
r=$(curl -s -X POST http://127.0.0.1:8389/drenar)
echo "drenaje-ts     $n_ts payloads: $r" | tee -a "$salida/drenaje.txt"

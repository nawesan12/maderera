#!/usr/bin/env bash
# El benchmark del panel de productos, precios y stock, TS contra Go (ver README.md).
# Con los dos servidores levantados contra la base tanda2: Go en :8082, TS en :8093.
#   bench/tanda3/correr.sh <cookie de Go> [vus] [duracion]
set -euo pipefail
cookie="$1"; vus="${2:-20}"; dur="${3:-20s}"
dir="$(cd "$(dirname "$0")" && pwd)"
salida="$dir/resultados"; mkdir -p "$salida"

muestrear() { while kill -0 "$1" 2>/dev/null; do ps -o rss=,%cpu= -p "$1" >> "$2" || true; sleep 0.5; done; }

medir() { # nombre url pid [cookie]
  local nombre="$1" url="$2" pid="$3" ck="${4:-}"
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e VUS=5 -e DURACION=5s "$dir/panel.k6.js" > /dev/null 2>&1
  : > "$salida/$nombre-recursos.txt"
  muestrear "$pid" "$salida/$nombre-recursos.txt" & local m=$!
  k6 run -q -e URL="$url" -e COOKIE="$ck" -e VUS="$vus" -e DURACION="$dur" --summary-export "$salida/$nombre-k6.json" "$dir/panel.k6.js" > "$salida/$nombre-k6.txt" 2>&1
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
pid_ts=$(for p in $(pgrep -f "bench/tanda3/ts-servidor.ts"); do echo "$(ps -o rss= -p $p) $p"; done | sort -rn | head -1 | awk '{print $2}')
G=http://127.0.0.1:8082/api/v1/admin; T=http://127.0.0.1:8093
for g in productos precios stock; do
  medir "$g-go" "$G/$g" "$pid_go" "$cookie"
  medir "$g-ts" "$T/$g" "$pid_ts"
done

# El ajuste masivo (+1 % y -1 % a las dos listas: 6400 precios con su
# historial, en una transacción), tres veces de cada lado.
echo "== ajuste masivo (segundos por corrida)"
for i in 1 2 3; do
  for lado in go ts; do
    p=$([ $((i % 2)) -eq 1 ] && echo 1 || echo -1)
    if [ $lado = go ]; then
      t=$(curl -s -o /dev/null -w "%{time_total}" -H "Cookie: $cookie" -H 'Content-Type: application/json' -X POST "$G/precios/ajuste" -d "{\"porcentaje\":\"$p\",\"listaSlug\":\"ambas\"}")
    else
      t=$(curl -s -o /dev/null -w "%{time_total}" "$T/ajuste?porcentaje=$p")
    fi
    echo "ajuste-$lado-$i $t" | tee -a "$salida/ajuste.txt"
  done
done

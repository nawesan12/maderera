# Benchmark de la tanda 11: el plano de corte, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo (i7-9750H, 6 núcleos). El lado
TS es `lib/cortes/plano.ts` de antes de la mudanza (9a17128), copiado tal
cual en `ts/` —es también lo que corre el golden—; por HTTP se sirve con
`calcularPlanoDeCorteSinTrabar` (lo que corría el servidor de Next). El lado
Go es `backend/internal/cortes` detrás de `/api/v1/cortes/plano`, que es lo
que ahora piden el mostrador, el alta del panel, el acomodo y `/corte`.

Antes de medir, `comparar.py` pide los 200 despieces a los dos servidores:
**0 de 200 distintos** (el golden ya lo cubre con 1761 planos).

## El motor solo: el banco de 200 despieces (antes `scripts/benchmark-plano.ts`)

| | TypeScript | Go |
|---|---:|---:|
| Placas, heurística sola | 559 | 559 |
| Placas, con búsqueda | 534 | 534 |
| ms por despiece, heurística | 0,2 | 0,19 |
| ms por despiece, con búsqueda | 16,2 | **11,4** |
| el peor despiece | 150 ms | **56 ms** |

Mismas placas (es el mismo cálculo, bit a bit). Go es ~1,4× más rápido en
promedio y el peor caso baja a un tercio (sin pausas del JIT ni del GC de V8).

## Por HTTP: un despiece del banco al azar por pedido (k6)

| | VUs | pedidos/s | p50 | p95 | p99 | memoria máx. |
|---|---:|---:|---:|---:|---:|---:|
| **Go** | 20 | **174,5** | **110 ms** | **216 ms** | **266 ms** | **53 MB** |
| TS | 20 | 28,3 | 454 ms | 2198 ms | 2944 ms | 154 MB |
| **Go** | 1 | 78,5 | 12,1 ms | 22,0 ms | 25,5 ms | 53 MB |
| TS | 1 | 69,8 | 12,8 ms | 29,6 ms | 47,0 ms | 147 MB |

De a uno empatan (el cálculo es el mismo y tarda lo mismo). Con 20 a la vez
Go reparte la búsqueda en los 6 núcleos y da **6× más pedidos por segundo**
con la cola 10× más corta; Node calcula de a uno aunque ceda el turno. La
columna de CPU de `correr.sh` sale de `ps`, que en macOS es un promedio que
decae: sirve para comparar, no como valor absoluto.

## Cómo repetirlo

```sh
docker exec mjbj-go-pg createdb -U postgres -T tanda2 bench_t11
npx tsx --tsconfig tsconfig.json bench/tanda11/ts-servidor.ts despieces    # escribe despieces.json
npx tsx --tsconfig tsconfig.json bench/tanda11/ts-servidor.ts              # :8391
DATABASE_URL=…/bench_t11 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8291 ./mjbj api
python3 bench/tanda11/comparar.py
bench/tanda11/correr.sh 20 20s

# el motor solo
npx tsx --tsconfig tsconfig.json bench/tanda11/ts/benchmark-plano.ts
cd backend && MJBJ_BANCO=1 go test -run TestBancoDelPlano -v ./internal/cortes/
```

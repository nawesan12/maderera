# Benchmark de la tanda 4: clientes, cuenta corriente, cheques y cobros, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo, contra el mismo Postgres 18 en
Docker, con la base `bench_t4` (copia de tanda2 + 2000 clientes, 61.500
movimientos de cuenta corriente, 3000 cheques y un cliente con 1530
movimientos). El lado TS es el DAL y `emitirRecibo` de antes de la mudanza
(git 398454c) servidos por `node:http`. Antes de medir se comprobó que la
cartera (con la deuda vencida y la prioridad), el historial y los cheques den
**lo mismo** en los dos lados.

20 a la vez, 20 segundos (k6), cero fallos:

| | | pedidos/s | p50 | p99 | memoria máx. |
|---|---|---:|---:|---:|---:|
| Cartera (2000 clientes con deuda y prioridad) | **Go** | **14,7** | **1,3 s** | **2,0 s** | **153 MB** |
| | TS | 3,6 | 5,2 s | 9,9 s | 583 MB |
| Historial de un cliente (200 renglones) | **Go** | **396** | **46 ms** | **112 ms** | 153 MB |
| | TS | 252 | 73 ms | 184 ms | 332 MB |
| Cheques (3000) | **Go** | **61** | **316 ms** | **605 ms** | 154 MB |
| | TS | 31 | 630 ms | 1,1 s | 341 MB |
| Cobro con recibo (mismo candado de numeración) | **Go** | **83** | **234 ms** | **374 ms** | 154 MB |
| | TS | 55 | 357 ms | 496 ms | 216 MB |

La cartera es 4 veces más rápida: el TS hacía el listado y después una
segunda consulta con todos los movimientos de los que deben; Go calcula la
deuda en la misma pasada. El cobro está atado al candado de la serie de
recibos (uno por vez, a propósito), y aun así Go saca 1,5×.

## Cómo repetirlo

```sh
DATABASE_URL=…/bench_t4 DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> \
  npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda4/ts-servidor.ts   # :8094
DATABASE_URL=…/bench_t4 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8284 ./mjbj-bench api
bench/tanda4/correr.sh "<cookie de sesión de Go>" <id del cliente grande> 20 20s
```

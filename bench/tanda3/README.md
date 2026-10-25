# Benchmark de la tanda 3: productos, precios y stock, TypeScript contra Go

Medido el 25/10/2026 en la Mac de desarrollo (i7-9750H, 6 núcleos), contra el
mismo Postgres 18 en Docker, con la base del benchmark de la tanda 2 (2000
productos, 3200 medidas, 6400 precios). El lado TS es el DAL y la acción de
antes de la mudanza (git dcdb751) servidos por `node:http`, con la sesión y la
caché de Next stubeadas (`ts/sesion.ts`, `ts/sin-next.ts`). Antes de medir se
comprobó que las tres grillas den lo mismo en los dos lados (la de precios
difiere solo en cómo se escribe la fecha: el mismo instante en UTC o en −03).

## Las grillas del panel: 20 a la vez, 20 segundos (k6), cero fallos

| Grilla | | pedidos/s | p50 | p99 | memoria máx. |
|---|---|---:|---:|---:|---:|
| Productos (2000) | **Go** | **27,0** | **0,69 s** | **1,4 s** | **87 MB** |
| | TS | 9,3 | 1,9 s | 4,4 s | 333 MB |
| Precios (3200 medidas, 2 listas) | **Go** | **30,1** | **0,66 s** | **0,97 s** | **140 MB** |
| | TS | 1,0 | 12,0 s | 25,9 s | 295 MB |
| Stock (3200 medidas, 2 sucursales) | **Go** | **23,3** | **0,86 s** | **1,1 s** | **140 MB** |
| | TS | 8,7 | 2,2 s | 4,1 s | 504 MB |

**Precios: 30 veces más pedidos por segundo.** El TS cruzaba cada medida con
`precios.find(...)` sobre los 6400 precios y otro recorrido para la fecha
(n² en JavaScript); Go arma un mapa una vez.

## El ajuste masivo: ±1 % a las dos listas (6400 precios con su historial)

| Corrida | Go | TS |
|---|---:|---:|
| 1 | 24,3 s | 37,7 s |
| 2 | 33,2 s | 44,9 s |
| 3 | 21,2 s | 32,4 s |

Go 1,4× más rápido, pero **lento en los dos**: es el algoritmo heredado, que
por cada precio hace tres idas a la base (leer el anterior, escribir el
precio, escribir el historial). Lo que sigue es hacerlo en lote (un
`UPDATE … FROM` y un `INSERT … SELECT` por lista): baja de decenas de segundos
a menos de uno. Queda anotado en docs/go/progreso.md.

## Cómo repetirlo

```sh
DATABASE_URL=…/tanda2 DATABASE_POOL_MAX=20 BENCH_USUARIO=<id del admin> \
  npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda3/ts-servidor.ts   # :8093
DATABASE_URL=…/tanda2 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=:8082 ./mjbj api
bench/tanda3/correr.sh "<cookie de sesión de Go>" 20 20s
```

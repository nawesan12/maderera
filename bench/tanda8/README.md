# Benchmark de la tanda 8: compras, proveedores y retenciones, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo (i7-9750H, 6 núcleos), contra el
mismo Postgres 18 en Docker, con la base `bench_t8`: la de la tanda 2 más un
año de compras sembrado por `sembrar.sql` (200 proveedores, 60.000
movimientos de cuenta, 8.000 facturas de compra, 5.000 pagos con su retención
y su imputación). El lado TS es el DAL y la lógica de antes de la mudanza
(commit 9a17128, en `ts/`) servidos por `node:http`, con la sesión stubeada.
Otros agentes usaban la máquina a la vez: los números tienen ruido (la ficha
dio entre 265 y 557 pedidos/s en Go en dos corridas); las proporciones se
sostuvieron.

Antes de medir se comprobó que los dos lados den lo mismo: el CSV del libro
IVA de marzo, **igual byte a byte**; el listado de proveedores, la ficha (con
el saldo de cada renglón) y el de pagos, iguales salvo la precisión de las
fechas (Go manda microsegundos, JS milisegundos). El lado TS corre con
`TZ=UTC`, como Next en producción: con la zona de la Mac, «marzo» empieza tres
horas después y el libro sale distinto.

## 20 a la vez, 20 segundos (k6)

| Prueba | | pedidos/s | p50 | p99 | fallos | memoria máx. |
|---|---|---:|---:|---:|---:|---:|
| Listado de proveedores (saldo de 60.000 movimientos) | **Go** | **164,6** | **111 ms** | **285 ms** | 0 % | **89 MB** |
| | TS | 108,7 | 157 ms | 495 ms | 0 % | 164 MB |
| Ficha de un proveedor (200 movimientos con saldo) | **Go** | **265,0** | **59 ms** | 231 ms | 0 % | **90 MB** |
| | TS | 212,5 | 89 ms | 220 ms | 0 % | 176 MB |
| Pagos (60, con retenciones y facturas) | **Go** | **495,2** | **35 ms** | **109 ms** | 0 % | **90 MB** |
| | TS | 76,7 | 243 ms | 620 ms | 0 % | 164 MB |
| Libro IVA compras de un mes, CSV (675 comprobantes) | **Go** | **258,2** | **72 ms** | **170 ms** | 0 % | **91 MB** |
| | TS | 93,2 | 171 ms | 873 ms | 0 % | 245 MB |
| Pagar con retención, 5 a la vez | **Go** | 60,5 | 78 ms | 139 ms | **0 %** | **91 MB** |
| | TS | 173,4 | 27 ms | 46 ms | **79,8 %** | 231 MB |

- **Pagos: 6,5×.** La consulta del TS agrupaba todas las retenciones e
  imputaciones de la historia para mostrar 60; la de Go (`LATERAL`) agrupa solo
  las de los 60 que se muestran. Sin ese cambio daba lo mismo que el TS (80
  contra 92 pedidos/s): manda Postgres.
- **Pagar: el TS falla 4 de cada 5.** Dos pagos simultáneos sacan el mismo
  número de certificado y el índice único aborta el segundo (es uno de los
  bugs que arregla la tanda, ver docs/go/progreso.md). Go toma el candado de
  los pagos: los serializa y no falla ninguno; por eso hace menos por segundo
  —los que hace, los hace todos—.
- El listado de proveedores y la ficha los manda Postgres (la suma de los
  movimientos): la diferencia es la de serializar el JSON.

## Cómo repetirlo

```sh
docker exec mjbj-go-pg createdb -U postgres -T tanda2 bench_t8
docker exec -i mjbj-go-pg psql -U postgres -d bench_t8 < bench/tanda8/sembrar.sql
(cd backend && go build -o /tmp/mjbj-t8 ./cmd/mjbj)
DATABASE_URL=…/bench_t8 /tmp/mjbj-t8 usuario staff --email bench8@prueba.test --password 'una clave larga' --name Bench --role admin
DATABASE_URL=…/bench_t8 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 API_ESCUCHAR=127.0.0.1:8288 /tmp/mjbj-t8 api
TZ=UTC DATABASE_URL=…/bench_t8 BENCH_USUARIO=<id del admin> bench/tanda8/levantar-ts.sh     # :8388
# la cookie: POST /api/v1/sesion {"correo","clave"} contra :8288
bench/tanda8/correr.sh "<cookie>" <id de un proveedor> <id del régimen IIBB-MI> 20 20s
```

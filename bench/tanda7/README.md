# Benchmark de la tanda 7: facturación electrónica, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo (i7, 6 núcleos), contra el mismo
Postgres 18 en Docker (`mjbj-go-pg`), base `bench_t7` (copia de `tanda2` +
`sembrar.sql`: 6000 comprobantes de septiembre a noviembre con sus renglones y
3000 cobros). El lado TS es `lib/fiscal` y el DAL de facturación **de antes de
la mudanza** (git 56ef2a1, copiados en `ts/`), servidos por `node:http`, con la
sesión simulada. Los dos hablan con el mismo **ARCA simulado**
(`backend/cmd/simulador-arca`, 60 ms por respuesta más un azar de hasta
120 ms, y que como ARCA solo acepta el número siguiente de cada punto de venta
y tipo). Go factura en el punto de venta 3 y el TS en el 4.

20 a la vez, 20 segundos (k6):

| | | pedidos/s | p50 | p95 | p99 | con CAE | memoria máx. |
|---|---|---:|---:|---:|---:|---:|---:|
| Emitir y pedir el CAE (la venta del mostrador) | **Go** | 6,4 | 3,0 s | 3,9 s | 4,1 s | **145 de 145** | **37 MB** |
| | TS | 9,7 | 0,8 s | 10,4 s | 10,9 s | **0 de 217** | 149 MB |
| Libro IVA ventas de octubre en CSV | **Go** | **40,0** | **440 ms** | **896 ms** | **1,1 s** | | **118 MB** |
| | TS | 8,5 | 2,2 s | 3,9 s | 5,2 s | | 264 MB |
| Listado de la pantalla (200, con cobros y medios) | Go | 120,6 | 145 ms | 328 ms | 461 ms | | **65 MB** |
| | TS* | 150,6 | 127 ms | 221 ms | 266 ms | | 220 MB |

**La emisión es la que importa, y no por la velocidad.** El TS pide los CAE en
paralelo: en cuanto uno llega a ARCA antes que el anterior, ARCA lo rechaza
(10016, «no es el próximo a autorizar»), el TS lo marca *rechazado*, y desde
ahí **todos los siguientes** quedan rechazados por el mismo motivo, porque a
ARCA le falta ese número. En la corrida: 217 ventas, ninguna con CAE. Go los
pide de a uno (un candado, sin transacción abierta mientras habla con ARCA) y
autoriza antes los anteriores que falten: 145 de 145 con CAE. El techo de Go
es lo que tarda ARCA en contestar (una llamada por comprobante si el anterior
ya tiene CAE): con 20 ventas a la vez en el mismo punto de venta, la última
espera a las otras 19. Con ARCA de demora pareja (sin el azar) el TS no se
desordenaba y sacaba 47 por segundo con todo autorizado; el desorden aparece
en cuanto las respuestas tardan distinto, que es lo que pasa con ARCA.

**El libro IVA** es 4,7 veces más rápido en Go (el TS arma el CSV en un solo
hilo; Go con todos los núcleos). Los dos archivos no son iguales a propósito:
el de Go usa internal/csvexcel (CRLF, fecha dd/mm/aaaa en hora argentina) y el
mes se corta en hora argentina.

**El listado** empata (manda Postgres: la suma de los cobros por comprobante),
y Go además lee la sesión de la base en cada pedido, que el TS del banco tiene
simulada. *El TS de antes **no andaba**: en la primera corrida
(`resultados-primera-corrida.txt`) falló el 100 % con «(f.medios ?? []).filter
is not a function»: `array_agg` de un enum vuelve de node-postgres como el texto
`{efectivo}`, no como lista. La pantalla de facturación se caía en cuanto un
comprobante tenía un cobro. Para medirlo se le agregó `::text` en la copia del
banco (marcado `BENCH:`). En Go la lista sale bien (y lo prueba
`TestCobrarComprobante`).

Antes de medir se comprobó que el listado dé lo mismo en los dos lados (los
200 mismos comprobantes, en el mismo orden, con lo cobrado y los medios).

## Cómo repetirlo

```sh
docker exec mjbj-go-pg psql -U postgres -c "CREATE DATABASE bench_t7 TEMPLATE tanda2"
docker exec -i mjbj-go-pg psql -U postgres -d bench_t7 < bench/tanda7/sembrar.sql
cd backend && go build -o ../bench/tanda7/bin/mjbj-t7 ./cmd/mjbj && go build -o ../bench/tanda7/bin/simulador-arca ./cmd/simulador-arca && cd ..
cd bench/tanda7
./con-entorno.sh ./bin/mjbj-t7 migrar
./con-entorno.sh ./bin/mjbj-t7 usuario staff --email bench7@mjbj.test --password Secreto123 --name "Bench 7" --role admin
./bin/simulador-arca -escuchar 127.0.0.1:8407 -carpeta ./arca -demora 60ms -variacion 120ms &
API_ESCUCHAR=127.0.0.1:8207 ./con-entorno.sh ./bin/mjbj-t7 api &
cd ../..
BENCH_USUARIO=<id del admin> BENCH_PUNTO_TS=<id del punto de venta 4> bench/tanda7/con-entorno.sh \
  npx tsx --tsconfig tsconfig.json --conditions=react-server bench/tanda7/ts-servidor.ts &   # :8307
curl -si -X POST -H 'Content-Type: application/json' -d '{"correo":"bench7@mjbj.test","clave":"Secreto123"}' 127.0.0.1:8207/api/v1/sesion
bench/tanda7/correr.sh "<cookie de Go>" 20 20s
```

Entre corrida y corrida: `DELETE FROM invoices WHERE punto_venta IN (3,4)`,
`DELETE FROM arca_tokens` y reiniciar el simulador (guarda lo autorizado en
memoria).

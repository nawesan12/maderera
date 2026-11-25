# Benchmark de la tanda 5: el mostrador y las ventas, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo (i7 de 6 núcleos), contra el
mismo Postgres 18 en Docker, con la base `bench_t5` (copia de `tanda2`: 3200
variantes, 6400 filas de stock, 2 sucursales, migrada hasta la 00085). El lado
TS es la venta (`registrarVentaDeMostrador`), la búsqueda y el listado de
pedidos **de antes de la mudanza** (git 56ef2a1, copiados en `ts/`) servidos
por `node:http`; el lado Go es el binario de la rama con la API entera. Antes
de medir se comprobó que la búsqueda del mostrador dé **lo mismo** en los dos
lados (12 de 12 resultados iguales, campo por campo).

20 a la vez durante 20 s (la descarga: 5 cajas a la vez, lotes de 25 ventas),
cero fallos. Cada venta lleva una clave nueva, una placa con stock y un flete,
por transferencia (con el descuento por medio de la base).

| | | pedidos/s | p50 | p99 | memoria máx. |
|---|---|---:|---:|---:|---:|
| Venta del mostrador, 20 a la vez (mismo candado de la serie PED) | **Go** | **30,5** | **623 ms** | 1,4 s | **39 MB** |
| | TS | 27,0 | 699 ms | 1,7 s | 175 MB |
| Búsqueda del mostrador («fenolico 18») | Go | 26,3 | 691 ms | 1,9 s | **40 MB** |
| | TS | 29,6 | 617 ms | 1,5 s | 170 MB |
| Listado de pedidos del panel (~9000 pedidos) | **Go** | **26,5** | **684 ms** | **1,5 s** | 194 MB |
| | TS | 4,9 | 3,95 s | 6,4 s | 423 MB |
| Descarga de la cola, lotes de 25, 5 cajas a la vez | Go | 1,6 lotes | 3,2 s | 4,8 s | 195 MB |
| | TS | 1,5 lotes | 3,2 s | 3,7 s | 217 MB |

Lo que manda acá es Postgres, no el lenguaje: la venta y la descarga pasan de
a una por el candado de la serie (a propósito: es lo que impide números
repetidos), y la búsqueda es un ILIKE sin tildes sobre cuatro columnas. En
eso los dos lados empatan, con un cuarto de la memoria del lado de Go. Donde
hay trabajo de la aplicación —el listado de pedidos, que el TS armaba con
varias consultas y en memoria—, Go saca **5,4×**.

## La numeración sin índice (migración 00085)

La primera corrida, sin la 00085, dio la venta en 23 por segundo y la
descarga en 0,3 lotes por segundo con 27 s de p95 (los resultados en
`resultados/sin-indice/`): cada venta buscaba el número más alto con
`max(nullif(regexp_replace(numero, '\D', '', 'g'), '')::bigint)` sobre **toda**
la tabla de pedidos, y con el candado de la serie tomado. Es el techo de
ventas por segundo de todo el negocio, y baja a medida que crece la tabla (lo
mismo en TS). Con un índice sobre la misma expresión el máximo sale del índice
(0,16 ms contra un barrido entero); la consulta y los números no cambian. Con
el índice, y con la tabla ya en 9000 pedidos, la venta subió a 30 por segundo.

## Lo aprendido

- La búsqueda con pgx usa `QueryExecModeExec`: con el modo de siempre (la
  sentencia preparada en caché), después de cinco ejecuciones Postgres puede
  pasar a un plan genérico, que para un ILIKE con el patrón como parámetro no
  sabe nada del patrón.
- En la primera medición la búsqueda de Go salió a la mitad que la de TS; al
  repetir, empataron. Con la base en Docker en la Mac, una medición suelta de
  algo que manda Postgres no alcanza: hay que repetirla antes de sacar
  conclusiones.

## Cómo repetirlo

```sh
docker exec mjbj-go-pg psql -U postgres -c "create database bench_t5 template tanda2"
(cd backend && go build -o ../bench/tanda5/mjbj-t5 ./cmd/mjbj)
DATABASE_URL=…/bench_t5 bench/tanda5/mjbj-t5 migrar
DATABASE_URL=…/bench_t5 BETTER_AUTH_SECRET=… BETTER_AUTH_URL=http://localhost:3100 \
  bench/tanda5/mjbj-t5 usuario staff --email bench5@mjbj.test --password Secreto123 --name Bench --role admin
bench/tanda5/servir.sh go &      # :8205
bench/tanda5/servir.sh ts &      # :8305
# la cookie: POST /api/v1/sesion {"correo":"bench5@mjbj.test","clave":"Secreto123"} contra :8205
bench/tanda5/correr.sh "<cookie>" <id de la sucursal> <id de una variante con stock> 20 20s
```

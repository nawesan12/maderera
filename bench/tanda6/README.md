# Benchmark de la tanda 6: el carrito, el webhook y la conciliación, TypeScript contra Go

Medido el 29/10/2026 en la Mac de desarrollo (i7 de 6 núcleos), contra el
mismo Postgres 18 en Docker, con la base `bench_t6` (copia de `tanda2`,
migrada hasta la 00085, con 300 clientes, 3000 cobros y 2000 avisos de pago
sembrados). El lado TS es lo de **antes de la mudanza** (git 791cc3f, en
`ts/` y en `scripts/golden/originales/tanda6`) servido por `node:http`; el
lado Go es el binario de la rama con la API entera (`mjbj-t6`).

20 s por prueba, cero fallos en todas.

| | | por s | p50 | p95 | p99 | memoria máx. |
|---|---|---:|---:|---:|---:|---:|
| Confirmar la compra, 20 a la vez (mismo candado de la serie PED) | **Go** | **38,5** | **495 ms** | 616 ms | 966 ms | **104 MB** |
| | TS | 25,8 | 739 ms | 1,0 s | 1,15 s | 213 MB |
| Webhook de Mercado Pago firmado, 50 a la vez | Go | 849 | 57 ms | 78 ms | 99 ms | **104 MB** |
| | TS | 846 | 57 ms | 82 ms | 107 ms | 210 MB |
| Conciliación (3000 cobros, 2000 avisos), 20 a la vez | **Go** | **368** | **51 ms** | 87 ms | 114 ms | **63 MB** |
| | TS | 182 | 106 ms | 155 ms | 198 ms | 209 MB |

- **La compra** pasa de a una por el candado de la serie de pedidos (a
  propósito: es lo que impide números repetidos). Go hace menos viajes a la
  base dentro de la transacción (los costos y los factores en una consulta
  cada uno, la reserva con los candados en orden) y la transacción dura
  menos: **1,5×**. Cada compra lleva otra IP y otro correo: el freno de 10 por
  hora es el mismo en los dos lados y acá se mide la compra.
- **El webhook** empata: los dos verifican la firma y dejan el aviso en la
  cola, y lo que manda es el INSERT con su trigger de aviso. Se mide lo que
  tarda en aceptar (el procesamiento lo hace el worker de Go, o el `after()`
  de Next antes). Las 36.841 firmas de la corrida de Go verificaron todas.
- **La conciliación**: Go la arma en un pedido con cuatro consultas; el TS
  hacía las mismas cuatro desde la página. **2×**, con un tercio de la memoria.
- Los números de pedido de las 1545 compras de la corrida: sin repetidos.

## Cómo repetirlo

```sh
docker exec mjbj-go-pg psql -U postgres -c "create database bench_t6 template tanda2"
(cd backend && go build -o /ruta/mjbj-t6 ./cmd/mjbj)
DATABASE_URL=…/bench_t6 /ruta/mjbj-t6 migrar
DATABASE_URL=…/bench_t6 BETTER_AUTH_SECRET=secreto-del-benchmark-t6-de-32-caracteres BETTER_AUTH_URL=http://localhost:3100 \
  /ruta/mjbj-t6 usuario staff --email bench6@mjbj.test --password Secreto123 --name Bench --role admin
# los cobros y avisos sembrados: ver el insert de abajo
BENCH_BINARIO=/ruta/mjbj-t6 bench/tanda6/servir.sh go &   # :8206
bench/tanda6/servir.sh ts &                               # :8306
# la cookie: POST /api/v1/sesion {"correo":"bench6@mjbj.test","clave":"Secreto123"} contra :8206
bench/tanda6/correr.sh "better-auth.session_token=…" <id de la sucursal> <id de una variante con precio> 20s
```

La siembra de la conciliación:

```sql
insert into customers (nombre, tipo) select 'Cliente '||g, 'particular' from generate_series(1,300) g;
insert into payments (customer_id, tipo, proveedor, monto, estado, medio, created_at, acreditado_at)
select (select id from customers order by id offset (g % 300) limit 1), (array['pedido','deuda','inscripcion'])[1+g%3]::tipo_pago,
       (array['mercado_pago','transferencia','demo'])[1+g%3]::proveedor_pago, 1000+g,
       (array['aprobado','en_revision','rechazado','iniciado','pendiente'])[1+g%5]::estado_cobro,
       'visa', now() - (g||' minutes')::interval, case when g%5=0 then now() - (g||' minutes')::interval end
from generate_series(1,3000) g;
insert into payment_events (proveedor, evento_id, tipo, cuerpo, firma_valida, procesado_at, error, created_at)
select 'mercado_pago', 'ev-'||g, 'payment.updated', '{}'::jsonb, 'true', now(), case when g%20=0 then 'Sin cobro local' end,
       now() - (g||' minutes')::interval from generate_series(1,2000) g;
```

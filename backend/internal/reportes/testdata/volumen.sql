-- Volumen de ISIS para medir el cierre (volumen_test.go). No es una prueba:
-- se carga a mano sobre una base vacía sacada de la plantilla, nunca sobre la
-- de desarrollo:
--
--   createdb -h localhost -p 5434 -U mjbj -T mjbj_plantilla_j mjbj_volumen_j
--   psql postgres://mjbj:mjbj@localhost:5434/mjbj_volumen_j -f volumen.sql
--
-- Tres años de historia con todo lo que lee cobros.eventosSQL, así cada rama
-- del reparto pesa lo que pesaría: facturas con y sin CAE, cobros de factura
-- sin recibo, ventas del mostrador facturadas sin recibo (con reintegros),
-- recibos con retención, cheques B, anulaciones y devoluciones, pedidos sin
-- cliente, cheques rechazados con su nota de débito (también el endosado que
-- rebota), y compras, pagos y gastos para los asientos de la historia.
--
-- Los números salen de la posición (g) y no de random(): la base se puede
-- rearmar y dar los mismos asientos.
set session_replication_role = replica;

-- 5.000 clientes
create temp table cli as select gen_random_uuid() id, g n from generate_series(1, 5000) g;
insert into customers (id, nombre) select id, 'Cliente ' || n from cli;

-- 60.000 pedidos en 3 años; 10 % sin cliente; 3 % abiertos
create temp table ped as select gen_random_uuid() id, g n,
  case when g % 10 = 0 then null else (select id from cli where cli.n = 1 + (g * 7919) % 5000) end cid,
  timestamptz '2024-01-01' + (g::float / 60000) * interval '1050 days' at0,
  (1000 + (g * 37) % 90000)::numeric total from generate_series(1, 60000) g;
insert into orders (id, numero, contacto_nombre, customer_id, estado, total, subtotal, created_at, cobrada_at)
  select id, 'P-' || n, 'Contacto ' || n, cid, (case when n % 33 = 0 then 'pendiente' else 'entregado' end)::estado_pedido, total, total, at0,
    at0 + interval '1 hour' from ped;
insert into order_status_history (order_id, estado, created_at) select id, 'pendiente', at0 from ped;
insert into order_status_history (order_id, estado, created_at) select id, 'entregado', at0 + interval '3 days' from ped where n % 33 <> 0;

-- 10.000 facturas B (una cada 6 pedidos), el 1 % notas de crédito; el 1 %
-- emitidas que esperan el CAE (n % 600 = 300).
create temp table fac as select gen_random_uuid() id, p.id id_ped, p.n, p.cid, p.at0, p.total from ped p where p.n % 6 = 0;
insert into invoices (id, tipo, punto_venta, numero, estado, receptor_nombre, customer_id, order_id, total, neto, fecha_emision, created_at,
    cae, cae_ambiente)
  select id, (case when n % 600 = 0 then 'nota_credito_b' else 'factura_b' end)::tipo_comprobante, 1, n,
    (case when n % 600 = 300 then 'emitida' else 'autorizada' end)::estado_comprobante, 'Cliente', cid, id_ped, total, round(total / 1.21, 2),
    at0 + interval '3 days', at0 + interval '3 days',
    case when n % 600 = 300 then null else 'CAE' || n end, case when n % 600 = 300 then null else 'produccion' end
  from fac;
insert into arca_log (invoice_id, operacion, exito, created_at) select id, 'FECAESolicitar', true, at0 + interval '3 days' from fac where n % 600 <> 300;

-- ~1.000 cobros de factura sin recibo (los de antes de los recibos).
insert into invoice_payments (invoice_id, medio, monto, fecha, created_at)
  select id, 'efectivo', total, at0 + interval '4 days', at0 + interval '4 days' from fac where n % 60 = 0 and n % 600 not in (0, 300);

-- ~3.000 ventas del mostrador facturadas, cobradas sin recibo; el 5 %
-- reintegradas y el 10 % con un reintegro parcial.
create temp table pag as select gen_random_uuid() id, f.id_ped, f.cid, f.n, f.at0, f.total from fac f
  where f.n % 18 = 6 and f.n % 600 <> 300;
insert into payments (id, order_id, customer_id, tipo, proveedor, medio, monto, estado, created_at, updated_at, acreditado_at)
  select id, id_ped, cid, 'pedido', 'mostrador', 'efectivo', total, (case when n % 20 = 0 then 'reintegrado' else 'aprobado' end)::estado_cobro,
    at0 + interval '1 hour', at0 + interval '10 days', at0 + interval '1 hour' from pag;
insert into payment_refunds (payment_id, importe, acumulado, created_at)
  select id, round(total * 0.2, 2), round(total * 0.2, 2), at0 + interval '6 days' from pag where n % 10 = 0;

-- 40.000 recibos a clientes, con su parte en efectivo (el 10 % con
-- retención, el 2 % con un cheque B).
create temp table rec as select gen_random_uuid() id, g n, (select id from cli where cli.n = 1 + (g::bigint * 104729) % 5000) cid,
  timestamptz '2024-01-02' + (g::float / 40000) * interval '1050 days' at0, (500 + (g * 53) % 60000)::numeric total
  from generate_series(1, 40000) g;
insert into receipts (id, numero, recibido_de, total, origen, customer_id, created_at)
  select id, 'REC-' || n, 'Cliente', total, 'panel', cid, at0 from rec;
insert into receipt_parts (receipt_id, medio, importe, orden)
  select id, 'efectivo', case when n % 10 = 0 then total - round(total * 0.03, 2) when n % 50 = 7 then total - 300 else total end, 0 from rec;
insert into receipt_parts (receipt_id, medio, importe, orden) select id, 'retencion', round(total * 0.03, 2), 1 from rec where n % 10 = 0;
create temp table chb as select gen_random_uuid() id, r.id rid, r.cid, r.n, r.at0 from rec r where r.n % 50 = 7;
insert into cheques (id, sentido, numero, banco, fecha_pago, importe, estado, customer_id, circuito, receipt_id, created_at)
  select id, 'recibido', 'B-' || n, 'Provincia', at0 + interval '30 days', 300, 'acreditado', cid, 'negro', rid, at0 from chb;
insert into receipt_parts (receipt_id, medio, importe, orden, cheque_id) select rid, 'cheque', 300, 1, id from chb;

-- ~1.000 recibos de pedidos sin cliente (clave «p:»), la mitad facturados.
create temp table recp as select gen_random_uuid() id, p.id id_ped, p.n, p.at0 + interval '2 hours' at0, p.total from ped p
  where p.cid is null and p.n % 60 = 0;
insert into receipts (id, numero, recibido_de, total, origen, order_id, created_at)
  select id, 'RECP-' || n, 'Contacto ' || n, total, 'mostrador', id_ped, at0 from recp;
insert into receipt_parts (receipt_id, medio, importe, orden) select id, 'transferencia', total, 0 from recp;

-- ~500 recibos anulados 20 días después.
update receipts r set estado = 'anulado', anulado_at = r.created_at + interval '20 days', motivo_anulacion = 'volumen'
  from rec where rec.id = r.id and rec.n % 80 = 0;

-- ~300 devoluciones que le devuelven plata a un recibo: la mitad de una
-- factura con CAE (al blanco entero) y la mitad de una que espera el CAE
-- (con el reparto del recibo).
create temp table dev as select gen_random_uuid() id, r.id rid, r.n, r.at0, r.cid,
  (select f.id from fac f where (case when r.n % 260 = 0 then f.n % 600 = 300 else f.n % 600 <> 300 end) order by f.n limit 1 offset (r.n / 130) % 15) fid,
  (select f.id_ped from fac f where (case when r.n % 260 = 0 then f.n % 600 = 300 else f.n % 600 <> 300 end) order by f.n limit 1 offset (r.n / 130) % 15) oid
  from rec r where r.n % 130 = 0;
insert into devoluciones (id, clave, order_id, invoice_id, importe, destino, motivo, created_at)
  select id, 'dev-' || n, oid, fid, 100, 'caja', 'volumen', at0 + interval '5 days' from dev;
insert into receipt_refunds (receipt_id, devolucion_id, medio, importe, created_at) select rid, id, 'efectivo', 100, at0 + interval '5 days' from dev;

-- ~200 recibos cuyo pago (Mercado Pago) tuvo un reintegro parcial que le
-- devolvió la deuda a la cuenta.
create temp table rmp as select gen_random_uuid() pid, gen_random_uuid() mid, r.id rid, r.n, r.at0, r.cid, r.total from rec r where r.n % 200 = 3;
insert into payments (id, customer_id, tipo, proveedor, proveedor_payment_id, medio, monto, estado, created_at, acreditado_at)
  select pid, cid, 'deuda', 'mercado_pago', 'mp-' || n, 'mercado_pago', total, 'aprobado', at0, at0 from rmp;
update receipt_parts x set payment_id = rmp.pid from rmp where x.receipt_id = rmp.rid and x.orden = 0;
insert into account_movements (id, customer_id, tipo, monto, created_at) select mid, cid, 'nota_debito', 50, at0 + interval '7 days' from rmp;
insert into payment_refunds (payment_id, importe, acumulado, account_movement_id, created_at)
  select pid, 50, 50, mid, at0 + interval '7 days' from rmp;

-- ~200 cheques del blanco rechazados con su nota de débito; uno de cada
-- cuatro, endosado a un proveedor antes de rebotar.
insert into suppliers (id, nombre) select gen_random_uuid(), 'Proveedor ' || g from generate_series(1, 50) g;
create temp table prov as select id, row_number() over (order by nombre) n from suppliers;
create temp table chr as select gen_random_uuid() id, gen_random_uuid() sp, r.id rid, r.n, r.at0, r.cid from rec r where r.n % 200 = 11;
insert into cheques (id, sentido, numero, banco, fecha_pago, importe, estado, customer_id, circuito, receipt_id, created_at)
  select id, 'recibido', 'R-' || n, 'Nación', at0 + interval '15 days', 400, 'rechazado', cid, 'blanco', rid, at0 from chr;
insert into supplier_payments (id, supplier_id, fecha, total, neto, medio, created_at)
  select sp, (select id from prov where prov.n = 1 + c.n % 50), at0 + interval '5 days', 400, 400, 'cheque_tercero', at0 + interval '5 days'
  from chr c where n % 800 = 11;
insert into supplier_payment_parts (payment_id, medio, importe, cheque_id) select sp, 'cheque_tercero', 400, id from chr where n % 800 = 11;
insert into cheque_estados (cheque_id, desde, hacia, at) select id, 'cartera', 'entregado', at0 + interval '5 days' from chr where n % 800 = 11;
insert into cheque_estados (cheque_id, desde, hacia, at)
  select id, (case when n % 800 = 11 then 'entregado' else 'depositado' end)::estado_cheque, 'rechazado', at0 + interval '16 days' from chr;
insert into account_movements (customer_id, tipo, monto, cheque_id, created_at) select cid, 'nota_debito', 400, id, at0 + interval '16 days' from chr;
insert into cheque_estados (cheque_id, desde, hacia, at) select id, 'cartera', 'acreditado', at0 + interval '30 days' from chb;

-- Compras: 3.000 facturas de 50 proveedores, 2.000 pagos con su parte
-- (el 10 % del circuito B) y 3.000 gastos.
insert into purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, total, created_at)
  select (select id from prov where prov.n = 1 + g % 50), 'factura_a', 1, g, date_trunc('day', timestamptz '2024-01-03' + (g::float / 3000) * interval '1050 days'),
    round((2000 + (g * 41) % 80000) / 1.21, 2), (2000 + (g * 41) % 80000) - round((2000 + (g * 41) % 80000) / 1.21, 2), 2000 + (g * 41) % 80000,
    timestamptz '2024-01-03' + (g::float / 3000) * interval '1050 days'
  from generate_series(1, 3000) g;
create temp table spg as select gen_random_uuid() id, g n, timestamptz '2024-01-05' + (g::float / 2000) * interval '1050 days' at0,
  (3000 + (g * 43) % 70000)::numeric total from generate_series(1, 2000) g;
insert into supplier_payments (id, supplier_id, fecha, total, neto, medio, circuito, created_at)
  select id, (select id from prov where prov.n = 1 + spg.n % 50), at0, total, total, 'transferencia',
    (case when n % 10 = 0 then 'negro' else 'blanco' end)::circuito, at0 from spg;
insert into supplier_payment_parts (payment_id, medio, importe) select id, 'transferencia', total from spg;
insert into expenses (fecha, categoria, descripcion, importe, medio, circuito, created_at)
  select date_trunc('day', timestamptz '2024-01-04' + (g::float / 3000) * interval '1050 days'), 'flete', 'Gasto ' || g, 500 + (g * 29) % 20000,
    (case when g % 3 = 0 then 'transferencia' else 'efectivo' end)::medio_gasto, (case when g % 12 = 0 then 'negro' else 'blanco' end)::circuito,
    timestamptz '2024-01-04' + (g::float / 3000) * interval '1050 days'
  from generate_series(1, 3000) g;

analyze;

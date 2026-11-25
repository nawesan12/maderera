-- Las cuentas pesadas, encima de volumen.sql (cobros/volumen_test.go,
-- TestVolumenDeLaCuentaPesada). volumen.sql reparte los clientes parejo y la
-- cuenta más grande queda con unos 8 recibos; una maderera tiene pocas
-- cuentas grandes (constructoras, carpinteros) con cientos de recibos y
-- miles de pedidos, y es en esas donde FijarReparto recorre más con el
-- candado de recibos tomado. Va en un archivo aparte para no mover la foto
-- del cierre que se sacó sobre volumen.sql:
--
--   createdb -h localhost -p 5434 -U mjbj -T mjbj_volumen_j mjbj_volumen_j_pesadas
--   psql postgres://mjbj:mjbj@localhost:5434/mjbj_volumen_j_pesadas -f volumen_pesadas.sql
--
-- Tres cuentas, cada una con 5.000 pedidos y 2.000 recibos en tres años: el
-- 80 % de los pedidos facturados con CAE a los 3 días, y uno de cada cinco
-- recibos es una seña (antes de la factura, con el pedido abierto): el 20 %
-- de los recibos de la cuenta queda con anticipo.
set session_replication_role = replica;

create temp table pcli as select gen_random_uuid() id, g n from generate_series(1, 3) g;
insert into customers (id, nombre) select id, 'Constructora ' || n from pcli;

create temp table pped as select gen_random_uuid() id, c.id cid, c.n cn, k,
  timestamptz '2024-01-01' + (k::float / 5000) * interval '1050 days' + c.n * interval '1 minute' at0,
  (1000 + (k * 37 + c.n * 11) % 90000)::numeric total
  from pcli c cross join generate_series(1, 5000) k;
insert into orders (id, numero, contacto_nombre, customer_id, estado, total, subtotal, created_at, cobrada_at)
  select id, 'PP-' || cn || '-' || k, 'Obra ' || k, cid, (case when k % 33 = 0 then 'pendiente' else 'entregado' end)::estado_pedido,
    total, total, at0, at0 + interval '1 hour' from pped;
insert into order_status_history (order_id, estado, created_at) select id, 'pendiente', at0 from pped;
insert into order_status_history (order_id, estado, created_at) select id, 'entregado', at0 + interval '3 days' from pped where k % 33 <> 0;

create temp table pfac as select gen_random_uuid() id, p.id id_ped, p.cid, p.cn, p.k, p.at0, p.total from pped p where p.k % 5 <> 0;
insert into invoices (id, tipo, punto_venta, numero, estado, receptor_nombre, customer_id, order_id, total, neto, fecha_emision, created_at,
    cae, cae_ambiente)
  select id, 'factura_b', 5, 100000 * cn + k, 'autorizada', 'Constructora ' || cn, cid, id_ped, total, round(total / 1.21, 2),
    at0 + interval '3 days', at0 + interval '3 days', 'CAEP' || cn || '-' || k, 'produccion'
  from pfac;
insert into arca_log (invoice_id, operacion, exito, created_at) select id, 'FECAESolicitar', true, at0 + interval '3 days' from pfac;

-- El recibo j cobra el pedido 5j/2: el resto, a los 5 días, por la factura
-- entera; la seña (j % 5 = 0), una hora después del pedido y por más de lo
-- que la cuenta debe: lo que sobra de Deudores queda de anticipo para el
-- pedido abierto (RepartoDeRecibo). Sin eso, la cuenta siempre debe algo y
-- la seña cancela deuda.
create temp table prec as select gen_random_uuid() id, c.id cid, c.n cn, j, p.at0 + case when j % 5 = 0 then interval '1 hour' else interval '5 days' end at0,
  case when j % 5 = 0 then p.total + 200000 else p.total end total
  from pcli c cross join generate_series(1, 2000) j join pped p on p.cid = c.id and p.k = (j * 5) / 2;
insert into receipts (id, numero, recibido_de, total, origen, customer_id, created_at)
  select id, 'RECC-' || cn || '-' || j, 'Constructora ' || cn, total, 'panel', cid, at0 from prec;
insert into receipt_parts (receipt_id, medio, importe, orden) select id, 'transferencia', total, 0 from prec;

analyze;

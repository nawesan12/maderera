-- La base del benchmark de la tanda 7 (bench_t7, copia de tanda2): el emisor,
-- los puntos de venta 3 (Go) y 4 (TS), un pedido para la venta del mostrador y
-- 6000 comprobantes en septiembre–noviembre de 2026 con sus renglones y
-- cobros, para el listado y el libro IVA.
--
--   docker exec -i mjbj-go-pg psql -U postgres -d bench_t7 < bench/tanda7/sembrar.sql
INSERT INTO configuracion_fiscal (razon_social, cuit, condicion_iva)
SELECT 'Maderera Juan B. Justo S.R.L.', '30589445259', 'responsable_inscripto'
WHERE NOT EXISTS (SELECT 1 FROM configuracion_fiscal);
UPDATE configuracion_fiscal SET cuit = '30589445259', condicion_iva = 'responsable_inscripto';

INSERT INTO puntos_venta (numero, nombre) VALUES (3, 'Go'), (4, 'TS'), (15, 'Histórico') ON CONFLICT DO NOTHING;

INSERT INTO orders (id, numero, contacto_nombre, total)
VALUES ('7e7e7e7e-0000-4000-8000-000000000007', 'PED-BENCH-7', 'Mostrador', 0) ON CONFLICT DO NOTHING;

-- Los comprobantes de muestra van en el punto 15, para no tocar la
-- numeración de los que se emiten durante la prueba.
INSERT INTO invoices (id, tipo, punto_venta_id, punto_venta, numero, estado, receptor_nombre, receptor_cuit,
  receptor_condicion_iva, neto, iva21, iva105, exento, tributos, total, cae, fecha_emision)
SELECT gen_random_uuid(),
  (CASE WHEN i % 17 = 0 THEN 'nota_credito_b' WHEN i % 5 = 0 THEN 'factura_a' ELSE 'factura_b' END)::tipo_comprobante,
  (SELECT id FROM puntos_venta WHERE numero = 15), 15, i,
  (CASE WHEN i % 13 = 0 THEN 'emitida' WHEN i % 31 = 0 THEN 'anulada' ELSE 'autorizada' END)::estado_comprobante,
  'Cliente ' || (i % 400), CASE WHEN i % 5 = 0 THEN '30712345671' END,
  (CASE WHEN i % 5 = 0 THEN 'responsable_inscripto' ELSE 'consumidor_final' END)::condicion_iva,
  round((i % 997) * 100.0 / 1.21, 2), round((i % 997) * 100.0 - (i % 997) * 100.0 / 1.21, 2), 0, 0, 0,
  (i % 997) * 100.0, CASE WHEN i % 13 <> 0 THEN (76000000000000 + i)::text END,
  timestamptz '2026-09-01 03:00+00' + (i * interval '21 minutes')
FROM generate_series(1, 6000) i
ON CONFLICT DO NOTHING;

INSERT INTO invoice_items (invoice_id, descripcion, cantidad, precio_unitario, alicuota_iva, neto, iva, subtotal, orden)
SELECT id, 'Placa fenólica 18 mm', 1, neto, 21, neto, iva21, total, 0 FROM invoices WHERE punto_venta = 15
AND NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = invoices.id);

INSERT INTO invoice_payments (invoice_id, medio, monto)
SELECT id, (CASE WHEN numero % 3 = 0 THEN 'efectivo' WHEN numero % 3 = 1 THEN 'transferencia' ELSE 'cuenta_corriente' END)::medio_cobro, total
FROM invoices WHERE punto_venta = 15 AND numero % 2 = 0
AND NOT EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = invoices.id);

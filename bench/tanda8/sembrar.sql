-- La base del benchmark de la tanda 8: la de la tanda 2 (2000 productos)
-- más un año de compras. Determinista (setseed).
--   docker exec mjbj-go-pg createdb -U postgres -T tanda2 bench_t8
--   docker exec -i mjbj-go-pg psql -U postgres -d bench_t8 < bench/tanda8/sembrar.sql
SELECT setseed(0.20261029);

INSERT INTO suppliers (nombre, razon_social, cuit, rubro, contacto, dias_pago)
SELECT 'Proveedor ' || i, 'Proveedor ' || i || ' SRL', '30-' || lpad((10000000 + i)::text, 8, '0') || '-' || (i % 10),
  (ARRAY['Maderas', 'Herrajes', 'Placas', 'Fletes'])[1 + i % 4], 'Contacto ' || i, (ARRAY[0, 15, 30, 60])[1 + i % 4]
FROM generate_series(1, 200) i;

-- 60.000 movimientos de cuenta corriente.
INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_at)
SELECT s.id, CASE WHEN r < 0.55 THEN 'factura' ELSE 'pago' END::tipo_movimiento_proveedor,
  round((CASE WHEN r < 0.55 THEN 1 ELSE -1 END * (1000 + random() * 900000))::numeric, 2), 'REF-' || g, 'Movimiento de prueba',
  timestamptz '2025-11-01' + (random() * interval '360 days')
FROM generate_series(1, 60000) g
CROSS JOIN LATERAL (SELECT random() AS r) x
JOIN LATERAL (SELECT id FROM suppliers ORDER BY nombre OFFSET (g % 200) LIMIT 1) s ON true;

INSERT INTO regimenes_retencion (codigo, nombre, impuesto, jurisdiccion, alicuota, alicuota_no_inscripto)
VALUES ('IIBB-MI', 'Ingresos Brutos · Misiones', 'iibb', 'Misiones', 1.5, 3) ON CONFLICT DO NOTHING;

-- 8.000 facturas de compra en el año.
INSERT INTO purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, neto, iva21, iva105, exento, percepciones, total, cae)
SELECT s.id, (ARRAY['factura_a', 'factura_a', 'factura_a', 'factura_b', 'nota_credito_a', 'factura_m'])[1 + g % 6]::tipo_comprobante_compra,
  1 + g % 5, g, timestamptz '2025-11-01' + (random() * interval '360 days'), n, round(n * 0.21, 2), 0, 0, round(n * 0.03, 2),
  n + round(n * 0.21, 2) + round(n * 0.03, 2), '7' || lpad(g::text, 13, '0')
FROM generate_series(1, 8000) g
CROSS JOIN LATERAL (SELECT round((5000 + random() * 2000000)::numeric, 2) AS n) x
JOIN LATERAL (SELECT id FROM suppliers ORDER BY nombre OFFSET (g % 200) LIMIT 1) s ON true;

-- 5.000 pagos, cada uno con su retención y una factura imputada.
WITH pagos AS (
  INSERT INTO supplier_payments (supplier_id, fecha, total, neto, medio, referencia)
  SELECT f.supplier_id, f.fecha_emision + interval '10 days', f.total, round(f.total * 0.985, 2), 'transferencia', 'TR-' || f.numero
  FROM purchase_invoices f WHERE f.numero <= 5000
  RETURNING id, supplier_id, fecha, total, referencia
)
, imput AS (
  INSERT INTO supplier_payment_allocations (payment_id, purchase_invoice_id, importe)
  SELECT p.id, f.id, p.total FROM pagos p JOIN purchase_invoices f ON 'TR-' || f.numero = p.referencia
  RETURNING payment_id
)
INSERT INTO retenciones_practicadas (payment_id, supplier_id, regimen_id, numero, codigo_regimen, impuesto, base, alicuota, importe, fecha)
SELECT p.id, p.supplier_id, (SELECT id FROM regimenes_retencion WHERE codigo = 'IIBB-MI'),
  'IIB-2025-' || lpad(row_number() OVER (ORDER BY p.fecha)::text, 6, '0'), 'IIBB-MI', 'iibb', p.total, 1.5, round(p.total * 0.015, 2), p.fecha
FROM pagos p;

ANALYZE;

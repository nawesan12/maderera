-- +goose Up
-- El traslado se recibe contando (mes simulado, M2S4-021) y se anula
-- mientras va en camino (M3S3-016, M3S3-022): cada renglón guarda lo que
-- llegó, y un renglón que no figuraba en el comprobante (llegó otra medida)
-- entra con cantidad mandada 0. Lo que no llegó vuelve al origen o se da por
-- perdido, y eso se guarda en el traslado.
ALTER TABLE stock_traslados DROP CONSTRAINT stock_traslados_estado_check;
ALTER TABLE stock_traslados ADD CONSTRAINT stock_traslados_estado_check CHECK (estado IN ('en-camino', 'recibido', 'anulado'));
ALTER TABLE stock_traslados ADD COLUMN faltante text CHECK (faltante IN ('origen', 'perdido'));
ALTER TABLE stock_traslados ADD COLUMN anulado_at timestamptz;
ALTER TABLE stock_traslados ADD COLUMN anulado_por_user_id text;
ALTER TABLE stock_traslado_items DROP CONSTRAINT stock_traslado_items_cantidad_check;
ALTER TABLE stock_traslado_items ADD CONSTRAINT stock_traslado_items_cantidad_check CHECK (cantidad >= 0);
ALTER TABLE stock_traslado_items ADD COLUMN recibido numeric(12, 3) CHECK (recibido >= 0);

-- El costo de una baja o un alta de stock sin venta (rotura, faltante,
-- conteo, reposición sin cargo, ingreso suelto), congelado al hacerla: el
-- asiento contra Mercaderías sale de acá (M3S3-013). Por unidad de stock,
-- como variant_costs.costo_promedio.
ALTER TABLE inventory_movements ADD COLUMN costo_unitario numeric(14, 4);

-- Los ajustes de los meses abiertos, con el costo promedio de hoy: es el
-- mejor dato que hay, y un mes cerrado no se toca.
UPDATE inventory_movements m SET costo_unitario = c.costo_promedio
FROM variant_costs c
WHERE c.variant_id = m.variant_id AND m.type IN ('ingreso', 'egreso') AND m.note LIKE '% desde Stock%'
  AND NOT EXISTS (SELECT 1 FROM meses_cerrados x WHERE x.mes = mes_de_instante(m.created_at));

-- +goose Down
ALTER TABLE inventory_movements DROP COLUMN costo_unitario;
ALTER TABLE stock_traslado_items DROP COLUMN recibido;
ALTER TABLE stock_traslado_items DROP CONSTRAINT stock_traslado_items_cantidad_check;
DELETE FROM stock_traslado_items WHERE cantidad = 0;
ALTER TABLE stock_traslado_items ADD CONSTRAINT stock_traslado_items_cantidad_check CHECK (cantidad > 0);
ALTER TABLE stock_traslados DROP COLUMN anulado_por_user_id;
ALTER TABLE stock_traslados DROP COLUMN anulado_at;
ALTER TABLE stock_traslados DROP COLUMN faltante;
ALTER TABLE stock_traslados DROP CONSTRAINT stock_traslados_estado_check;
UPDATE stock_traslados SET estado = 'recibido' WHERE estado = 'anulado';
ALTER TABLE stock_traslados ADD CONSTRAINT stock_traslados_estado_check CHECK (estado IN ('en-camino', 'recibido'));

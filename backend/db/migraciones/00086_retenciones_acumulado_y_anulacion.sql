-- +goose Up

-- La base de cada pago sujeto a un régimen, haya retenido o no. El acumulado
-- del mes (RG 830) se arma de acá: antes se leía de retenciones_practicadas,
-- que solo tiene fila cuando hubo retención, y dos pagos de 200.000 con un
-- mínimo no sujeto de 224.000 no retenían nunca.
CREATE TABLE bases_de_retencion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  codigo_regimen text NOT NULL,
  base numeric(14, 2) NOT NULL,
  fecha timestamptz NOT NULL
);
CREATE INDEX bases_de_retencion_mes_idx ON bases_de_retencion (supplier_id, codigo_regimen, fecha);

INSERT INTO bases_de_retencion (payment_id, supplier_id, codigo_regimen, base, fecha)
SELECT payment_id, supplier_id, codigo_regimen, base, fecha FROM retenciones_practicadas;

-- La retención sufrida queda atada al recibo que bajó la deuda: si el recibo
-- se anula, la retención también, y deja de contar como crédito fiscal. El
-- mismo certificado se puede volver a cargar (corregido) una vez anulado.
ALTER TABLE retenciones_sufridas ADD COLUMN receipt_id uuid REFERENCES receipts(id);
ALTER TABLE retenciones_sufridas ADD COLUMN anulada_at timestamptz;
-- Las de antes: el recibo que las cargó (la parte «retencion» con el número
-- del certificado como referencia). Si ese recibo ya estaba anulado, la
-- retención también.
UPDATE retenciones_sufridas r SET receipt_id = (
  SELECT p.receipt_id FROM receipt_parts p
  JOIN receipts rc ON rc.id = p.receipt_id
  WHERE p.medio = 'retencion' AND p.referencia = r.numero AND rc.customer_id = r.customer_id
  ORDER BY rc.created_at LIMIT 1);
UPDATE retenciones_sufridas r SET anulada_at = rc.anulado_at
FROM receipts rc WHERE rc.id = r.receipt_id AND rc.estado = 'anulado';
DROP INDEX retenciones_sufridas_numero_idx;
CREATE UNIQUE INDEX retenciones_sufridas_numero_idx ON retenciones_sufridas (customer_id, numero) WHERE anulada_at IS NULL;

-- +goose Down
DROP INDEX retenciones_sufridas_numero_idx;
CREATE UNIQUE INDEX retenciones_sufridas_numero_idx ON retenciones_sufridas (customer_id, numero);
ALTER TABLE retenciones_sufridas DROP COLUMN anulada_at;
ALTER TABLE retenciones_sufridas DROP COLUMN receipt_id;
DROP TABLE bases_de_retencion;

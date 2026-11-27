-- +goose NO TRANSACTION
-- +goose Up
-- El cobro de una factura anota el medio del recibo en su propia lista, más
-- corta: el depósito y la retención quedaban «transferencia» y el e-Cheq,
-- «cheque». La factura decía «Transferencia SIM-DEP-0801» de un cobro que el
-- recibo y Cobranzas llaman Depósito (mes simulado, M3S2-039). Se suman los
-- tres medios que faltaban; NO TRANSACTION porque un valor nuevo de un enum
-- no se puede usar en la misma transacción que lo agrega.
ALTER TYPE medio_cobro ADD VALUE IF NOT EXISTS 'deposito';
ALTER TYPE medio_cobro ADD VALUE IF NOT EXISTS 'echeq';
ALTER TYPE medio_cobro ADD VALUE IF NOT EXISTS 'retencion';

-- Los de antes, desde su recibo: solo si el recibo tiene un único medio (con
-- varios no se sabe qué renglón de la factura es cuál).
UPDATE invoice_payments ip SET medio = rp.medio::text::medio_cobro
  FROM receipt_parts rp
  WHERE rp.receipt_id = ip.receipt_id AND rp.medio IN ('deposito', 'echeq', 'retencion')
    AND (SELECT count(*) FROM receipt_parts x WHERE x.receipt_id = ip.receipt_id) = 1;

-- +goose Down
UPDATE invoice_payments SET medio = 'transferencia' WHERE medio IN ('deposito', 'retencion');
UPDATE invoice_payments SET medio = 'cheque' WHERE medio = 'echeq';

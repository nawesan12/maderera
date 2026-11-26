-- +goose Up
-- Sin certificado, el proveedor interno dejaba el comprobante en
-- «rechazada» con la observación de que no tiene valor fiscal: Facturación
-- decía «Rechazada por ARCA» de algo que ARCA nunca vio, y el mismo caso
-- facturado desde el panel salía «Sin autorizar». Desde ahora queda
-- «emitida»; los de antes vuelven a ese estado. Solo los que nunca fueron a
-- ARCA: sin CAE, con esa observación y sin ninguna llamada en arca_log.
UPDATE invoices i SET estado = 'emitida', updated_at = now()
WHERE i.estado = 'rechazada' AND i.cae IS NULL
  AND i.observaciones_arca LIKE 'Emitido sin autorización de ARCA%'
  AND NOT EXISTS (SELECT 1 FROM arca_log l WHERE l.invoice_id = i.id);

-- +goose Down
SELECT 1;

-- +goose Up
-- La migración guardaba el CUIT solo con dígitos y el resto del sistema con
-- guiones: el CSV de cuentas a pagar salía mezclado y una ficha cargada a mano
-- no se reconocía al volver a migrarla (mes simulado, M2S2-103 y M2S1-030).
-- Se pasan a «30-71555041-1» los de once dígitos, salvo que ya exista la
-- misma ficha con guiones.
UPDATE customers c
SET cuit = substr(c.cuit, 1, 2) || '-' || substr(c.cuit, 3, 8) || '-' || substr(c.cuit, 11, 1)
WHERE c.cuit ~ '^[0-9]{11}$'
  AND NOT EXISTS (SELECT 1 FROM customers o
                  WHERE o.cuit = substr(c.cuit, 1, 2) || '-' || substr(c.cuit, 3, 8) || '-' || substr(c.cuit, 11, 1));

UPDATE suppliers s
SET cuit = substr(s.cuit, 1, 2) || '-' || substr(s.cuit, 3, 8) || '-' || substr(s.cuit, 11, 1)
WHERE s.cuit ~ '^[0-9]{11}$'
  AND NOT EXISTS (SELECT 1 FROM suppliers o
                  WHERE o.cuit = substr(s.cuit, 1, 2) || '-' || substr(s.cuit, 3, 8) || '-' || substr(s.cuit, 11, 1));

-- +goose Down
-- No se vuelve atrás: los dos formatos son el mismo CUIT.
SELECT 1;

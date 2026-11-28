-- +goose Up
-- Los regímenes de retención como los decidió la clienta (docs/CAMBIOS.md,
-- 17/09/2026): solo retiene Ingresos Brutos, y Ganancias, IVA y SUSS quedan
-- en cero sin borrarse. La tabla se sembraba con un script aparte
-- (lib/db/seed-retenciones.ts) que no corrió después de vaciar la base de
-- producción: quedaron cuatro nacionales reteniendo (Ganancias al 2 %, IVA
-- al 8,68 %, SUSS al 1,2 %) y ninguno de IIBB, y salieron certificados de
-- Ganancias que no correspondían (mes simulado, M2S1-002).
--
-- Los que falten se agregan con los valores de REGIMENES_INICIALES
-- (lib/retenciones/calculo.ts). Los nacionales pasan a cero solo si nadie
-- los cambió desde /admin/arca/retenciones: lo que el admin guardó a
-- propósito (queda en la bitácora) manda.
INSERT INTO regimenes_retencion (codigo, nombre, impuesto, jurisdiccion, alicuota, alicuota_no_inscripto, minimo_no_imponible, minimo_retencion)
VALUES
  ('IIBB-MI', 'Ingresos Brutos · Misiones', 'iibb', 'Misiones', 1.5, 3, 0, 0),
  ('IIBB-BA', 'Ingresos Brutos · Buenos Aires', 'iibb', 'Buenos Aires', 0, 0, 0, 0),
  ('78', 'Ganancias · compra de bienes', 'ganancias', NULL, 0, 0, 224000, 21000),
  ('94', 'Ganancias · locaciones y servicios', 'ganancias', NULL, 0, 0, 67170, 21000),
  ('499', 'IVA · compra de bienes', 'iva', NULL, 0, 0, 0, 0),
  ('SUSS', 'SUSS · servicios de construcción', 'suss', NULL, 0, 0, 0, 0)
ON CONFLICT (codigo) DO NOTHING;

UPDATE regimenes_retencion r SET alicuota = 0, alicuota_no_inscripto = 0, updated_at = now()
WHERE r.impuesto IN ('ganancias', 'iva', 'suss') AND (r.alicuota <> 0 OR r.alicuota_no_inscripto <> 0)
  AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entidad = 'retencion' AND a.entidad_id = r.id::text);

-- +goose Down
SELECT 1;

-- Búsqueda sin acentos.
--
-- La usa `lib/busqueda.ts`: quien escribe "fenolico" tiene que encontrar
-- "Fenólico". unaccent viene con Postgres y está disponible en Neon, así que no
-- agrega dependencias de infraestructura.
CREATE EXTENSION IF NOT EXISTS unaccent;

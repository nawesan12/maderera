-- +goose Up
-- Un mueble mezcla placas: melamina de 18 para el cuerpo y fibrofácil de 3
-- para el fondo (revisión de un carpintero en /corte, 18/11/2026). La
-- consulta pasa a tener varios grupos, cada uno con su placa, su canto y sus
-- piezas, y un solo token.
--
-- El primer grupo sigue en las columnas de `consultas_corte`, tal cual: los
-- enlaces ya mandados se leen igual, y el código anterior —si hubiera que
-- volver atrás— sigue leyendo y pasando a corte el primer grupo. Acá van los
-- demás, desde el orden 1. Cada grupo se pasa a su propia orden de corte,
-- porque una orden es de un solo material.
CREATE TABLE consultas_corte_grupos (
	consulta_id uuid NOT NULL REFERENCES consultas_corte(id) ON DELETE CASCADE,
	orden integer NOT NULL CHECK (orden >= 1),
	variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
	material text NOT NULL,
	placa_largo_mm numeric(8, 1) NOT NULL,
	placa_ancho_mm numeric(8, 1) NOT NULL,
	mitad text,
	canto_descripcion text,
	piezas jsonb NOT NULL,
	cutting_order_id uuid REFERENCES cutting_orders(id) ON DELETE SET NULL,
	PRIMARY KEY (consulta_id, orden)
);

-- +goose Down
DROP TABLE consultas_corte_grupos;

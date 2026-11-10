-- +goose Up
-- El corte que alguien arma en el sitio y manda por WhatsApp (notas del
-- 9/11/2026). El mensaje lleva un enlace a /corte/c/<token> con el plano, y
-- desde el panel se convierte en una orden de corte sin volver a tipearlo.
-- Guarda la medida de la placa y la sierra con que se dibujó: el enlace tiene
-- que mostrar el mismo plano aunque después cambien.
CREATE TABLE consultas_corte (
	id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	token text NOT NULL UNIQUE,
	variant_id uuid REFERENCES product_variants(id) ON DELETE SET NULL,
	material text NOT NULL,
	placa_largo_mm numeric(8, 1) NOT NULL,
	placa_ancho_mm numeric(8, 1) NOT NULL,
	mitad text,
	canto_descripcion text,
	piezas jsonb NOT NULL,
	ancho_sierra_mm numeric(4, 1) NOT NULL,
	branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
	ip text,
	cutting_order_id uuid REFERENCES cutting_orders(id) ON DELETE SET NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE consultas_corte;

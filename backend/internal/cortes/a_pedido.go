package cortes

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/reservas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// PasarAPedido convierte un corte suelto en un pedido (mes simulado, H348 y
// H251): el que se toma por teléfono y «paga al retirar» se marcaba retirado
// con un clic, sin venta, sin cobro y sin que el stock se enterara. Ahora su
// cuenta —las placas que se venden enteras, las pasadas y el tapacanto, a la
// lista del cliente— nace como pedido, con la mercadería reservada, y se
// cobra y se entrega por el camino de todos los pedidos (el recibo, el
// remito). El corte queda atado al pedido, y sus renglones al despiece
// (del_corte), como los del mostrador.
//
// No mueve plata: el cobro sigue siendo el del pedido (cobros.EmitirRecibo).
func (s *Servicio) PasarAPedido(ctx context.Context, ses *auth.Sesion, id string) (string, string, error) {
	f, err := s.Ficha(ctx, id)
	if err != nil {
		return "", "", err
	}
	if f == nil {
		return "", "", noEncontrado
	}
	c := f.Corte
	if f.Modo != "suelto" {
		return "", "", error422(c.Numero + " ya está atado a un pedido.")
	}
	if c.Estado == "cancelado" {
		return "", "", error422(c.Numero + " está anulado.")
	}
	if len(f.Plano.NoEntran) > 0 {
		return "", "", error422(piezasQueNoEntran(len(f.Plano.NoEntran)) + " Corregí el despiece antes de cobrarlo.")
	}
	k := f.Cuenta
	type linea struct {
		variante, presentacion *string
		descripcion, unidad    string
		cantidad, precio       float64
	}
	var lineas []linea
	if k.PlacasEnteras > 0 && k.SubtotalPlacas > 0 && c.VariantID != nil {
		var unidad string
		if err := s.pool.QueryRow(ctx, `
			SELECT p.unit::text FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.id = $1`,
			*c.VariantID).Scan(&unidad); err != nil {
			return "", "", err
		}
		desc := c.Material
		if c.Medida.Mitad != nil {
			p := "media_" + *c.Medida.Mitad
			lineas = append(lineas, linea{c.VariantID, &p, desc + " — " + lower(NombreDeLaMitad(c.Medida.Mitad)), unidad,
				float64(k.PlacasEnteras), redondear(k.SubtotalPlacas / float64(k.PlacasEnteras))})
		} else {
			lineas = append(lineas, linea{c.VariantID, nil, desc, unidad, float64(k.PlacasEnteras), k.PrecioPorPlaca})
		}
	}
	if k.SubtotalCorte > 0 {
		piezas := int(UnidadesDelCorte(c))
		nombre := "piezas"
		if piezas == 1 {
			nombre = "pieza"
		}
		lineas = append(lineas, linea{nil, nil, fmt.Sprintf("Corte a medida %s · %d %s", c.Numero, piezas, nombre), "pasada",
			float64(k.PasadasCobrables), k.PrecioPorPasada})
	}
	if k.SubtotalCanto > 0 && f.Tarifa != nil {
		desc := "Tapacanto pegado"
		if c.CantoDescripcion != nil && *c.CantoDescripcion != "" {
			desc += " — " + *c.CantoDescripcion
		}
		lineas = append(lineas, linea{nil, nil, desc, "m", k.MetrosCanto, f.Tarifa.PrecioPorMetroCanto})
	}
	if len(lineas) == 0 {
		return "", "", error422(c.Numero + " no tiene nada para cobrar.")
	}

	var numero, pedido string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// El corte, bloqueado: dos clics a la vez daban dos pedidos.
		var ya *string
		var estado string
		if err := tx.QueryRow(ctx, `SELECT order_id::text, estado::text FROM cutting_orders WHERE id = $1 FOR UPDATE`, id).Scan(&ya, &estado); err != nil {
			return err
		}
		if ya != nil {
			return error422(c.Numero + " ya está atado a un pedido.")
		}
		if estado == "cancelado" {
			return error422(c.Numero + " está anulado.")
		}
		var err error
		if numero, err = numeracion.Pedido(ctx, tx); err != nil {
			return err
		}
		total := 0.0
		for _, l := range lineas {
			total += ventas.ACentavos(float64(l.cantidad * l.precio))
		}
		total = ventas.ACentavos(total)
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (numero, customer_id, contacto_nombre, contacto_telefono, branch_id, estado, origen,
			                    subtotal, total, created_by_user_id, tipo_entrega, entregar_el)
			VALUES ($1, $2, $3, $4, $5, 'pendiente', 'telefono', $6::numeric, $6::numeric, $7, 'retiro', $8::date)
			RETURNING id::text`,
			numero, c.CustomerID, c.Cliente, c.Telefono, c.BranchID, jsmath.Fijo2(total), ses.UserID, c.RetiraEl).Scan(&pedido); err != nil {
			return err
		}
		var variantes []string
		conPresentacion := make([]reservas.LineaConPresentacion, len(lineas))
		for i, l := range lineas {
			if l.variante != nil {
				variantes = append(variantes, *l.variante)
			}
			conPresentacion[i] = reservas.LineaConPresentacion{VariantID: l.variante, Presentacion: l.presentacion}
		}
		costos, err := reservas.CostosParaCongelar(ctx, tx, variantes)
		if err != nil {
			return err
		}
		factores, err := reservas.FactoresDeStock(ctx, tx, conPresentacion)
		if errors.Is(err, ventas.ErrSinMedidas) {
			return error422(err.Error())
		}
		if err != nil {
			return err
		}
		for i, l := range lineas {
			var costo, alicuota *string
			if l.variante != nil {
				if k, ok := costos[*l.variante]; ok {
					costo = reservas.CostoPorUnidadDeVenta(k.CostoUnitario, factores[i].StockPorUnidad)
					a := k.AlicuotaIva
					alicuota = &a
				}
			}
			precio := jsmath.Fijo2(l.precio)
			if _, err := tx.Exec(ctx, `
				INSERT INTO order_items (order_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal,
				                         presentacion, stock_por_unidad, costo_unitario, alicuota_iva, orden, precio_lista, del_corte)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric, $10::numeric, $11::numeric, $12, $6::numeric, true)`,
				pedido, l.variante, l.descripcion, l.unidad, jsmath.Fijo2(l.cantidad), precio,
				jsmath.Fijo2(ventas.ACentavos(float64(l.cantidad*l.precio))), factores[i].Presentacion,
				jsmath.Texto(factores[i].StockPorUnidad), costo, alicuota, i); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'pendiente', $2, $3)`,
			pedido, "Generado desde el corte "+c.Numero, ses.UserID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE cutting_orders SET order_id = $2, updated_at = now() WHERE id = $1`, id, pedido); err != nil {
			return err
		}
		return reservas.ReservarPedido(ctx, tx, pedido)
	})
	if err != nil {
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "pedido", pedido,
		"Pasó el corte "+c.Numero+" al pedido "+numero, nil)
	return numero, pedido, nil
}

func lower(s string) string {
	if s == "" {
		return s
	}
	r := []rune(s)
	if r[0] >= 'A' && r[0] <= 'Z' {
		r[0] += 'a' - 'A'
	}
	return string(r)
}

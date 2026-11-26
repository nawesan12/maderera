package cortes

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/entregas"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/sqlc"
)

// SumaAlPedido es lo que hace «Sumar al pedido» con lo que el corte de un
// pedido cobra aparte (las pasadas y el tapacanto: las placas ya las vende
// el pedido). Mes simulado, H184: la ficha decía «Fuera del pedido $3.600» y
// no había cómo cobrarlo.
type SumaAlPedido struct {
	Total float64 `json:"total"`
	// Aparte: el pedido ya no se toca (facturado, cobrado o en la cuenta
	// corriente), así que va a un pedido nuevo, con su cobro y su factura.
	Aparte bool `json:"aparte"`
	// Motivo dice por qué va aparte: «PED-1059 ya está facturado.».
	Motivo string `json:"motivo"`
}

// porQueAparte dice por qué no se le suman renglones al pedido (vacío: se
// puede). Lo emitido no se edita: un pedido facturado se cobra aparte. Uno
// cobrado (en la caja, en línea o con recibos) quedaría «pagado» con plata
// sin cobrar, y uno de cuenta corriente ya cargó su compra en la cuenta.
func porQueAparte(ctx context.Context, db consultor, pedido string) (numero, motivo string, cancelado bool, err error) {
	var estado, estadoPago string
	var medio *string
	var facturado, enCuenta bool
	err = db.QueryRow(ctx, `
		SELECT o.numero, o.estado::text, o.estado_pago::text, o.medio_pago::text,
		  EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.estado <> 'anulada'),
		  EXISTS (SELECT 1 FROM account_movements am WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')
		FROM orders o WHERE o.id = $1`, pedido).Scan(&numero, &estado, &estadoPago, &medio, &facturado, &enCuenta)
	if err != nil {
		return "", "", false, err
	}
	switch {
	case estado == "cancelado":
		return numero, numero + " está cancelado.", true, nil
	case facturado:
		return numero, numero + " ya está facturado.", false, nil
	case estadoPago == "pagado":
		return numero, numero + " ya está cobrado.", false, nil
	case enCuenta || (medio != nil && *medio == "cuenta_corriente"):
		return numero, numero + " está en la cuenta corriente.", false, nil
	}
	return numero, "", false, nil
}

// consultor es un pool o una transacción.
type consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// sumaDeLaFicha es SumaAlPedido de una ficha, o nil si no hay nada que sumar.
func (s *Servicio) sumaDeLaFicha(ctx context.Context, f *Ficha) (*SumaAlPedido, error) {
	if f.Modo != "pedido" || f.Cuenta.Total <= 0 || len(f.Plano.NoEntran) > 0 || f.Corte.OrderID == nil {
		return nil, nil
	}
	_, motivo, cancelado, err := porQueAparte(ctx, s.pool, *f.Corte.OrderID)
	if err != nil || cancelado {
		return nil, err
	}
	return &SumaAlPedido{Total: f.Cuenta.Total, Aparte: motivo != "", Motivo: motivo}, nil
}

// SumarAlPedido suma al pedido del corte lo que el corte cobra aparte (sus
// pasadas y su tapacanto), con quien lo confirmó en la ficha. Si el pedido
// ya no se toca, nace un pedido aparte con eso, atado al corte
// (cutting_orders.cargo_order_id), que se cobra y se factura como cualquier
// pedido. Devuelve el número del pedido donde quedó y si es uno nuevo.
//
// No mueve plata: el pedido que crece queda con eso por cobrar (Me deben, el
// cobro de su ficha) y el nuevo nace pendiente.
func (s *Servicio) SumarAlPedido(ctx context.Context, ses *auth.Sesion, id string) (string, bool, error) {
	f, err := s.Ficha(ctx, id)
	if err != nil {
		return "", false, err
	}
	if f == nil {
		return "", false, noEncontrado
	}
	c := f.Corte
	switch {
	case c.Estado == "cancelado":
		return "", false, error422(c.Numero + " está anulado.")
	case f.Modo == "suelto":
		return "", false, error422(c.Numero + " no es de un pedido: pasalo a pedido.")
	case f.Modo != "pedido":
		return "", false, error422("Lo de " + c.Numero + " ya está en el pedido.")
	case len(f.Plano.NoEntran) > 0:
		return "", false, error422(piezasQueNoEntran(len(f.Plano.NoEntran)) + " Corregí el despiece antes de cobrarlo.")
	}
	lineas, err := s.lineasDeLaCuenta(ctx, f)
	if err != nil {
		return "", false, err
	}
	if len(lineas) == 0 {
		return "", false, error422(c.Numero + " no tiene nada fuera del pedido.")
	}
	total := totalDe(lineas)

	var numero, pedido string
	aparte := false
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// El corte, bloqueado: dos «Sumar» a la vez sumaban dos veces.
		var orden *string
		var cargo *string
		if err := tx.QueryRow(ctx, `SELECT order_id::text, cargo_order_id::text FROM cutting_orders WHERE id = $1 FOR UPDATE`, id).
			Scan(&orden, &cargo); err != nil {
			return err
		}
		var ya bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM order_items WHERE cutting_order_id = $1)`, id).Scan(&ya); err != nil {
			return err
		}
		if cargo != nil || ya {
			return error422("Lo de " + c.Numero + " ya está en el pedido.")
		}
		if orden == nil {
			return error422(c.Numero + " no es de un pedido: pasalo a pedido.")
		}
		original := *orden
		if _, err := tx.Exec(ctx, `SELECT 1 FROM orders WHERE id = $1 FOR UPDATE`, original); err != nil {
			return err
		}
		num, motivo, cancelado, err := porQueAparte(ctx, tx, original)
		if err != nil {
			return err
		}
		if cancelado {
			return error422(motivo)
		}
		if motivo == "" {
			// Al mismo pedido: renglones nuevos al final, y el total crece.
			numero, pedido = num, original
			var desde int
			if err := tx.QueryRow(ctx, `SELECT coalesce(max(orden) + 1, 0) FROM order_items WHERE order_id = $1`, original).Scan(&desde); err != nil {
				return err
			}
			if err := insertarRenglones(ctx, tx, original, &id, lineas, desde); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE orders SET subtotal = subtotal + $2::numeric, total = total + $2::numeric, updated_at = now()
				WHERE id = $1`, original, jsmath.Fijo2(total)); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id)
				SELECT id, estado, $2, $3 FROM orders WHERE id = $1`,
				original, "Se sumó lo del corte "+c.Numero+": "+formato.Importe(total), ses.UserID)
			return err
		}
		// Aparte: un pedido nuevo con lo del corte, del mismo cliente y la
		// misma sucursal, que se cobra y se factura por su cuenta.
		aparte = true
		if numero, err = numeracion.Pedido(ctx, tx); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO orders (numero, customer_id, contacto_nombre, contacto_telefono, contacto_email, branch_id, estado, origen,
			                    subtotal, total, created_by_user_id, tipo_entrega, entregar_el)
			SELECT $2, o.customer_id, o.contacto_nombre, coalesce($3, o.contacto_telefono), o.contacto_email, o.branch_id, 'pendiente', o.origen,
			       $4::numeric, $4::numeric, $5, 'retiro', coalesce($6::date, o.entregar_el)
			FROM orders o WHERE o.id = $1
			RETURNING id::text`,
			original, numero, c.Telefono, jsmath.Fijo2(total), ses.UserID, c.RetiraEl).Scan(&pedido); err != nil {
			return err
		}
		if err := insertarRenglones(ctx, tx, pedido, &id, lineas, 0); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE cutting_orders SET cargo_order_id = $2, updated_at = now() WHERE id = $1`, id, pedido); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'pendiente', $2, $3)`,
			pedido, "Lo del corte "+c.Numero+" de "+num+": "+motivo, ses.UserID); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id)
			SELECT id, estado, $2, $3 FROM orders WHERE id = $1`,
			original, "Lo del corte "+c.Numero+" se cobra en "+numero+": "+formato.Importe(total), ses.UserID)
		return err
	})
	if err != nil {
		return "", false, err
	}
	desc := "Sumó lo del corte " + c.Numero + " al pedido " + numero + " (" + formato.Importe(total) + ")"
	accion := sqlc.AccionAuditoriaEditar
	if aparte {
		desc = "Pasó lo del corte " + c.Numero + " al pedido aparte " + numero + " (" + formato.Importe(total) + ")"
		accion = sqlc.AccionAuditoriaCrear
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "pedido", pedido, desc, nil)
	return numero, aparte, nil
}

// RemitoDeReposicion es el remito de una reposición sin cargo en su ficha.
type RemitoDeReposicion struct {
	ID         string  `json:"id"`
	Numero     string  `json:"numero"`
	FirmaToken *string `json:"firmaToken"`
	Firmado    bool    `json:"firmado"`
}

// remitoDeLaFicha es el remito vivo de la reposición, si tiene.
func (s *Servicio) remitoDeLaFicha(ctx context.Context, corte string) (*RemitoDeReposicion, error) {
	var r RemitoDeReposicion
	err := s.pool.QueryRow(ctx, `SELECT id::text, numero, firma_token, firmado_at IS NOT NULL FROM deliveries
		WHERE cutting_order_id = $1 AND estado <> 'anulada'`, corte).Scan(&r.ID, &r.Numero, &r.FirmaToken, &r.Firmado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// RemitoDeLaReposicion hace el remito sin cargo de una reposición ya
// entregada (H321), o devuelve el que tiene: lo llama el paso a «retirado»
// y la ficha, si el remito se anuló. Deja en el pedido la entrega, con el
// número del remito.
func (s *Servicio) RemitoDeLaReposicion(ctx context.Context, ses *auth.Sesion, id string) (*entregas.EntregaCreada, error) {
	var out *entregas.EntregaCreada
	nuevo := false
	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var estado string
		var pedido *string
		var sinCargo bool
		if err := tx.QueryRow(ctx, `SELECT numero, estado::text, order_id::text, sin_cargo FROM cutting_orders WHERE id = $1 FOR UPDATE`, id).
			Scan(&numero, &estado, &pedido, &sinCargo); errors.Is(err, pgx.ErrNoRows) {
			return noEncontrado
		} else if err != nil {
			return err
		}
		if !sinCargo || pedido == nil {
			return error422(numero + " no es una reposición de un pedido.")
		}
		if estado != "retirado" {
			return error422(numero + " todavía no se entregó.")
		}
		var ya bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM deliveries WHERE cutting_order_id = $1 AND estado <> 'anulada')`, id).Scan(&ya); err != nil {
			return err
		}
		var err error
		if out, err = entregas.RemitoDeReposicion(ctx, tx, id, &ses.UserID); err != nil {
			return err
		}
		if ya {
			return nil
		}
		nuevo = true
		_, err = tx.Exec(ctx, `
			INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id)
			SELECT id, estado, $2, $3 FROM orders WHERE id = $1`,
			*pedido, "Reposición sin cargo entregada: "+numero+" · remito "+out.Numero, ses.UserID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if nuevo {
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "remito", out.ID,
			"Remito "+out.Numero+" de la reposición sin cargo "+numero, nil)
	}
	return out, nil
}

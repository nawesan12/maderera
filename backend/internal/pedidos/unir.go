package pedidos

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Lo que la tienda ya no ata sola (checkout.clientePorCorreo, auditoría del
// 30/10): un pedido o un presupuesto sin sesión con el correo de un cliente
// que existe queda sin cliente, y la ficha del panel muestra la ficha con
// ese correo para unirlo a mano. Solo a esa ficha: el correo es lo que
// prueba que es el mismo, y lo mira una persona.

// FichaParaUnir es la ficha con el correo del contacto de un pedido o
// presupuesto sin cliente.
type FichaParaUnir struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
	// Unible: si se puede unir desde acá. Un pedido con recibos o
	// comprobantes no: esos papeles ya salieron sin cliente.
	Unible bool `json:"unible"`
}

// fichaConElCorreo es la ficha activa con ese correo (la más vieja), o nil.
func (s *Servicio) fichaConElCorreo(ctx context.Context, correo *string) (*FichaParaUnir, error) {
	if correo == nil || *correo == "" {
		return nil, nil
	}
	var f FichaParaUnir
	err := s.pool.QueryRow(ctx, `SELECT id, nombre FROM customers WHERE lower(trim(email)) = lower(trim($1)) AND active
		ORDER BY created_at, id LIMIT 1`, *correo).Scan(&f.ID, &f.Nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &f, nil
}

// pedidoConPapeles: tiene recibos o comprobantes.
func pedidoConPapeles(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, pedido string) (bool, error) {
	var hay bool
	err := q.QueryRow(ctx, `SELECT exists(SELECT 1 FROM receipts WHERE order_id = $1) OR exists(SELECT 1 FROM invoices WHERE order_id = $1)`,
		pedido).Scan(&hay)
	return hay, err
}

const (
	msjFichaAjena = "Esa ficha no tiene el correo de este contacto."
	msjYaTiene    = "Ya tiene cliente."
	msjConPapeles = "Este pedido ya tiene recibos o comprobantes sin cliente: no se puede unir desde acá."
)

func noSeUne(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

// UnirAFicha ata un pedido (tabla "orders") o un presupuesto ("quotes") sin
// cliente a la ficha que tiene el correo de su contacto, con su vendedor si
// no tenía, y lo anota en la bitácora.
func (s *Servicio) UnirAFicha(ctx context.Context, ses *auth.Sesion, tabla, id, cliente string) (string, error) {
	if tabla != "orders" && tabla != "quotes" {
		return "", errors.New("tabla desconocida")
	}
	entidad, nombre := "pedido", "El pedido"
	if tabla == "quotes" {
		entidad, nombre = "presupuesto", "El presupuesto"
	}
	if !plataforma.UUIDValido(cliente) {
		return "", noSeUne(msjFichaAjena)
	}
	var numero, ficha string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var actual, correo *string
		err := tx.QueryRow(ctx, `SELECT numero, customer_id::text, contacto_email FROM `+tabla+` WHERE id = $1 FOR UPDATE`, id).
			Scan(&numero, &actual, &correo)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró.")
		}
		if err != nil {
			return err
		}
		if actual != nil {
			return noSeUne(msjYaTiene)
		}
		var vendedor *string
		err = tx.QueryRow(ctx, `SELECT nombre, seller_id::text FROM customers
			WHERE id = $1 AND active AND $2::text IS NOT NULL AND lower(trim(email)) = lower(trim($2))`, cliente, correo).Scan(&ficha, &vendedor)
		if errors.Is(err, pgx.ErrNoRows) {
			return noSeUne(msjFichaAjena)
		}
		if err != nil {
			return err
		}
		if tabla == "orders" {
			hay, err := pedidoConPapeles(ctx, tx, id)
			if err != nil {
				return err
			}
			if hay {
				return noSeUne(msjConPapeles)
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE `+tabla+` SET customer_id = $2, seller_id = coalesce(seller_id, $3::uuid), updated_at = now() WHERE id = $1`,
			id, cliente, vendedor); err != nil {
			return err
		}
		if tabla != "orders" {
			return nil
		}
		// Lo que la compra anónima insertó sin cliente (checkout.compra) va
		// con el pedido: sus pagos (Cobranzas, la lista de Pagos y los
		// filtros por cliente) y sus cortes (la bandeja de WhatsApp los
		// lista por cliente). Solo los que no tenían cliente.
		if _, err := tx.Exec(ctx, `UPDATE payments SET customer_id = $2, updated_at = now() WHERE order_id = $1 AND customer_id IS NULL`, id, cliente); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE cutting_orders SET customer_id = $2, updated_at = now() WHERE order_id = $1 AND customer_id IS NULL`, id, cliente)
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, sqlc.New(s.pool), s.log, ses, sqlc.AccionAuditoriaEditar, entidad, id,
		"Unió "+numero+" a la ficha de "+ficha+" (era sin cliente, con su correo)", map[string]any{"customerId": cliente})
	return nombre + " " + numero + " quedó en la ficha de " + ficha + ".", nil
}

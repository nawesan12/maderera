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
	// Telefono, para comparar con el del contacto antes de unir.
	Telefono *string `json:"telefono"`
	// Unible: si se puede unir desde acá. Un pedido con recibos o
	// comprobantes no: esos papeles ya salieron sin cliente.
	Unible bool `json:"unible"`
}

// fichaConElCorreo es la única ficha activa con ese correo que no es de otra
// cuenta web, o nil (comité del 25/11):
//   - una ficha con cuenta web es de alguien que entra al portal: lo que se
//     una ahí lo ve esa persona, y un pedido anónimo con su correo lo pudo
//     hacer cualquiera (el mismo filtro que checkout.clientePorCorreo);
//   - con dos o más fichas con ese correo no se elige ninguna: elegir la más
//     vieja era adivinar, y el error deja datos de una persona en la ficha de
//     otra. Se busca a mano.
//
// conCuentaWeb (M2S2-069): el presupuesto lo armó alguien del panel (no
// llegó anónimo del sitio): el correo lo escribió una persona del local, así
// que también se ofrece la ficha que tiene cuenta web. Lo anónimo sigue con
// la regla del comité.
func (s *Servicio) fichaConElCorreo(ctx context.Context, correo *string, conCuentaWeb ...bool) (*FichaParaUnir, error) {
	if correo == nil || *correo == "" {
		return nil, nil
	}
	web := len(conCuentaWeb) > 0 && conCuentaWeb[0]
	filas, err := s.pool.Query(ctx, `SELECT id, nombre, nullif(trim(telefono), '') FROM customers
		WHERE lower(trim(email)) = lower(trim($1)) AND active AND ($2 OR user_id IS NULL)
		ORDER BY created_at, id LIMIT 2`, *correo, web)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var halladas []FichaParaUnir
	for filas.Next() {
		var f FichaParaUnir
		if err := filas.Scan(&f.ID, &f.Nombre, &f.Telefono); err != nil {
			return nil, err
		}
		halladas = append(halladas, f)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	if len(halladas) != 1 {
		return nil, nil
	}
	return &halladas[0], nil
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
		var origen string
		err := tx.QueryRow(ctx, `SELECT numero, customer_id::text, contacto_email, origen::text FROM `+tabla+` WHERE id = $1 FOR UPDATE`, id).
			Scan(&numero, &actual, &correo, &origen)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró.")
		}
		if err != nil {
			return err
		}
		if actual != nil {
			return noSeUne(msjYaTiene)
		}
		var vendedor, telefonoFicha *string
		// La misma regla que fichaConElCorreo: sin cuenta web (salvo un
		// presupuesto armado en el panel) y la única con ese correo.
		web := tabla == "quotes" && ArmadoEnElPanel(origen)
		err = tx.QueryRow(ctx, `SELECT nombre, seller_id::text, nullif(trim(telefono), '') FROM customers c
			WHERE id = $1 AND active AND ($3 OR user_id IS NULL) AND $2::text IS NOT NULL AND lower(trim(email)) = lower(trim($2))
			  AND NOT EXISTS (SELECT 1 FROM customers o WHERE o.id <> c.id AND o.active AND ($3 OR o.user_id IS NULL)
			                  AND lower(trim(o.email)) = lower(trim($2)))`, cliente, correo, web).Scan(&ficha, &vendedor, &telefonoFicha)
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
			// El presupuesto toma el nombre y el teléfono de la ficha
			// (M2S1-193): seguía «Rocío (consulta web)», sin teléfono, y el
			// pedido que salía de él lo heredaba.
			_, err := tx.Exec(ctx, `UPDATE quotes SET contacto_nombre = $2, contacto_telefono = coalesce($3, contacto_telefono) WHERE id = $1`,
				id, ficha, telefonoFicha)
			return err
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

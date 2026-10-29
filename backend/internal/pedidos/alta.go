package pedidos

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// CrearPresupuesto carga un presupuesto a mano (el que llega por teléfono:
// origen «telefono»). Con `convertir`, además lo pasa a pedido con la misma
// función que el botón del listado: quien llama muchas veces ya está
// comprando.
//
// El número sale con el año de la Argentina: el TS usaba el del servidor
// (UTC), y de 21 a 24 del 31 de diciembre numeraba con el año siguiente.
func (s *Servicio) CrearPresupuesto(ctx context.Context, ses *auth.Sesion, cabecera map[string]any, lineas []any, convertir bool) (*Resultado, error) {
	alta, e := LeerAltaDePresupuesto(cabecera, lineas)
	if e != nil {
		return nil, fallo(e.Mensaje)
	}
	c := alta.Cabecera
	ahora := s.ahora()
	// setDate(getDate() + n) en la zona del servidor; la Argentina no tiene
	// horario de verano, así que es el mismo instante.
	validoHasta := ahora.UTC().AddDate(0, 0, int(c.DiasValidez))

	// El vendedor de la operación: el que se eligió, o el asignado al cliente.
	sellerID := c.SellerID
	if sellerID == nil && c.CustomerID != nil {
		err := s.pool.QueryRow(ctx, `SELECT seller_id FROM customers WHERE id = $1`, *c.CustomerID).Scan(&sellerID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	var email *string
	if c.ContactoEmail != nil && *c.ContactoEmail != "" {
		email = c.ContactoEmail
	}

	var numero, id string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var err error
		if numero, err = numeracion.Presupuesto(ctx, tx, ahora.In(argentina)); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO quotes (numero, customer_id, contacto_nombre, contacto_email, contacto_telefono, branch_id, estado, origen,
			                    subtotal, total, notas, asesor, seller_id, valido_hasta, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', 'telefono', $7::numeric, $7::numeric, $8, $9, $10, $11, $12)
			RETURNING id`, numero, c.CustomerID, c.ContactoNombre, email, c.ContactoTelefono, c.BranchID, alta.Subtotal, c.Notas,
			ses.Nombre, sellerID, validoHasta, ses.UserID).Scan(&id); err != nil {
			return err
		}
		for i, l := range alta.Lineas {
			x := alta.Items[i]
			if _, err := tx.Exec(ctx, `
				INSERT INTO quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8)`,
				id, l.VariantID, l.Descripcion, l.Unidad, x.Cantidad, x.PrecioUnitario, x.Subtotal, i); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "presupuesto", numero, "Cargó el presupuesto "+numero+" para "+c.ContactoNombre, nil)

	if !convertir {
		return &Resultado{Ok: "Se creó el presupuesto " + numero + ".", ID: id, Numero: numero}, nil
	}
	conv, err := s.ConvertirEnPedido(ctx, ses, id)
	var p *plataforma.Problema
	if errors.As(err, &p) && p.Estado < http.StatusInternalServerError {
		return &Resultado{Ok: "Se creó el presupuesto " + numero + ", pero no se pudo pasar a pedido: " + p.Detalle, ID: id, Numero: numero}, nil
	}
	if err != nil {
		return nil, err
	}
	return &Resultado{Ok: conv.Ok + " Salió del presupuesto " + numero + ".", ID: conv.ID, Numero: conv.Numero}, nil
}

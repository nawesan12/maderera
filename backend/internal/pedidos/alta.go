package pedidos

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
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
	if err := sinPrecio(alta); err != nil {
		return nil, err
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
			                    subtotal, total, notas, asesor, seller_id, valido_hasta, created_by_user_id, necesita_para)
			VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', 'telefono', $7::numeric, $7::numeric, $8, $9, $10, $11, $12, $13)
			RETURNING id`, numero, c.CustomerID, c.ContactoNombre, email, c.ContactoTelefono, c.BranchID, alta.Subtotal, c.Notas,
			ses.Nombre, sellerID, validoHasta, ses.UserID, c.NecesitaPara).Scan(&id); err != nil {
			return err
		}
		// El precio de lista de cada renglón queda guardado: al pasar a pedido
		// se mide contra él lo que se deja de cobrar (ConvertirConEntrega).
		listas, err := listasAlEmitir(ctx, tx, c.CustomerID, alta.Lineas)
		if err != nil {
			return err
		}
		for i, l := range alta.Lineas {
			x := alta.Items[i]
			if _, err := tx.Exec(ctx, `
				INSERT INTO quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden, precio_lista)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric)`,
				id, l.VariantID, l.Descripcion, l.Unidad, x.Cantidad, x.PrecioUnitario, x.Subtotal, i, fijo2ONulo(listas[i])); err != nil {
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

// sinPrecio frena un renglón a $0 (mes simulado: la escalera «a medida —
// consultar» se presupuestaba a $0 y el botón seguía activo). Va aparte de
// LeerAltaDePresupuesto, que copia el esquema de zod.
func sinPrecio(alta *AltaDePresupuesto) error {
	for _, l := range alta.Lineas {
		if !(l.PrecioUnitario > 0) {
			return fallo("Falta el precio de «" + l.Descripcion + "».")
		}
	}
	return nil
}

// listasAlEmitir es el precio de lista de hoy de cada renglón, para la
// lista del cliente.
func listasAlEmitir(ctx context.Context, tx pgx.Tx, cliente *string, lineas []LineaDePresupuesto) ([]*float64, error) {
	lista, err := precios.ListaDelCliente(ctx, tx, cliente)
	if err != nil {
		return nil, err
	}
	r := make([]precios.RenglonConVariante, len(lineas))
	for i, l := range lineas {
		r[i] = precios.RenglonConVariante{VariantID: l.VariantID}
	}
	return precios.PreciosDeLista(ctx, tx, r, lista)
}

// EditarPresupuesto corrige un presupuesto que todavía no se mandó (mes
// simulado: no se podía editar, y un renglón equivocado obligaba a
// rechazarlo —un rechazo «falso» en las estadísticas— y cargarlo de nuevo).
// Solo pendiente o en revisión y sin pedido: lo que ya vio el cliente no se
// cambia por debajo. Conserva el número, el origen y la fecha; la validez
// corre desde hoy.
func (s *Servicio) EditarPresupuesto(ctx context.Context, ses *auth.Sesion, id string, cabecera map[string]any, lineas []any) (*Resultado, error) {
	alta, e := LeerAltaDePresupuesto(cabecera, lineas)
	if e != nil {
		return nil, fallo(e.Mensaje)
	}
	if err := sinPrecio(alta); err != nil {
		return nil, err
	}
	c := alta.Cabecera
	validoHasta := s.ahora().UTC().AddDate(0, 0, int(c.DiasValidez))
	var email *string
	if c.ContactoEmail != nil && *c.ContactoEmail != "" {
		email = c.ContactoEmail
	}
	var numero string
	err := s.enTransaccion(ctx, func(tx pgx.Tx) error {
		var estado string
		err := tx.QueryRow(ctx, `SELECT numero, estado::text FROM quotes WHERE id = $1 FOR UPDATE`, id).Scan(&numero, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return noEsta("No se encontró el presupuesto.")
		}
		if err != nil {
			return err
		}
		if estado != "pendiente" && estado != "revision" {
			return fallo("El presupuesto ya se mandó o se cerró: para cambiarlo, duplicalo.")
		}
		var conPedido bool
		if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM orders WHERE quote_id = $1 AND estado <> 'cancelado')`, id).Scan(&conPedido); err != nil {
			return err
		}
		if conPedido {
			return fallo("El presupuesto ya tiene pedido: para cambiarlo, duplicalo.")
		}
		if _, err := tx.Exec(ctx, `
			UPDATE quotes SET customer_id = $2, contacto_nombre = $3, contacto_email = $4, contacto_telefono = $5, branch_id = $6,
			       subtotal = $7::numeric, total = $7::numeric, notas = $8, valido_hasta = $9, necesita_para = $10, updated_at = now()
			WHERE id = $1`, id, c.CustomerID, c.ContactoNombre, email, c.ContactoTelefono, c.BranchID, alta.Subtotal, c.Notas,
			validoHasta, c.NecesitaPara); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM quote_items WHERE quote_id = $1`, id); err != nil {
			return err
		}
		listas, err := listasAlEmitir(ctx, tx, c.CustomerID, alta.Lineas)
		if err != nil {
			return err
		}
		for i, l := range alta.Lineas {
			x := alta.Items[i]
			if _, err := tx.Exec(ctx, `
				INSERT INTO quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, orden, precio_lista)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9::numeric)`,
				id, l.VariantID, l.Descripcion, l.Unidad, x.Cantidad, x.PrecioUnitario, x.Subtotal, i, fijo2ONulo(listas[i])); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaEditar, "presupuesto", id, "Corrigió el presupuesto "+numero, nil)
	return &Resultado{Ok: "Presupuesto " + numero + " corregido.", ID: id, Numero: numero}, nil
}

package whatsapp

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/clientes"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// FormFicha es el alta de una ficha desde una conversación.
type FormFicha struct{ Nombre, Documento, Rubro, Email string }

// CrearFicha es crearFichaDesdeConversacion: da de alta la ficha con el
// teléfono de la conversación (si lo hay), le pone el correo si es válido,
// la vincula y lo anota. Todo en una transacción: si el vínculo falla, no
// queda una ficha suelta.
func (s *Servicio) CrearFicha(ctx context.Context, ses *auth.Sesion, convID string, f FormFicha) (Resultado, error) {
	c, err := s.laConversacion(ctx, convID)
	if err != nil {
		return Resultado{}, err
	}
	if c == nil {
		return conError(noEncontrada), nil
	}
	if c.CustomerID != nil {
		return conError("Esta conversación ya tiene ficha."), nil
	}
	nombre := strings.TrimSpace(f.Nombre)
	switch {
	case plataforma.LargoJS(nombre) < 2:
		return conError("Escribí el nombre."), nil
	case plataforma.LargoJS(nombre) > 160:
		return conError("Too big: expected string to have <=160 characters"), nil
	}
	doc, e := clientes.LeerDocumento(f.Documento)
	if e != "" {
		return conError(e), nil
	}
	var telefono *string
	if !SinNumero(c.WaJid) {
		t := NumeroLegible(c.WaJid)
		telefono = &t
	}
	var rubro *string
	if f.Rubro != "" {
		rubro = &f.Rubro
	}
	notas := "Alta desde una conversación de WhatsApp."
	var id string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		id, err = clientes.CrearRapido(ctx, tx, clientes.ClienteNuevo{Nombre: nombre, Documento: doc,
			CondicionIva: clientes.SugerirCondicionIva(doc), Telefono: telefono, Rubro: rubro, Notas: &notas})
		if err != nil {
			return err
		}
		if correo := strings.TrimSpace(f.Email); correo != "" && plataforma.CorreoValido(correo) {
			if _, err := tx.Exec(ctx, `UPDATE customers SET email = $2 WHERE id = $1`, id, correo); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE whatsapp_conversaciones SET customer_id = $2, updated_at = now() WHERE id = $1`, c.ID, id)
		return err
	})
	if err != nil {
		return Resultado{}, err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "cliente", id, "Ficha de "+nombre+" creada desde WhatsApp", nil)
	return Resultado{Ok: "Ficha de " + nombre + " creada."}, nil
}

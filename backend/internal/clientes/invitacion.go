package clientes

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Invitacion es la cuenta web que se le abrió a una ficha del panel.
type Invitacion struct {
	Nombre, Correo, Token string
}

// InvitarAlPortal le abre la cuenta web a un cliente cargado en el panel
// (M2S1-097): una cuenta sin clave con el correo de la ficha, atada a ella,
// y un link de activación de 7 días (como la del profesional aprobado). El
// link mágico de /entrar no servía: sin cuenta no devuelve nada.
//
// No se ata a una cuenta que ya existe con ese correo: la abrió alguien,
// y la ficha se le une cuando entra («Es la misma persona, vincular»).
func (s *Servicio) InvitarAlPortal(ctx context.Context, ses *auth.Sesion, cliente string) (Invitacion, error) {
	var inv Invitacion
	if !plataforma.UUIDValido(cliente) {
		return inv, mal("customerId", "No encontramos ese cliente.")
	}
	var correo *string
	var usuario *string
	err := s.pool.QueryRow(ctx, `SELECT nombre, email, user_id FROM customers WHERE id = $1 AND active`, cliente).Scan(&inv.Nombre, &correo, &usuario)
	if errors.Is(err, pgx.ErrNoRows) {
		return inv, mal("customerId", "No encontramos ese cliente.")
	}
	if err != nil {
		return inv, err
	}
	switch {
	case usuario != nil:
		return inv, mal("customerId", "Ya tiene cuenta web.")
	case correo == nil || !plataforma.CorreoValido(strings.TrimSpace(*correo)):
		return inv, mal("email", "Cargale el correo en «Editar datos» para invitarlo.")
	}
	inv.Correo = strings.ToLower(strings.TrimSpace(*correo))
	var existe bool
	if err := s.pool.QueryRow(ctx, `SELECT exists(SELECT 1 FROM "user" WHERE email = $1)`, inv.Correo).Scan(&existe); err != nil {
		return inv, err
	}
	if existe {
		return inv, mal("email", "Ese correo ya tiene una cuenta web: cuando entre, la ficha ofrece vincularla.")
	}
	ahora := time.Now()
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		nueva, err := auth.CrearCuentaSinClave(ctx, s.q.WithTx(tx), inv.Nombre, inv.Correo, ahora)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE customers SET user_id = $2, updated_at = now() WHERE id = $1 AND user_id IS NULL`, cliente, nueva); err != nil {
			return err
		}
		inv.Token, err = auth.NuevoEnlace(ctx, tx, nueva, auth.EnlaceActivacion, auth.VenceActivacion, ahora)
		return err
	})
	if err != nil {
		return inv, err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "cliente", cliente, "Invitó al portal a "+inv.Nombre+" ("+inv.Correo+")", nil)
	return inv, nil
}

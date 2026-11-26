package clientes

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/sqlc"
)

// El personal (mes simulado, H006): alta, puesto y baja desde el panel, con
// la bitácora. La cuenta la maneja auth; acá va lo que la ata a la venta.
//
// **El vendedor nace con el alta.** «Vendedores» es la lista de nombres para
// las comisiones y la ficha del cliente, y no sabía nada de los usuarios: los
// vendedores del mes simulado no aparecían y la ficha solo ofrecía «Sin
// asignar». Quien entra con puesto de ventas queda también en esa lista, con
// su nombre (el índice único de sellers es por nombre: si ya estaba, se
// reactiva). Al darle la baja se desactiva: no se le asignan clientes nuevos,
// y los que tenía siguen a su nombre.

// Personal es la lista de la pantalla.
func (s *Servicio) Personal(ctx context.Context) ([]auth.Persona, error) {
	return auth.ListarPersonal(ctx, s.pool)
}

// AltaDePersonal da de alta a alguien. Devuelve el mensaje para la pantalla.
func (s *Servicio) AltaDePersonal(ctx context.Context, ses *auth.Sesion, nombre, correo, clave string, rol sqlc.StaffRole) (string, error) {
	var mensaje string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		id, conSuClave, err := auth.AltaDePersonal(ctx, tx, correo, nombre, clave, rol, time.Now())
		if err != nil {
			return err
		}
		var quien string
		if err := tx.QueryRow(ctx, `SELECT name FROM "user" WHERE id = $1`, id).Scan(&quien); err != nil {
			return err
		}
		if rol == sqlc.StaffRoleVendedor {
			if err := vendedorDe(ctx, tx, quien); err != nil {
				return err
			}
		}
		mensaje = quien + " ya puede entrar."
		if conSuClave {
			mensaje = quien + " ya puede entrar, con la contraseña que ya tenía."
		}
		bitacora.Anotar(ctx, s.q.WithTx(tx), s.log, ses, sqlc.AccionAuditoriaCrear, "usuario", id,
			"Dio de alta a "+quien+" en el personal ("+string(rol)+")", nil)
		return nil
	})
	return mensaje, err
}

// CambiarPuesto cambia el rol de alguien del personal.
func (s *Servicio) CambiarPuesto(ctx context.Context, ses *auth.Sesion, id string, rol sqlc.StaffRole) (string, error) {
	var mensaje string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		quien, err := auth.CambiarPuesto(ctx, tx, ses, id, rol)
		if err != nil {
			return err
		}
		if rol == sqlc.StaffRoleVendedor {
			if err := vendedorDe(ctx, tx, quien); err != nil {
				return err
			}
		}
		mensaje = "Puesto de " + quien + " cambiado."
		bitacora.Anotar(ctx, s.q.WithTx(tx), s.log, ses, sqlc.AccionAuditoriaEditar, "usuario", id,
			"Cambió el puesto de "+quien+" a "+string(rol), nil)
		return nil
	})
	return mensaje, err
}

// BajaDePersonal saca a alguien del personal.
func (s *Servicio) BajaDePersonal(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	var mensaje string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		quien, err := auth.BajaDePersonal(ctx, tx, ses, id)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE sellers SET activo = false WHERE nombre = $1`, quien); err != nil {
			return err
		}
		mensaje = quien + " ya no entra al panel."
		bitacora.Anotar(ctx, s.q.WithTx(tx), s.log, ses, sqlc.AccionAuditoriaEliminar, "usuario", id,
			"Dio de baja a "+quien+" del personal", nil)
		return nil
	})
	return mensaje, err
}

// vendedorDe deja a la persona en la lista de vendedores, activa.
func vendedorDe(ctx context.Context, tx pgx.Tx, nombre string) error {
	_, err := tx.Exec(ctx, `INSERT INTO sellers (nombre, tipo) VALUES ($1, 'salon')
		ON CONFLICT (nombre) DO UPDATE SET activo = true`, nombre)
	return err
}

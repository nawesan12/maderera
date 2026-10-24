package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/sqlc"
)

// Las altas a mano, desde la terminal (mjbj usuario …): lo que hacían
// lib/db/create-staff.ts y create-cliente.ts con better-auth.

// crearUsuarioConClave crea user + account + perfil de cliente, sin sesión.
func (s *Servicio) crearUsuarioConClave(ctx context.Context, q *sqlc.Queries, correo, nombre, clave string) (string, error) {
	hash, err := hashearClave(clave)
	if err != nil {
		return "", err
	}
	ahora := s.ahora()
	id := nuevoID()
	if err := q.CrearUsuario(ctx, sqlc.CrearUsuarioParams{ID: id, Name: nombre, Email: correo, CreatedAt: ahora}); err != nil {
		return "", err
	}
	if err := q.CrearCuentaConClave(ctx, sqlc.CrearCuentaConClaveParams{ID: nuevoID(), AccountID: id, Password: &hash, CreatedAt: ahora}); err != nil {
		return "", err
	}
	return id, q.CrearPerfilDeCliente(ctx, id)
}

// AltaDeStaff da de alta (o actualiza la clave y el rol de) alguien del
// personal. Devuelve qué hizo, para mostrarlo.
func (s *Servicio) AltaDeStaff(ctx context.Context, correo, clave, nombre string, rol sqlc.StaffRole) (string, error) {
	if !rol.Valid() {
		return "", fmt.Errorf("rol inválido: %s (opciones: %v)", rol, sqlc.AllStaffRoleValues())
	}
	correo = normalizarCorreo(correo)
	var hecho string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		previo, err := q.UsuarioPorCorreo(ctx, correo)
		var id string
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if id, err = s.crearUsuarioConClave(ctx, q, correo, nombre, clave); err != nil {
				return err
			}
			hecho = "creado"
		case err != nil:
			return err
		case !previo.ConClave:
			// Un usuario sin credenciales (quedó a medias): se recrea.
			if err := q.BorrarUsuario(ctx, previo.ID); err != nil {
				return err
			}
			if id, err = s.crearUsuarioConClave(ctx, q, correo, nombre, clave); err != nil {
				return err
			}
			hecho = "recreado (no tenía clave)"
		default:
			hash, err := hashearClave(clave)
			if err != nil {
				return err
			}
			id = previo.ID
			if err := q.CambiarClave(ctx, sqlc.CambiarClaveParams{UserID: id, Password: &hash, UpdatedAt: s.ahora()}); err != nil {
				return err
			}
			hecho = "ya existía: clave y rol actualizados"
		}
		return q.HacerStaff(ctx, sqlc.HacerStaffParams{UserID: id, StaffRole: &rol})
	})
	return hecho, err
}

// AltaDeCliente da de alta una cuenta de cliente. Si ya hay una ficha con
// ese correo sin usuario (cargada desde el mostrador o migrada de ISIS), la
// cuenta se vincula a ella y hereda pedidos, presupuestos y cuenta corriente;
// si la ficha es de un profesional, la cuenta también.
func (s *Servicio) AltaDeCliente(ctx context.Context, correo, clave, nombre string) ([]string, error) {
	correo = normalizarCorreo(correo)
	var pasos []string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		ficha, errFicha := q.FichaSinUsuarioPorCorreo(ctx, &correo)
		if errFicha != nil && !errors.Is(errFicha, pgx.ErrNoRows) {
			return errFicha
		}
		hayFicha := errFicha == nil
		if nombre == "" && hayFicha {
			nombre = ficha.Nombre
		}
		if nombre == "" {
			nombre = correo
		}
		var id string
		previo, err := q.UsuarioPorCorreo(ctx, correo)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			if id, err = s.crearUsuarioConClave(ctx, q, correo, nombre, clave); err != nil {
				return err
			}
			pasos = append(pasos, "Usuario creado: "+correo)
		case err != nil:
			return err
		default:
			id = previo.ID
			pasos = append(pasos, correo+" ya existe como usuario. Reuso la cuenta.")
		}
		if hayFicha {
			if err := q.VincularFicha(ctx, sqlc.VincularFichaParams{ID: ficha.ID, UserID: &id}); err != nil {
				return err
			}
			if ficha.Tipo == sqlc.TipoClienteProfesional {
				if err := q.HacerProfesional(ctx, id); err != nil {
					return err
				}
			}
			pasos = append(pasos, fmt.Sprintf("Vinculada a la ficha de %q: hereda sus pedidos, presupuestos y cuenta corriente.", ficha.Nombre))
			return nil
		}
		tiene, err := q.TieneFicha(ctx, &id)
		if err != nil {
			return err
		}
		if !tiene {
			if err := q.CrearFichaManual(ctx, sqlc.CrearFichaManualParams{UserID: &id, Nombre: nombre, Email: &correo}); err != nil {
				return err
			}
			pasos = append(pasos, "Ficha de cliente nueva creada (sin historial).")
		}
		return nil
	})
	return pasos, err
}

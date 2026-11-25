package cuentas

import (
	"context"
	"errors"
	"math"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/formato"
	"mjbj/internal/sqlc"
)

// MiCredito es lo que dice creditoDisponible del portal.
type MiCredito struct {
	Habilitado      bool    `json:"habilitado"`
	Saldo           float64 `json:"saldo"`
	LimiteCredito   float64 `json:"limiteCredito"`
	Disponible      float64 `json:"disponible"`
	SoloSaldoAFavor bool    `json:"soloSaldoAFavor,omitempty"`
	Motivo          *string `json:"motivo"`
}

func motivo(s string) *string { return &s }

// CreditoDeLaSesion es creditoDisponible (lib/dal/cuenta.ts) para quien
// compra: lo usan Mi cuenta y la compra a cuenta corriente del carrito
// (tanda 6).
func CreditoDeLaSesion(ctx context.Context, pool *pgxpool.Pool, ses *auth.Sesion, monto float64) (MiCredito, error) {
	sinCuenta := MiCredito{Motivo: motivo("Necesitás iniciar sesión con tu cuenta.")}
	if ses == nil {
		return sinCuenta, nil
	}
	var id, estado string
	var limite float64
	err := pool.QueryRow(ctx, `SELECT id, limite_credito::float8, estado::text FROM customers WHERE user_id = $1 AND active LIMIT 1`,
		ses.UserID).Scan(&id, &limite, &estado)
	if errors.Is(err, pgx.ErrNoRows) {
		return sinCuenta, nil
	}
	if err != nil {
		return MiCredito{}, err
	}
	saldo, err := sqlc.New(pool).SaldoDeCliente(ctx, id)
	if err != nil {
		return MiCredito{}, err
	}
	if limite <= 0 {
		aFavor := math.Max(-saldo, 0)
		if aFavor > 0 && estado != "moroso" {
			alcanza := monto <= aFavor+0.005
			v := MiCredito{Habilitado: alcanza, Saldo: saldo, Disponible: aFavor, SoloSaldoAFavor: true}
			if !alcanza {
				v.Motivo = motivo("Tu saldo a favor no alcanza para esta compra.")
			}
			return v, nil
		}
		return MiCredito{Motivo: motivo("Tu cuenta no tiene cuenta corriente habilitada.")}, nil
	}
	v := MiCredito{Saldo: saldo, LimiteCredito: limite, Disponible: math.Max(limite-saldo, 0)}
	switch {
	case estado == "moroso":
		v.Motivo = motivo("Tu cuenta está con pagos pendientes. Escribinos y lo vemos.")
	case monto > 0 && saldo+monto > limite:
		v.Motivo = motivo("Esta compra supera tu límite de crédito. Tenés " + formato.Numero(v.Disponible) + " disponibles.")
	default:
		v.Habilitado = true
	}
	return v, nil
}

package cobros

import (
	"context"
	"errors"
	"math"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/formato"
	"mjbj/internal/sqlc"
)

// EstadoDeCredito es si un cliente puede comprar a cuenta, y por qué no
// (lib/dal/credito.ts).
type EstadoDeCredito struct {
	Puede            bool    `json:"puede"`
	Saldo            float64 `json:"saldo"`
	LimiteCredito    float64 `json:"limiteCredito"`
	Disponible       float64 `json:"disponible"`
	DiasDeLaMasVieja *int    `json:"diasDeLaMasVieja"`
	Motivo           *string `json:"motivo"`
	Autorizable      bool    `json:"autorizable"`
	SoloSaldoAFavor  bool    `json:"soloSaldoAFavor,omitempty"`
}

// DiasParaVencer es el plazo si la ficha no tiene uno propio.
const DiasParaVencer = 30

func texto(s string) *string { return &s }

// Credito es estadoDeCredito: con límite cero solo puede usar lo que tenga a
// favor; si no, frena la cuenta bloqueada, la morosa, la deuda más vieja que
// el plazo y pasarse del límite.
func Credito(ctx context.Context, q *sqlc.Queries, cliente string, monto float64, ahora time.Time) (EstadoDeCredito, error) {
	c, err := q.ClienteParaCredito(ctx, cliente)
	if errors.Is(err, pgx.ErrNoRows) {
		return EstadoDeCredito{Motivo: texto("No se encontró la ficha del cliente.")}, nil
	}
	if err != nil {
		return EstadoDeCredito{}, err
	}
	filas, err := q.MovimientosParaAging(ctx, cliente)
	if err != nil {
		return EstadoDeCredito{}, err
	}
	movs := make([]Movimiento, len(filas))
	saldo := 0.0
	for i, f := range filas {
		movs[i] = Movimiento{f.Monto, f.CreatedAt}
		saldo += f.Monto
	}
	if c.LimiteCredito <= 0 {
		aFavor := math.Max(-saldo, 0)
		if aFavor > 0 && !c.CuentaBloqueada {
			alcanza := monto <= aFavor+0.005
			e := EstadoDeCredito{Saldo: saldo, Disponible: aFavor, SoloSaldoAFavor: true, Puede: alcanza}
			if !alcanza {
				e.Motivo = texto("Tiene " + formato.Moneda(aFavor) + " a favor y no alcanza: el resto, con otro medio.")
			}
			return e, nil
		}
		return EstadoDeCredito{Saldo: saldo, Motivo: texto("Este cliente no tiene cuenta corriente habilitada.")}, nil
	}
	dias := CalcularAging(movs, ahora).DiasDeLaMasVieja
	e := EstadoDeCredito{Saldo: saldo, LimiteCredito: c.LimiteCredito, Disponible: math.Max(c.LimiteCredito-saldo, 0),
		DiasDeLaMasVieja: dias, Autorizable: true}
	if c.CuentaBloqueada {
		e.Autorizable = false
		e.Motivo = texto("La cuenta corriente está bloqueada.")
		if c.MotivoBloqueo != nil && *c.MotivoBloqueo != "" {
			e.Motivo = texto("Cuenta corriente bloqueada: " + *c.MotivoBloqueo)
		}
		return e, nil
	}
	if c.Estado == "moroso" {
		e.Motivo = texto("La cuenta está marcada como morosa.")
		return e, nil
	}
	plazo := int(c.DiasCredito)
	if plazo == 0 {
		plazo = DiasParaVencer
	}
	if dias != nil && *dias > plazo {
		e.Motivo = texto("Tiene deuda de hace " + strconv.Itoa(*dias) + " días, más de los " + strconv.Itoa(plazo) + " de plazo.")
		return e, nil
	}
	if monto > 0 && saldo+monto > c.LimiteCredito {
		e.Motivo = texto("Supera el límite de crédito. Disponible: $" + formato.Numero(e.Disponible) + ".")
		return e, nil
	}
	e.Puede = true
	return e, nil
}

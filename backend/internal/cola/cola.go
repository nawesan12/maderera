// Package cola es la cola de trabajos en Postgres (tabla `trabajos`): lo que
// llega por un webhook o hay que reintentar se encola, y el worker lo hace
// después, con reintentos y espera creciente. Era lib/cola del TS, con la
// misma tabla y la misma semántica; desde que los avisos se mudaron, la cola
// es solo de Go.
//
// Este proceso toma únicamente los tipos que tiene registrados: un trabajo
// de un tipo que nadie atiende queda pendiente (no se pierde).
package cola

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"mjbj/internal/sqlc"
)

// Manejador hace un trabajo. Tiene que poder correr dos veces con la misma
// carga sin hacer daño: si el proceso se muere después de hacerlo y antes de
// marcarlo hecho, otro lo vuelve a tomar.
type Manejador func(ctx context.Context, carga json.RawMessage) error

// Los tiempos de lib/cola/espera.ts.
const (
	esperaInicial = 30 * time.Second
	esperaMaxima  = time.Hour
)

// EsperaParaElIntento es esperaParaElIntento del TS: 30 s, y se duplica hasta
// plantarse en una hora.
func EsperaParaElIntento(intentos int32) time.Duration {
	exp := max(0, intentos-1)
	if exp > 20 {
		return esperaMaxima
	}
	return min(esperaInicial*time.Duration(1<<exp), esperaMaxima)
}

// Cola encola y procesa.
type Cola struct {
	q           *sqlc.Queries
	log         *slog.Logger
	manejadores map[string]Manejador
	// AlFallar se llama cuando un trabajo agota los intentos (avisa al panel).
	AlFallar func(ctx context.Context, tipo, mensaje string)
}

// Nueva arma la cola.
func Nueva(q *sqlc.Queries, log *slog.Logger) *Cola {
	return &Cola{q: q, log: log, manejadores: map[string]Manejador{}}
}

// Registrar dice que este proceso sabe hacer los trabajos de `tipo`.
func (c *Cola) Registrar(tipo string, m Manejador) { c.manejadores[tipo] = m }

func (c *Cola) tipos() []string {
	t := make([]string, 0, len(c.manejadores))
	for k := range c.manejadores {
		t = append(t, k)
	}
	sort.Strings(t)
	return t
}

// Encolar deja un trabajo para después (o para `en`, si no es cero). Se le
// puede pasar una transacción (q.WithTx): así el trabajo existe solo si lo
// que lo originó se confirmó.
func Encolar(ctx context.Context, q *sqlc.Queries, tipo string, carga any, en time.Time) (string, error) {
	crudo, err := json.Marshal(carga)
	if err != nil {
		return "", err
	}
	cuando := pgtype.Timestamptz{Time: en, Valid: !en.IsZero()}
	return q.Encolar(ctx, sqlc.EncolarParams{Tipo: tipo, Carga: crudo, En: cuando})
}

// Resultado es lo que hizo una pasada.
type Resultado struct {
	Hechos, Reintentos, Fallidos int
}

// Procesar toma y hace hasta `limite` trabajos.
// PlazoPorTrabajo es cuánto puede tardar un trabajo: menos que la toma de
// 5 minutos, así nadie lo retoma mientras todavía corre.
const PlazoPorTrabajo = 4 * time.Minute

func (c *Cola) Procesar(ctx context.Context, limite int) (Resultado, error) {
	var r Resultado
	tipos := c.tipos()
	if len(tipos) == 0 {
		return r, nil
	}
	for i := 0; i < limite; i++ {
		t, err := c.q.TomarTrabajo(ctx, tipos)
		if errors.Is(err, pgx.ErrNoRows) {
			break
		}
		if err != nil {
			return r, fmt.Errorf("tomando un trabajo: %w", err)
		}
		// Cada trabajo con su propio plazo, más corto que la toma (5 min):
		// antes uno solo cubría los 100 de la pasada y los últimos fallaban
		// por un plazo que no era suyo. Cerrarlo va con otro contexto, para
		// que un trabajo vencido igual se anote.
		hecho, cortar := context.WithTimeout(ctx, PlazoPorTrabajo)
		err = c.hacer(hecho, t)
		cortar()
		anotar, listo := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		if err == nil {
			n, err := c.q.TrabajoHecho(anotar, sqlc.TrabajoHechoParams{ID: t.ID, Toma: t.Toma})
			listo()
			if err != nil {
				return r, err
			}
			if n == 0 {
				c.log.Warn("trabajo_retomado", "tipo", t.Tipo, "id", t.ID)
			}
			r.Hechos++
			continue
		}
		mensaje := err.Error()
		if len(mensaje) > 2000 {
			mensaje = mensaje[:2000]
		}
		agotado := t.Intentos >= t.MaxIntentos
		estado := sqlc.EstadoTrabajoPendiente
		if agotado {
			estado = sqlc.EstadoTrabajoFallido
		}
		err = c.q.TrabajoFallo(anotar, sqlc.TrabajoFalloParams{
			ID: t.ID, Toma: t.Toma, Estado: estado, Error: &mensaje, EsperaSegundos: EsperaParaElIntento(t.Intentos).Seconds(),
		})
		listo()
		if err != nil {
			return r, err
		}
		evento := "trabajo_reintento"
		if agotado {
			evento = "trabajo_fallido"
			r.Fallidos++
			if c.AlFallar != nil {
				c.AlFallar(ctx, t.Tipo, mensaje)
			}
		} else {
			r.Reintentos++
		}
		c.log.Error(evento, "tipo", t.Tipo, "id", t.ID, "intentos", t.Intentos, "detalle", mensaje)
	}
	return r, nil
}

func (c *Cola) hacer(ctx context.Context, t sqlc.TomarTrabajoRow) (err error) {
	m, ok := c.manejadores[t.Tipo]
	if !ok {
		return fmt.Errorf("no hay manejador para «%s»", t.Tipo)
	}
	defer func() {
		if v := recover(); v != nil {
			err = fmt.Errorf("pánico: %v", v)
		}
	}()
	return m(ctx, t.Carga)
}

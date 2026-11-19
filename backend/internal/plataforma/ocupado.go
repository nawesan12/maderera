package plataforma

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Lo que pasa cuando dos operaciones se cruzan sobre lo mismo, con los topes
// del pool principal (cmd/mjbj: topesDeLaAPI).
//
// Con lock_timeout, la segunda ya no espera para siempre al candado de la
// primera: a los 10 s Postgres la corta con 55P03. Eso vale también para
// los pg_advisory_xact_lock —la numeración, la serie de remitos, el
// «cuenta:» del límite de crédito, la clave de la venta—, así que una tanda
// de la migración de ISIS que retiene la cuenta de un cliente, o una
// anulación grande, hacía fallar el cobro que esperaba detrás. Antes de los
// topes esperaba y salía; con ellos salía como «Algo falló de nuestro lado».

// Códigos de Postgres de una operación que chocó con otra, y de una consulta
// que pasó su tope.
const (
	codigoCandadoOcupado = "55P03" // lock_not_available: venció lock_timeout
	codigoAbrazoMortal   = "40P01" // deadlock_detected: Postgres eligió esta
	codigoSentenciaLarga = "57014" // query_canceled: venció statement_timeout
)

// Ocupado dice si el error es de un candado que no se consiguió a tiempo (o
// de un abrazo mortal): la operación no hizo nada y probarla de nuevo en un
// rato es lo correcto.
func Ocupado(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && (pg.Code == codigoCandadoOcupado || pg.Code == codigoAbrazoMortal)
}

func sentenciaLarga(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == codigoSentenciaLarga
}

// Esperas entre intentos de EnTransaccion. Cortas a propósito: lo normal es
// que el candado se libere apenas termine la otra transacción, y cada
// intento ya esperó hasta el lock_timeout.
var esperasDeReintento = []time.Duration{200 * time.Millisecond, 600 * time.Millisecond}

// Iniciador es lo que abre una transacción: un pool o una conexión.
type Iniciador interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// EnTransaccion es pgx.BeginFunc, pero si la transacción se cae porque otra
// tenía el candado (Ocupado), la vuelve a correr entera, hasta dos veces
// más. Es seguro porque una transacción que falló no dejó nada: se vuelve
// atrás completa, numeración incluida (los números salen de filas con
// candado, no de secuencias).
//
// `f` puede correr más de una vez: no tiene que hacer nada afuera de la base
// (mandar un correo, llamar a ARCA) ni acumular en variables de afuera sin
// reiniciarlas.
func EnTransaccion(ctx context.Context, base Iniciador, f func(pgx.Tx) error) error {
	for intento := 0; ; intento++ {
		err := pgx.BeginFunc(ctx, base, f)
		if !Ocupado(err) || intento >= len(esperasDeReintento) {
			return err
		}
		select {
		case <-ctx.Done():
			return err
		case <-time.After(esperasDeReintento[intento]):
		}
	}
}

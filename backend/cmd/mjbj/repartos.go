package main

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cobros"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
)

// mjbj repartos: fija el reparto entre los circuitos de los recibos que se
// emitieron antes de que existiera (migración 00131), con los hechos a la
// fecha de cada uno. Va una vez, antes de cargar el certificado y de mandarle
// el primer cierre al estudio; repetirlo no cambia nada (solo toca los nulos).
func correrRepartos() error {
	base, err := plataforma.Cargar[plataforma.ConfigBase]()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := base.Pool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	var fijados []string
	if err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// El candado de los recibos: mientras se fija nadie emite uno.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, numeracion.SerieRecibos); err != nil {
			return err
		}
		var err error
		fijados, err = cobros.FijarRepartosDeAntes(ctx, tx)
		return err
	}); err != nil {
		return err
	}
	fmt.Printf("Listo: %d recibos con el reparto fijado.\n", len(fijados))
	return nil
}

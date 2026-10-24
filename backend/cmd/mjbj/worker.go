package main

import (
	"context"
	"os/signal"
	"syscall"
	"time"

	"mjbj/internal/cola"
	"mjbj/internal/plataforma"
	"mjbj/internal/revalidar"
	"mjbj/internal/sqlc"
	"mjbj/internal/tareas"
)

type configWorker struct {
	Base      plataforma.ConfigBase
	Revalidar revalidar.Config
}

// El worker: la cola (los tipos que ya son de Go) y las tareas periódicas
// que ya se mudaron. Reemplaza de a poco al contenedor `cron`, que le pega a
// /api/tareas de Next.
func correrWorker() error {
	log := plataforma.Registro("worker")
	cfg, err := plataforma.Cargar[configWorker]()
	if err != nil {
		return err
	}
	ctx, parar := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer parar()
	pool, err := cfg.Base.Pool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	q := sqlc.New(pool)

	c := cola.Nueva(q, log)
	c.Registrar(revalidar.Tipo, revalidar.Manejador(cfg.Revalidar))

	// Las tareas que ya son de Go. Cada tanda suma las suyas.
	var lista []tareas.Tarea

	log.Info("worker andando")
	reloj := time.NewTicker(2 * time.Second)
	defer reloj.Stop()
	ultimaRevision := time.Time{}
	for {
		select {
		case <-ctx.Done():
			log.Info("apagando")
			return nil
		case <-reloj.C:
		}
		// Lo que está a mitad de hacerse termina aunque llegue el SIGTERM:
		// el contexto de la pasada no es el de la señal.
		pasada, cancelar := context.WithTimeout(context.Background(), 5*time.Minute)
		if r, err := c.Procesar(pasada, 100); err != nil {
			log.Error("cola", "error", err)
		} else if r.Hechos+r.Reintentos+r.Fallidos > 0 {
			log.Info("cola", "hechos", r.Hechos, "reintentos", r.Reintentos, "fallidos", r.Fallidos)
		}
		if time.Since(ultimaRevision) >= time.Minute {
			ultimaRevision = time.Now()
			for _, t := range lista {
				_, _ = tareas.Correr(pasada, q, log, t, time.Now())
			}
		}
		cancelar()
	}
}

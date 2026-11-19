package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/fotos"
	"mjbj/internal/plataforma"
	"mjbj/internal/revalidar"
	"mjbj/internal/sqlc"
	"mjbj/internal/subidas"
)

type configFotos struct {
	Base    plataforma.ConfigBase
	Subidas subidas.Config
	Fotos   fotos.Config
}

// mjbj fotos: la biblioteca de fotos de producto por código (docs/fotos.md).
//
//	fotos cargar <carpeta>       revisa los WebP y los copia a la biblioteca
//	fotos adjuntar [--probar]    engancha las fotos a lo que ya está cargado
func correrFotos(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("uso: mjbj fotos cargar <carpeta> | mjbj fotos adjuntar [--probar]")
	}
	cfg, err := plataforma.Cargar[configFotos]()
	if err != nil {
		return err
	}
	log := plataforma.Registro("fotos")
	b := fotos.Nueva(cfg.Fotos, subidas.Nuevo(cfg.Subidas), log)
	switch args[0] {
	case "cargar":
		if len(args) != 2 {
			return fmt.Errorf("uso: mjbj fotos cargar <carpeta>")
		}
		c, err := b.Cargar(args[1])
		for _, a := range c.Copiados {
			fmt.Println("copiada:", a)
		}
		for a, motivo := range c.Rechazado {
			fmt.Printf("RECHAZADA %s: %s\n", a, motivo)
		}
		for _, a := range c.Faltan {
			fmt.Println("falta (está en la lista y no en la carpeta):", a)
		}
		for _, a := range c.Sobran {
			fmt.Println("sobra (no está en la lista, no se copió):", a)
		}
		fmt.Printf("Listo: %d copiadas en %s.\n", len(c.Copiados), cfg.Fotos.Carpeta)
		return err
	case "adjuntar":
		probar := len(args) > 1 && args[1] == "--probar"
		ctx := context.Background()
		pool, err := cfg.Base.Pool(ctx)
		if err != nil {
			return err
		}
		defer pool.Close()
		n, err := adjuntarEnLote(ctx, pool, b, log, probar)
		if probar {
			fmt.Printf("Con --probar no se tocó nada: %d productos recibirían foto.\n", n)
		} else {
			fmt.Printf("Listo: %d fotos puestas.\n", n)
		}
		return err
	}
	return fmt.Errorf("no conozco «fotos %s»", strings.Join(args, " "))
}

// adjuntarEnLote engancha las fotos a los productos sin ninguna foto. Con
// probar solo lista. Si puso alguna, avisa a Next (como la 00180: sin cambios,
// sin aviso).
func adjuntarEnLote(ctx context.Context, pool *pgxpool.Pool, b *fotos.Biblioteca, log *slog.Logger, probar bool) (int, error) {
	pendientes, err := fotos.SinFoto(ctx, pool)
	if err != nil {
		return 0, err
	}
	vistos := map[string]bool{}
	n := 0
	for _, p := range pendientes {
		if probar {
			if !vistos[p.ProductoID] {
				fmt.Fprintf(os.Stdout, "%s  (código %s)\n", p.Nombre, p.Codigo)
				n++
			}
			vistos[p.ProductoID] = true
			continue
		}
		n += b.Adjuntar(ctx, pool, fotos.Medida{ProductoID: p.ProductoID, Codigo: p.Codigo})
	}
	if !probar && n > 0 {
		if err := revalidar.Encolar(ctx, sqlc.New(pool), revalidar.Aviso{
			Etiquetas: []string{"catalogo"}, Rutas: []string{"/catalogo", "/"},
		}); err != nil {
			log.Warn("no se pudo avisar a Next", "error", err)
		}
	}
	return n, nil
}

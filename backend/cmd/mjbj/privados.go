package main

import (
	"context"
	"fmt"

	"mjbj/internal/plataforma"
	"mjbj/internal/subidas"
)

type configPrivados struct {
	Base    plataforma.ConfigBase
	Subidas subidas.Config
}

// mjbj privados: los comprobantes de transferencia y los documentos técnicos
// que se subieron cuando iban a /subidas/ (Caddy los servía a cualquiera
// con el enlace) pasan a CARPETA_PRIVADA. Se corre una vez después de
// desplegar, con las mismas carpetas que la API; repetirlo no hace nada.
func correrPrivados() error {
	cfg, err := plataforma.Cargar[configPrivados]()
	if err != nil {
		return err
	}
	ctx := context.Background()
	pool, err := cfg.Base.Pool(ctx)
	if err != nil {
		return err
	}
	defer pool.Close()
	m, err := subidas.Nuevo(cfg.Subidas).MudarAPrivado(ctx, pool)
	fmt.Printf("movidos a la carpeta privada: %d\n", m.Movidos)
	for _, f := range m.Fallas {
		fmt.Println("no se pudo:", f)
	}
	return err
}

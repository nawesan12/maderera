// mjbj es el único binario del backend. El primer argumento dice qué parte
// corre: así hay una sola imagen de Docker y cada servicio del compose elige
// su papel.
package main

import (
	"fmt"
	"os"
	"time"

	"mjbj/internal/correo"
	"mjbj/internal/plataforma"
	webcorreo "mjbj/web/correo"
)

func main() {
	if len(os.Args) < 2 {
		uso()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "correo":
		err = correrCorreo()
	default:
		uso()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "mjbj:", err)
		os.Exit(1)
	}
}

func uso() {
	fmt.Fprintln(os.Stderr, `Uso: mjbj <servicio>

  correo   el webmail (correo.<dominio>)`)
}

func correrCorreo() error {
	log := plataforma.Registro("correo")
	cfg, err := plataforma.Cargar[correo.Config]()
	if err != nil {
		return err
	}
	app, err := correo.Nueva(cfg, webcorreo.Archivos(), log)
	if err != nil {
		return err
	}
	go func() {
		for range time.Tick(10 * time.Minute) {
			app.Barrer()
		}
	}()
	return plataforma.Servir(cfg.Escuchar, app.Rutas(), log)
}

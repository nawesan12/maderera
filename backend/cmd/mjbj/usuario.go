package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// mjbj usuario staff|cliente: las altas a mano, con los mismos parámetros que
// tenían `npm run staff:create` y `cliente:create`.
func correrUsuario(args []string) error {
	if len(args) == 0 || (args[0] != "staff" && args[0] != "cliente") {
		return errors.New(`uso:
  mjbj usuario staff   --email mail@mjbj.com.ar --password Secreto123 --name "Nombre" --role admin
  mjbj usuario cliente --email cliente@ejemplo.com --password Secreto123 --name "Nombre"`)
	}
	tipo := args[0]
	fs := flag.NewFlagSet("usuario "+tipo, flag.ContinueOnError)
	email := fs.String("email", "", "correo")
	clave := fs.String("password", "", "clave (8 caracteres o más)")
	nombre := fs.String("name", "", "nombre")
	rol := fs.String("role", "admin", "rol del panel: "+fmt.Sprint(sqlc.AllStaffRoleValues()))
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if *email == "" || *clave == "" {
		return errors.New("faltan --email y --password")
	}
	if len([]rune(*clave)) < 8 {
		return errors.New("la clave necesita 8 caracteres o más")
	}
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
	// Para crear cuentas no hacen falta el secreto ni la URL de la sesión.
	s := auth.Nuevo(auth.Config{}, pool)
	n := *nombre
	if n == "" && tipo == "staff" {
		n = strings.SplitN(*email, "@", 2)[0]
	}
	if tipo == "staff" {
		hecho, err := s.AltaDeStaff(ctx, *email, *clave, n, sqlc.StaffRole(*rol))
		if err != nil {
			return err
		}
		fmt.Printf("Listo: %s habilitado como staff/%s (%s).\n", *email, *rol, hecho)
		return nil
	}
	pasos, err := s.AltaDeCliente(ctx, *email, *clave, n)
	if err != nil {
		return err
	}
	fmt.Println(strings.Join(pasos, "\n"))
	fmt.Fprintf(os.Stdout, "\nListo. Entrá en /ingresar con:\n  correo:     %s\n  contraseña: %s\n", *email, *clave)
	return nil
}

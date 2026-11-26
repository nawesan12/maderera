package autorizacion

import (
	"context"
	"testing"

	"mjbj/internal/reglas"
)

// Sin ningún PIN cargado la venta no queda trabada: firma la contraseña del
// panel de un admin, y el campo lo dice antes de que se teclee nada (mes
// simulado, H016 y H028). Cargado un PIN, la contraseña deja de servir.
func TestSinPINFirmaLaClave(t *testing.T) {
	e := armar(t)
	ctx := context.Background()

	// De entrada, sin teclear nada, ya se sabe que firma la contraseña.
	_, err := e.svc.Exigir(ctx, e.vendedor, e.pedido(""))
	if f := falta(t, err); !f.SinAdmins || !f.ConClave || f.PinIncorrecto || f.Mensaje() != "Hace falta la contraseña de un administrador." {
		t.Fatalf("de entrada: %+v %q", f, f.Mensaje())
	}
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("otra clave"))
	if f := falta(t, err); !f.PinIncorrecto || f.Mensaje() != "Contraseña incorrecta." {
		t.Fatalf("clave mala: %+v", f)
	}
	f, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("una clave larga"))
	if err != nil || f.UserID != e.adminID || f.Ficha == "" {
		t.Fatalf("clave buena: %+v %v", f, err)
	}
	if len(e.firmas) != 1 || e.firmas[0] != "Juan usó la contraseña de Marta: $ 12.300 abajo del precio." {
		t.Fatalf("aviso: %q", e.firmas)
	}
	// La ficha de la contraseña sirve para reenviar.
	p := e.pedido("")
	p.Ficha = f.Ficha
	if g, err := e.svc.Exigir(ctx, e.vendedor, p); err != nil || g.UserID != e.adminID {
		t.Fatalf("ficha: %+v %v", g, err)
	}

	// Con un PIN cargado, la contraseña ya no firma.
	if err := e.ses.CargarPIN(ctx, e.admin, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("una clave larga"))
	if f := falta(t, err); !f.PinIncorrecto || f.ConClave {
		t.Fatalf("con PIN, la clave: %+v", f)
	}

	// Sin admins con clave ni PIN, sí queda trabado.
	if _, err := e.pool.Exec(ctx, `update "user" set pin_autorizacion = null`); err != nil {
		t.Fatal(err)
	}
	if _, err := e.pool.Exec(ctx, `delete from account`); err != nil {
		t.Fatal(err)
	}
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido(""))
	if f := falta(t, err); !f.SinAdmins || f.ConClave {
		t.Fatalf("sin nadie: %+v", f)
	}
}

// Con la regla firma_sin_pin en «solo_pin», sin PIN cargado la contraseña no
// firma: el campo dice de entrada que falta cargar un PIN y una contraseña
// correcta tampoco pasa.
func TestSinPINSoloPIN(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	if err := reglas.Fijar(ctx, e.pool, reglas.FirmaSinPIN, "solo_pin"); err != nil {
		t.Fatal(err)
	}
	_, err := e.svc.Exigir(ctx, e.vendedor, e.pedido(""))
	if f := falta(t, err); !f.SinAdmins || f.ConClave || f.Mensaje() != "Ningún administrador cargó su PIN: se carga desde su menú del panel." {
		t.Fatalf("de entrada: %+v %q", f, f.Mensaje())
	}
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("una clave larga"))
	if f := falta(t, err); !f.SinAdmins || f.ConClave || f.PinIncorrecto {
		t.Fatalf("la clave firmó: %+v", f)
	}
	// Cargado el PIN, firma como siempre.
	if err := e.ses.CargarPIN(ctx, e.admin, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	if f, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("482915")); err != nil || f.UserID != e.adminID {
		t.Fatalf("con PIN: %+v %v", f, err)
	}
}

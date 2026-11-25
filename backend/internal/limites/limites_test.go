package limites

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Los casos de tests/limites.test.ts, uno por uno.
func TestVentanaComoElTS(t *testing.T) {
	lim := Limite{Maximo: 5, Ventana: time.Minute}
	at := func(s string) time.Time { v, _ := time.Parse(time.RFC3339, s); return v }

	a := inicioDeVentana(at("2026-03-14T10:05:03Z"), time.Minute)
	b := inicioDeVentana(at("2026-03-14T10:05:59Z"), time.Minute)
	if !a.Equal(b) {
		t.Error("el mismo minuto tiene que caer en la misma ventana")
	}
	if c := inicioDeVentana(at("2026-03-14T10:06:00Z"), time.Minute); !c.After(b) {
		t.Error("al pasar el minuto empieza otra ventana")
	}

	ahora := at("2026-03-14T10:05:30Z")
	inicio := inicioDeVentana(ahora, time.Minute)
	for cuenta := int32(1); cuenta <= 5; cuenta++ {
		if !evaluar(cuenta, lim, ahora, inicio).Permitido {
			t.Errorf("la cuenta %d tenía que pasar", cuenta)
		}
	}
	if v := evaluar(6, lim, ahora, inicio); v.Permitido || v.Quedan != 0 || v.EsperaSegundos != 30 {
		t.Errorf("el sexto: %+v", v)
	}
	if v := evaluar(1, lim, ahora, inicio); v.EsperaSegundos != 0 || v.Quedan != 4 {
		t.Errorf("el primero: %+v", v)
	}
	if evaluar(5, lim, ahora, inicio).Quedan != 0 {
		t.Error("al quinto no queda ninguno")
	}

	for s, want := range map[int64]string{94: "2 minutos", 5: "unos segundos", 45: "unos segundos", 60: "un minuto", 3600: "una hora", 7200: "2 horas"} {
		if got := CuantoFalta(s); got != want {
			t.Errorf("CuantoFalta(%d) = %q, el TS dice %q", s, got, want)
		}
	}
}

func TestContraLaBase(t *testing.T) {
	pool := pruebas.Base(t)
	l := Nuevo(sqlc.New(pool), slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	for i := 1; i <= 10; i++ {
		if v := l.PorAmbos(ctx, Ingresar, "1.2.3.4", "correo", "Ana@X.com"); !v.Permitido {
			t.Fatalf("frenó en el intento %d", i)
		}
	}
	v := l.PorAmbos(ctx, Ingresar, "1.2.3.4", "correo", "ana@x.com")
	if v.Permitido || v.EsperaSegundos <= 0 {
		t.Fatalf("el undécimo pasó: %+v", v)
	}
	// Otra IP contra el mismo correo: también frenado (cuenta por correo).
	if l.PorAmbos(ctx, Ingresar, "5.6.7.8", "correo", "ana@x.com").Permitido {
		t.Error("otra IP pasó contra un correo frenado")
	}
	// La clave en la tabla es la misma que escribe el TS.
	var n int
	_ = pool.QueryRow(ctx, `select count(*) from rate_limits where clave in ('ingresar:ip:1.2.3.4', 'ingresar:correo:ana@x.com')`).Scan(&n)
	if n != 2 {
		t.Errorf("claves en la tabla: %d filas, tenían que ser 2", n)
	}
	l.Soltar(ctx, Ingresar, "correo:ana@x.com")
	if !l.Permitido(ctx, Ingresar, "correo:ana@x.com").Permitido {
		t.Error("Soltar no soltó")
	}
}

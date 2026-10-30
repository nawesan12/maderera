// Package limites cuenta intentos por ventana fija, en Postgres: cuántas
// veces se probó entrar, registrarse, pedir un presupuesto. Es lib/limites
// del TypeScript con las mismas acciones, claves y ventanas, contra la misma
// tabla (rate_limits): mientras Next y Go convivan, cuentan juntos.
//
// **Si la base falla, deja pasar.** Un limitador caído no puede tirar abajo
// el login de toda la tienda; se registra y se sigue.
package limites

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"mjbj/internal/sqlc"
)

// Limite es cuántos intentos entran en cada ventana.
type Limite struct {
	Maximo  int32
	Ventana time.Duration
}

// Accion es lo que se limita. Los nombres son los de LIMITES en el TS: van
// adentro de la clave de la tabla.
type Accion string

const (
	Ingresar       Accion = "ingresar"
	Registrarse    Accion = "registrarse"
	Comprar        Accion = "comprar"
	Corte          Accion = "corte"
	Presupuesto    Accion = "presupuesto"
	Contacto       Accion = "contacto"
	Evento         Accion = "evento"
	Profesional    Accion = "profesional"
	ListaDePrecios Accion = "listaDePrecios"
	Comprobante    Accion = "comprobante"
	Diagnostico    Accion = "diagnostico"
	// Carrito son los carritos anónimos nuevos por IP: solo de Go (el TS no
	// lo tenía). Sin cookie, cada «agregar» crea uno, y un bot que no guarda
	// cookies llenaba la tabla.
	Carrito Accion = "carrito"
)

// Los valores de LIMITES en lib/limites/index.ts.
var limites = map[Accion]Limite{
	Ingresar:       {10, 5 * time.Minute},
	Registrarse:    {5, time.Hour},
	Comprar:        {10, time.Hour},
	Corte:          {30, 10 * time.Minute},
	Presupuesto:    {10, time.Hour},
	Contacto:       {3, time.Hour},
	Evento:         {5, time.Hour},
	Profesional:    {3, 24 * time.Hour},
	ListaDePrecios: {10, time.Hour},
	Comprobante:    {10, time.Hour},
	Diagnostico:    {20, time.Hour},
	Carrito:        {60, time.Hour},
}

// Veredicto es si pasa, cuántos le quedan y cuánto esperar si no.
type Veredicto struct {
	Permitido      bool
	Quedan         int32
	EsperaSegundos int64
}

// Limitador cuenta contra la base.
type Limitador struct {
	q     *sqlc.Queries
	log   *slog.Logger
	ahora func() time.Time
}

// Nuevo arma el limitador.
func Nuevo(q *sqlc.Queries, log *slog.Logger) *Limitador {
	return &Limitador{q: q, log: log, ahora: time.Now}
}

// inicioDeVentana corta el tiempo en ventanas fijas desde la época, como
// inicioDeVentana del TS: así Next y Go caen en la misma fila.
func inicioDeVentana(t time.Time, v time.Duration) time.Time {
	ms := v.Milliseconds()
	return time.UnixMilli(t.UnixMilli() / ms * ms).UTC()
}

func evaluar(cuenta int32, l Limite, ahora, inicio time.Time) Veredicto {
	permitido := cuenta <= l.Maximo
	fin := inicio.Add(l.Ventana)
	faltan := int64(math.Max(0, math.Ceil(float64(fin.Sub(ahora).Milliseconds())/1000)))
	v := Veredicto{Permitido: permitido, Quedan: max(0, l.Maximo-cuenta)}
	if !permitido {
		v.EsperaSegundos = faltan
	}
	return v
}

// Permitido cuenta un intento de `accion` para `sujeto` («ip:1.2.3.4»,
// «correo:ana@…»).
func (l *Limitador) Permitido(ctx context.Context, accion Accion, sujeto string) Veredicto {
	lim := limites[accion]
	ahora := l.ahora()
	ventana := inicioDeVentana(ahora, lim.Ventana)
	cuenta, err := l.q.ContarIntento(ctx, sqlc.ContarIntentoParams{Clave: string(accion) + ":" + sujeto, Ventana: ventana})
	if err != nil {
		l.log.Error("no se pudo contar el límite", "accion", accion, "error", err)
		return Veredicto{Permitido: true, Quedan: lim.Maximo}
	}
	return evaluar(cuenta, lim, ahora, ventana)
}

// PorAmbos cuenta por IP y por un segundo dato (el correo): solo por IP deja
// pasar al que prueba una clave contra mil cuentas desde mil lugares; solo
// por correo, al que prueba mil claves contra una cuenta rotando de IP.
func (l *Limitador) PorAmbos(ctx context.Context, accion Accion, ip, nombre, valor string) Veredicto {
	porIP := l.Permitido(ctx, accion, "ip:"+ip)
	porOtro := l.Permitido(ctx, accion, nombre+":"+strings.ToLower(valor))
	if !porIP.Permitido {
		return porIP
	}
	return porOtro
}

// Soltar borra la cuenta de la ventana actual (después de entrar bien).
func (l *Limitador) Soltar(ctx context.Context, accion Accion, sujeto string) {
	ventana := inicioDeVentana(l.ahora(), limites[accion].Ventana)
	_ = l.q.SoltarIntentos(ctx, sqlc.SoltarIntentosParams{Clave: string(accion) + ":" + sujeto, Ventana: ventana})
}

// LimpiarViejas borra las ventanas de hace más de un día (tarea diaria).
func (l *Limitador) LimpiarViejas(ctx context.Context) (int64, error) {
	return l.q.BorrarVentanasViejas(ctx, l.ahora().Add(-24*time.Hour))
}

// CuantoFalta es cuantoFalta del TS: «unos segundos», «un minuto», «3 minutos».
func CuantoFalta(segundos int64) string {
	if segundos <= 45 {
		return "unos segundos"
	}
	if segundos <= 90 {
		return "un minuto"
	}
	minutos := (segundos + 59) / 60
	if minutos < 60 {
		return fmt.Sprintf("%d minutos", minutos)
	}
	horas := (minutos + 59) / 60
	if horas == 1 {
		return "una hora"
	}
	return fmt.Sprintf("%d horas", horas)
}

// AvisoDeEspera es el mensaje para la pantalla.
func AvisoDeEspera(v Veredicto) string {
	return "Probaste varias veces seguidas. Esperá " + CuantoFalta(v.EsperaSegundos) + " y volvé a intentar."
}

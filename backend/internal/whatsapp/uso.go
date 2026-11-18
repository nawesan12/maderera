package whatsapp

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/push"
)

// Cuántos mensajes salieron en el mes (18/11/2026, Nahuel: «minimizar la
// cantidad de mensajes, así no nos pasamos de los 1000 por mes»). Es la otra
// cara del gasto en dólares (gasto.go): Meta cobra por mensaje, y un número
// redondo se entiende mejor que una tarifa por categoría. Cuentan el bot y
// las personas desde la bandeja; lo que sale de la app del teléfono es
// gratis y no cuenta, ni lo que falló.

// TopeMensajesPorOmision es el tope si nadie lo cambió.
const TopeMensajesPorOmision = 1000

// AhorroDesde es la proporción del tope en que el bot pasa a modo ahorro:
// sin saludos, sin el «no lo encontré» de la primera vez (deriva directo) y
// sin el aviso de cerrado.
const AhorroDesde = 0.8

// UsoDelMes es la cuenta de mensajes del mes contra el tope.
type UsoDelMes struct {
	Usados     int       `json:"usados"`
	Tope       int       `json:"tope"`
	Proporcion float64   `json:"proporcion"`
	Ahorro     bool      `json:"ahorro"`
	Alcanzado  bool      `json:"alcanzado"`
	Reinicio   time.Time `json:"reinicio"`
}

// CalcularUso dice en qué modo está el mes. Un tope de cero es «por la API,
// nada automático».
func CalcularUso(usados, tope int) UsoDelMes {
	u := UsoDelMes{Usados: usados, Tope: tope}
	if tope <= 0 {
		u.Proporcion, u.Ahorro, u.Alcanzado = 1, true, true
		return u
	}
	u.Proporcion = float64(usados) / float64(tope)
	u.Alcanzado = usados >= tope
	u.Ahorro = u.Alcanzado || usados >= int(math.Ceil(float64(tope)*AhorroDesde))
	return u
}

// LeerTopeMensajes interpreta el ajuste: vacío o roto, el de siempre.
func LeerTopeMensajes(valor string) int {
	n, err := strconv.Atoi(strings.TrimSpace(valor))
	if err != nil || n < 0 {
		return TopeMensajesPorOmision
	}
	return n
}

func (s *Servicio) topeMensajes(ctx context.Context) (int, error) {
	var v string
	err := s.pool.QueryRow(ctx, `select valor from site_settings where clave = 'whatsapp_tope_mensajes'`).Scan(&v)
	if errors.Is(err, pgx.ErrNoRows) {
		return TopeMensajesPorOmision, nil
	}
	if err != nil {
		return 0, err
	}
	return LeerTopeMensajes(v), nil
}

// UsoDelMes cuenta los salientes del mes argentino que salieron (o están
// saliendo) por la API. Usa el mismo índice que el gasto (created_at).
func (s *Servicio) UsoDelMes(ctx context.Context, ahora time.Time) (UsoDelMes, error) {
	tope, err := s.topeMensajes(ctx)
	if err != nil {
		return UsoDelMes{}, err
	}
	var n int
	if err := s.pool.QueryRow(ctx, `select count(*)::int from whatsapp_mensajes
		where direccion = 'saliente' and created_at >= $1 and importado = false
		  and coalesce(origen, '') <> 'telefono' and estado <> 'fallido'`, InicioDelMesArgentino(ahora)).Scan(&n); err != nil {
		return UsoDelMes{}, err
	}
	u := CalcularUso(n, tope)
	u.Reinicio = InicioDelMesSiguienteArgentino(ahora)
	return u, nil
}

// revisarUmbralesDeMensajes avisa al admin al pasar el 80 % y el 100 % de los
// mensajes del mes, una vez por umbral y por mes (como RevisarUmbrales).
func (s *Servicio) revisarUmbralesDeMensajes(ctx context.Context) {
	u, err := s.UsoDelMes(ctx, s.ahora())
	if err != nil || !u.Ahorro {
		return
	}
	mes := MesArgentino(s.ahora())
	consulta := `update whatsapp_sesion set mensajes_aviso80 = $1 where mensajes_aviso80 is distinct from $1 returning id`
	if u.Alcanzado {
		consulta = `update whatsapp_sesion set mensajes_aviso100 = $1, mensajes_aviso80 = $1 where mensajes_aviso100 is distinct from $1 returning id`
	}
	r, err := s.pool.Query(ctx, consulta, mes)
	if err != nil {
		s.log.Error("whatsapp: umbral de mensajes", "error", err)
		return
	}
	marcadas := 0
	for r.Next() {
		marcadas++
	}
	r.Close()
	if marcadas == 0 {
		return
	}
	s.avisar(ctx, avisoTopeMensajes(u))
}

func avisoTopeMensajes(u UsoDelMes) push.Aviso {
	cuenta := strconv.Itoa(u.Usados) + " de " + strconv.Itoa(u.Tope)
	if u.Alcanzado {
		return push.Aviso{
			Titulo:   "WhatsApp llegó al tope de mensajes",
			Cuerpo:   "Van " + cuenta + " este mes. El bot y los avisos automáticos dejan de mandar hasta el mes que viene. Contestá desde el teléfono, que es gratis.",
			URL:      "/admin/whatsapp/configuracion",
			Etiqueta: "whatsapp-tope-mensajes",
			Pantalla: "/admin/whatsapp/configuracion",
		}
	}
	return push.Aviso{
		Titulo:   "WhatsApp va por el 80 % de los mensajes",
		Cuerpo:   "Van " + cuenta + " este mes. El bot pasa a modo ahorro: contesta lo justo y deriva antes.",
		URL:      "/admin/whatsapp/configuracion",
		Etiqueta: "whatsapp-tope-mensajes",
		Pantalla: "/admin/whatsapp/configuracion",
	}
}

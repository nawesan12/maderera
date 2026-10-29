package profesionales

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/avisos"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
)

// Los eventos: el panel (lib/dal/admin/eventos.ts, app/admin/eventos), la
// inscripción con cupo (lib/eventos) y sus avisos (lib/notificaciones/
// eventos.ts). Las lecturas públicas ya estaban en Go (internal/contenido).

// EventoAdmin es un evento del panel, con sus conteos.
type EventoAdmin struct {
	ID                string     `json:"id"`
	Slug              string     `json:"slug"`
	Titulo            string     `json:"titulo"`
	Resumen           *string    `json:"resumen"`
	Lugar             *string    `json:"lugar"`
	Sucursal          *string    `json:"sucursal"`
	Inicia            time.Time  `json:"inicia"`
	Termina           *time.Time `json:"termina"`
	Cupo              int        `json:"cupo"`
	Precio            float64    `json:"precio"`
	SoloProfesionales bool       `json:"soloProfesionales"`
	Estado            string     `json:"estado"`
	Inscriptos        int        `json:"inscriptos"`
	Confirmados       int        `json:"confirmados"`
	Reservados        int        `json:"reservados"`
	// Lo cobrado de verdad: solo las inscripciones confirmadas.
	Recaudado float64 `json:"recaudado"`
	Proximo   bool    `json:"proximo"`
}

// Eventos son todos, del más nuevo al más viejo.
func (s *Servicio) Eventos(ctx context.Context) ([]EventoAdmin, error) {
	filas, err := s.pool.Query(ctx, `select e.id, e.slug, e.titulo, e.resumen, e.lugar, b.name, e.inicia, e.termina, e.cupo, e.precio,
		e.solo_profesionales, e.estado::text,
		(select count(*)::int from event_registrations er where er.event_id = e.id and er.estado <> 'cancelada'),
		(select count(*)::int from event_registrations er where er.event_id = e.id and er.estado in ('confirmada', 'asistio')),
		(select count(*)::int from event_registrations er where er.event_id = e.id and er.estado = 'reservada')
		from events e left join branches b on b.id = e.branch_id
		order by e.inicia desc`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	ahora := s.ahora()
	out := []EventoAdmin{}
	for filas.Next() {
		var e EventoAdmin
		var precio jsmath.Num
		if err := filas.Scan(&e.ID, &e.Slug, &e.Titulo, &e.Resumen, &e.Lugar, &e.Sucursal, &e.Inicia, &e.Termina, &e.Cupo, &precio,
			&e.SoloProfesionales, &e.Estado, &e.Inscriptos, &e.Confirmados, &e.Reservados); err != nil {
			return nil, err
		}
		e.Precio = precio.F()
		e.Recaudado = float64(e.Precio * float64(e.Confirmados))
		e.Proximo = !e.Inicia.Before(ahora)
		out = append(out, e)
	}
	return out, filas.Err()
}

// Asistente es una inscripción.
type Asistente struct {
	ID          string     `json:"id"`
	Nombre      string     `json:"nombre"`
	Email       string     `json:"email"`
	Telefono    *string    `json:"telefono"`
	Estado      string     `json:"estado"`
	RecordadoAt *time.Time `json:"recordadoAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// Asistentes son los anotados a un evento, por orden de llegada.
func (s *Servicio) Asistentes(ctx context.Context, eventID string) ([]Asistente, error) {
	filas, err := s.pool.Query(ctx, `select id, nombre, email, telefono, estado::text, recordado_at, created_at
		from event_registrations where event_id = $1 order by created_at`, eventID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Asistente{}
	for filas.Next() {
		var a Asistente
		if err := filas.Scan(&a.ID, &a.Nombre, &a.Email, &a.Telefono, &a.Estado, &a.RecordadoAt, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, filas.Err()
}

// leerFecha lee un datetime-local (con o sin segundos) en hora de Buenos
// Aires. El TS hacía `new Date(texto)`, que lo lee en la zona del servidor:
// en producción (UTC) un evento de las 18 quedaba a las 15.
func leerFecha(texto string) (time.Time, bool) {
	for _, f := range []string{"2006-01-02T15:04", "2006-01-02T15:04:05"} {
		if t, err := time.ParseInLocation(f, texto, Zona); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// CrearEvento da de alta un evento en borrador (publicar es otra decisión).
func (s *Servicio) CrearEvento(ctx context.Context, f FormEvento) error {
	inicia, ok := leerFecha(f.Inicia)
	if !ok {
		return invalido("La fecha no es válida.")
	}
	var termina *time.Time
	if f.Termina != nil {
		t, ok := leerFecha(*f.Termina)
		if !ok {
			return invalido("La fecha no es válida.")
		}
		termina = &t
	}
	precio := 0.0
	if f.Precio != nil {
		precio = precios.ParsearImporte(*f.Precio)
	}
	if math.IsNaN(precio) || math.IsInf(precio, 0) || precio < 0 {
		return invalido("Revisá el precio.")
	}
	// Slug único: dos capacitaciones con el mismo nombre en años distintos
	// son habituales.
	slug := ASlug(f.Titulo)
	var existe bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from events where slug = $1)`, slug).Scan(&existe); err != nil {
		return err
	}
	if existe {
		l := inicia.In(Zona)
		slug = fmt.Sprintf("%s-%d%d", slug, l.Year(), int(l.Month()))
	}
	_, err := s.pool.Exec(ctx, `insert into events (slug, titulo, resumen, descripcion, lugar, inicia, termina, cupo, precio,
		solo_profesionales, estado) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'borrador')`,
		slug, f.Titulo, f.Resumen, f.Descripcion, f.Lugar, inicia, termina, f.Cupo, jsmath.Fijo2(precio), f.SoloProfesionales)
	return err
}

// TextoDeEstado es lo que dice la pantalla al cambiar el estado.
var TextoDeEstado = map[string]string{
	"borrador":  "Volvió a borrador: ya no se ve en el sitio.",
	"publicado": "Publicado. Ya se puede ver y anotar.",
	"cerrado":   "Cerrado: no se aceptan más inscripciones.",
	"cancelado": "Cancelado. Avisale a los anotados.",
}

// CambiarEstadoEvento publica, cierra o cancela.
func (s *Servicio) CambiarEstadoEvento(ctx context.Context, id, estado string) error {
	_, err := s.pool.Exec(ctx, `update events set estado = $2::estado_evento, updated_at = now() where id = $1`, id, estado)
	return err
}

// MarcarAsistencia toma asistencia.
func (s *Servicio) MarcarAsistencia(ctx context.Context, id, estado string) error {
	_, err := s.pool.Exec(ctx, `update event_registrations set estado = $2::estado_inscripcion, updated_at = now() where id = $1`, id, estado)
	return err
}

// ErrInscripcion es un motivo para no anotar (se dice en la pantalla).
type ErrInscripcion struct{ Mensaje string }

func (e *ErrInscripcion) Error() string { return e.Mensaje }

// Inscripcion es la que se creó.
type Inscripcion struct {
	ID           string  `json:"id"`
	RequierePago bool    `json:"requierePago"`
	Monto        float64 `json:"monto"`
}

// Anotar es inscribir() de lib/eventos: con el candado por evento
// (pg_advisory_xact_lock(hashtext(id)), el mismo del TS) y contando adentro
// de la transacción, dos personas al último lugar no entran las dos. Gratis
// queda confirmada; con precio, reservada (ocupa lugar) hasta que se pague.
func (s *Servicio) Anotar(ctx context.Context, a Anotarse, customerID, userID *string, esProfesional bool) (Inscripcion, error) {
	var r Inscripcion
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1))`, a.EventID); err != nil {
			return err
		}
		var estado string
		var inicia time.Time
		var cupo int
		var precio jsmath.Num
		var solo bool
		err := tx.QueryRow(ctx, `select estado::text, inicia, cupo, precio, solo_profesionales from events where id = $1`, a.EventID).
			Scan(&estado, &inicia, &cupo, &precio, &solo)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && estado != "publicado") {
			return &ErrInscripcion{"Este evento ya no está abierto."}
		}
		if err != nil {
			return err
		}
		if inicia.Before(s.ahora()) {
			return &ErrInscripcion{"Este evento ya pasó."}
		}
		if solo && !esProfesional {
			return &ErrInscripcion{"Este evento es para clientes profesionales. Pedí tu acceso y te anotamos."}
		}
		var yaEsta, yaEstado string
		err = tx.QueryRow(ctx, `select id, estado::text from event_registrations where event_id = $1 and email = $2 limit 1`, a.EventID, a.Email).
			Scan(&yaEsta, &yaEstado)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if yaEsta != "" && yaEstado != "cancelada" {
			return &ErrInscripcion{"Ya estás anotado a este evento."}
		}
		if cupo > 0 {
			var ocupados int
			if err := tx.QueryRow(ctx, `select count(*)::int from event_registrations where event_id = $1
				and estado in ('reservada', 'confirmada', 'asistio')`, a.EventID).Scan(&ocupados); err != nil {
				return err
			}
			if ocupados >= cupo {
				return &ErrInscripcion{"Se agotaron los lugares. Escribinos y te avisamos si se libera alguno."}
			}
		}
		r.Monto = precio.F()
		r.RequierePago = r.Monto > 0
		nuevo := "confirmada"
		if r.RequierePago {
			nuevo = "reservada"
		}
		if yaEsta != "" {
			r.ID = yaEsta
			_, err = tx.Exec(ctx, `update event_registrations set event_id = $2, customer_id = $3, user_id = $4, nombre = $5, email = $6,
				telefono = $7, estado = $8::estado_inscripcion, updated_at = now() where id = $1`,
				yaEsta, a.EventID, customerID, userID, a.Nombre, a.Email, a.Telefono, nuevo)
			return err
		}
		return tx.QueryRow(ctx, `insert into event_registrations (event_id, customer_id, user_id, nombre, email, telefono, estado)
			values ($1, $2, $3, $4, $5, $6, $7::estado_inscripcion) returning id`,
			a.EventID, customerID, userID, a.Nombre, a.Email, a.Telefono, nuevo).Scan(&r.ID)
	})
	var ei *ErrInscripcion
	if errors.As(err, &ei) {
		return r, invalido(ei.Mensaje)
	}
	if err == nil && !r.RequierePago {
		id := r.ID
		s.enSegundoPlano(func(ctx context.Context) { s.AvisarInscripcion(ctx, id) })
	}
	return r, err
}

// AvisarInscripcion manda la confirmación de una inscripción. No falla.
func (s *Servicio) AvisarInscripcion(ctx context.Context, id string) {
	var d DatosDelEvento
	var para string
	var inicia time.Time
	var precio jsmath.Num
	err := s.pool.QueryRow(ctx, `select er.nombre, er.email, e.titulo, e.slug, e.inicia, e.lugar, e.precio
		from event_registrations er join events e on e.id = er.event_id where er.id = $1`, id).
		Scan(&d.Nombre, &para, &d.Evento, &d.Slug, &inicia, &d.Lugar, &precio)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			s.log.Error("eventos: leyendo la inscripción", "id", id, "error", err)
		}
		return
	}
	d.Nombre = PrimeraPalabra(d.Nombre)
	d.Cuando = CuandoSeLee(inicia)
	d.Precio = precio.F()
	s.avisos.Despachar(ctx, avisos.Despacho{Evento: "inscripcion_evento", Para: para, EntidadTipo: "event_registration", EntidadID: id,
		Correo: avisos.Correo(Confirmacion(s.sitio, d))})
}

// AvisarInscripcionPorPago es notificarInscripcionPorPago: cuando se
// acredita el pago de una inscripción, la confirmación de la última
// confirmada de ese cliente. La llama el TS de los pagos (tanda 6).
func (s *Servicio) AvisarInscripcionPorPago(ctx context.Context, customerID string) {
	var id string
	err := s.pool.QueryRow(ctx, `select id from event_registrations where customer_id = $1 and estado = 'confirmada'
		order by updated_at desc limit 1`, customerID).Scan(&id)
	if err == nil {
		s.AvisarInscripcion(ctx, id)
	}
}

// EnviarRecordatorios manda los recordatorios de los eventos de mañana (el
// día de mañana en Buenos Aires: el TS usaba el de la zona del servidor).
// recordado_at evita mandar dos veces el mismo. Devuelve cuántos salieron.
func (s *Servicio) EnviarRecordatorios(ctx context.Context) (int, error) {
	a := s.ahora().In(Zona)
	desde := time.Date(a.Year(), a.Month(), a.Day()+1, 0, 0, 0, 0, Zona)
	hasta := desde.AddDate(0, 0, 1).Add(-time.Millisecond)
	filas, err := s.pool.Query(ctx, `select er.id, er.nombre, er.email, e.titulo, e.slug, e.inicia, e.lugar
		from event_registrations er join events e on e.id = er.event_id
		where e.inicia >= $1 and e.inicia <= $2 and e.estado = 'publicado' and er.estado = 'confirmada' and er.recordado_at is null`, desde, hasta)
	if err != nil {
		return 0, err
	}
	type pendiente struct {
		id, para string
		d        DatosDelEvento
		inicia   time.Time
	}
	var ps []pendiente
	for filas.Next() {
		var p pendiente
		if err := filas.Scan(&p.id, &p.d.Nombre, &p.para, &p.d.Evento, &p.d.Slug, &p.inicia, &p.d.Lugar); err != nil {
			filas.Close()
			return 0, err
		}
		ps = append(ps, p)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return 0, err
	}
	enviados := 0
	for _, p := range ps {
		p.d.Nombre = PrimeraPalabra(p.d.Nombre)
		p.d.Cuando = CuandoSeLee(p.inicia)
		s.avisos.Despachar(ctx, avisos.Despacho{Evento: "recordatorio_evento", Para: p.para, EntidadTipo: "event_registration",
			EntidadID: p.id, Correo: avisos.Correo(Recordatorio(s.sitio, p.d))})
		if _, err := s.pool.Exec(ctx, `update event_registrations set recordado_at = now() where id = $1`, p.id); err != nil {
			return enviados, err
		}
		enviados++
	}
	return enviados, nil
}

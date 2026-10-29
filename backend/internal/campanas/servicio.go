// Package campanas son las campañas de correo y las bajas (lib/campanas,
// lib/dal/admin/campanas.ts, app/admin/campanas, /baja y /api/baja del TS):
// armar, segmentar, mandar por tandas por la cola, programar, cancelar, y la
// baja con el enlace firmado (RFC 8058).
package campanas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/email"
	"mjbj/internal/plataforma"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

// TipoTanda es el trabajo de la cola de una tanda.
const TipoTanda = "campana.tanda"

// Config son las variables de las campañas.
type Config struct {
	Sitio        string `env:"APP_URL"`
	SitioPublico string `env:"NEXT_PUBLIC_APP_URL"`
	// El secreto que firma los enlaces de baja: el de la sesión, con un
	// prefijo propio (ver firma).
	Secreto   string `env:"BETTER_AUTH_SECRET"`
	PorMinuto string `env:"CAMPANAS_POR_MINUTO"`
}

// URLDelSitio es urlBase() del TS.
func (c Config) URLDelSitio() string {
	u := c.Sitio
	if u == "" {
		u = c.SitioPublico
	}
	if u == "" {
		u = "http://localhost:3000"
	}
	return strings.TrimSuffix(u, "/")
}

// Servicio son las campañas.
type Servicio struct {
	pool   *pgxpool.Pool
	q      *sqlc.Queries
	cfg    Config
	envio  email.Proveedor
	avisos *push.Avisador
	log    *slog.Logger
	ahora  func() time.Time
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, cfg Config, envio email.Proveedor, avisos *push.Avisador, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), cfg: cfg, envio: envio, avisos: avisos, log: log, ahora: time.Now}
}

// PorMinuto es cuántos correos salen por tanda: CAMPANAS_POR_MINUTO, o 3
// con el servidor propio (Hostinger deja 5 por minuto y los avisos de
// pedidos no pueden esperar) y 60 con Resend.
func (s *Servicio) PorMinuto() int {
	if n, err := strconv.Atoi(strings.TrimSpace(s.cfg.PorMinuto)); err == nil && n > 0 && n <= 1000 {
		return n
	}
	if s.envio.Nombre() == "smtp" {
		return 3
	}
	return 60
}

const sinCorreo = "El envío de correos no está conectado: con el proveedor de demostración la campaña no saldría a nadie."

func invalido(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

// condicion es la condición SQL del segmento sobre `customers c`, con sus
// argumentos a partir de $desde. Siempre: ficha activa, con una dirección
// que parece una dirección y sin baja. Los morosos no se excluyen.
func condicion(seg Segmento, desde int) (string, []any) {
	partes := []string{
		`c.active`, `c.estado <> 'inactivo'`,
		`c.email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'`,
		`not exists (select 1 from bajas_de_correo b where b.email = lower(c.email))`,
	}
	var args []any
	arg := func(v any) string {
		args = append(args, v)
		return "$" + strconv.Itoa(desde+len(args)-1)
	}
	if seg.Tipo != "todos" {
		partes = append(partes, "c.tipo = "+arg(seg.Tipo)+"::tipo_cliente")
	}
	if len(seg.Rubros) > 0 {
		partes = append(partes, "c.rubro = any("+arg(seg.Rubros)+"::text[])")
	}
	if seg.Actividad != nil {
		compro := "exists (select 1 from orders o where o.customer_id = c.id and o.estado <> 'cancelado' and o.created_at >= now() - make_interval(months => " +
			arg(seg.Actividad.Meses) + "::int))"
		if seg.Actividad.Tipo == "compraron" {
			partes = append(partes, compro)
		} else {
			partes = append(partes, "not "+compro)
		}
	}
	return strings.Join(partes, " and "), args
}

// Contar es cuántas direcciones distintas alcanza un segmento.
func (s *Servicio) Contar(ctx context.Context, seg Segmento) (int, error) {
	cond, args := condicion(seg, 1)
	var n int
	err := s.pool.QueryRow(ctx, `select count(distinct lower(c.email))::int from customers c where `+cond, args...).Scan(&n)
	return n, err
}

// IniciarEnvio congela la lista de destinatarios y encola la primera tanda.
// El UPDATE … WHERE estado in (borrador, programada) es el candado: dos
// clics, o el worker y un clic a la vez, arrancan el envío una sola vez.
func (s *Servicio) IniciarEnvio(ctx context.Context, id string) (int, error) {
	if !s.envio.Real() {
		return 0, invalido(sinCorreo)
	}
	var n int
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var crudo []byte
		err := tx.QueryRow(ctx, `update campanas set estado = 'enviando', iniciada_at = now(), updated_at = now()
			where id = $1 and estado in ('borrador', 'programada') returning segmento`, id).Scan(&crudo)
		if errors.Is(err, pgx.ErrNoRows) {
			return invalido("Esa campaña ya se está enviando o ya se envió.")
		}
		if err != nil {
			return err
		}
		var seg Segmento
		if err := json.Unmarshal(crudo, &seg); err != nil {
			return err
		}
		cond, args := condicion(seg, 2)
		r, err := tx.Exec(ctx, `insert into campana_envios (campana_id, customer_id, email, nombre)
			select distinct on (lower(c.email)) $1::uuid, c.id, lower(trim(c.email)), c.nombre
			  from customers c where `+cond+`
			 order by lower(c.email), c.updated_at desc
			on conflict do nothing`, append([]any{id}, args...)...)
		if err != nil {
			return err
		}
		n = int(r.RowsAffected())
		if n == 0 {
			return invalido("El segmento no alcanza a nadie con correo: revisalo antes de enviar.")
		}
		_, err = cola.Encolar(ctx, s.q.WithTx(tx), TipoTanda, map[string]string{"campanaId": id}, time.Time{})
		return err
	})
	return n, err
}

// ProcesarTanda manda hasta PorMinuto() correos pendientes y encola la
// siguiente. Los envíos se toman con FOR UPDATE SKIP LOCKED: dos tandas de
// la misma campaña a la vez nunca le mandan dos veces a la misma persona.
func (s *Servicio) ProcesarTanda(ctx context.Context, id string) error {
	var c ParaArmar
	var estado string
	err := s.pool.QueryRow(ctx, `select estado::text, asunto, adelanto, cuerpo, imagen_url, boton_texto, boton_url from campanas where id = $1`, id).
		Scan(&estado, &c.Asunto, &c.Adelanto, &c.Cuerpo, &c.ImagenURL, &c.BotonTexto, &c.BotonURL)
	// Cancelada (o borrada) a mitad de camino: lo que falta no sale.
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && estado != "enviando") {
		return nil
	}
	if err != nil {
		return err
	}
	cortar := false
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		filas, err := tx.Query(ctx, `select e.id, e.email, e.nombre,
			exists (select 1 from bajas_de_correo b where b.email = lower(e.email))
			from campana_envios e
			where e.campana_id = $1 and e.estado = 'pendiente'
			order by e.email limit $2
			for update of e skip locked`, id, s.PorMinuto())
		if err != nil {
			return err
		}
		type envio struct {
			id, email string
			nombre    *string
			baja      bool
		}
		var tanda []envio
		for filas.Next() {
			var e envio
			if err := filas.Scan(&e.id, &e.email, &e.nombre, &e.baja); err != nil {
				filas.Close()
				return err
			}
			tanda = append(tanda, e)
		}
		filas.Close()
		if err := filas.Err(); err != nil {
			return err
		}
		for _, e := range tanda {
			if e.baja {
				if _, err := tx.Exec(ctx, `update campana_envios set estado = 'omitido' where id = $1`, e.id); err != nil {
					return err
				}
				continue
			}
			nombre := ""
			if e.nombre != nil {
				nombre = *e.nombre
			}
			correo := ArmarCorreo(s.cfg.URLDelSitio(), s.cfg.Secreto, c, e.email, nombre)
			r := s.envio.Enviar(ctx, email.Mensaje{Para: e.email, Asunto: correo.Asunto, HTML: correo.HTML, Texto: correo.Texto, Cabeceras: correo.Cabeceras})
			// Rechazo temporal (el tope de Hostinger, un corte): queda
			// pendiente y la tanda termina acá.
			if !r.Enviado && r.Temporal {
				cortar = true
				break
			}
			nuevo, falla := "enviado", (*string)(nil)
			if !r.Enviado {
				nuevo = "fallido"
				m := r.Error
				if m == "" {
					m = "No salió."
				}
				m = recortar(m, 500)
				falla = &m
			}
			if _, err := tx.Exec(ctx, `update campana_envios set estado = $2::estado_envio_campana, error = $3, enviado_at = now() where id = $1`,
				e.id, nuevo, falla); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	var quedan int
	if err := s.pool.QueryRow(ctx, `select count(*)::int from campana_envios where campana_id = $1 and estado = 'pendiente'`, id).Scan(&quedan); err != nil {
		return err
	}
	if quedan > 0 {
		espera := time.Minute
		if cortar {
			// Después de un rechazo temporal, un poco más que una tanda.
			espera = 3 * time.Minute
		}
		_, err := cola.Encolar(ctx, s.q, TipoTanda, map[string]string{"campanaId": id}, s.ahora().Add(espera))
		return err
	}
	_, err = s.pool.Exec(ctx, `update campanas set estado = 'enviada', terminada_at = now(), updated_at = now() where id = $1 and estado = 'enviando'`, id)
	return err
}

// recortar son los primeros n caracteres UTF-16, como slice() de JS (sin
// partir una runa).
func recortar(s string, n int) string {
	cuenta := 0
	for i, r := range s {
		w := 1
		if r > 0xFFFF {
			w = 2
		}
		if cuenta+w > n {
			return s[:i]
		}
		cuenta += w
	}
	return s
}

// ManejadorTanda es `campana.tanda` para la cola.
func (s *Servicio) ManejadorTanda() cola.Manejador {
	return func(ctx context.Context, crudo json.RawMessage) error {
		var c struct {
			CampanaID string `json:"campanaId"`
		}
		if err := json.Unmarshal(crudo, &c); err != nil {
			return err
		}
		return s.ProcesarTanda(ctx, c.CampanaID)
	}
}

// IniciarProgramadas arranca las programadas cuya hora llegó. La que no
// puede salir vuelve a borrador y se avisa al panel, en vez de reintentar
// cada minuto.
func (s *Servicio) IniciarProgramadas(ctx context.Context) (int, error) {
	filas, err := s.pool.Query(ctx, `select id from campanas where estado = 'programada' and programada_para <= now()`)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	iniciadas := 0
	for _, id := range ids {
		if _, err := s.IniciarEnvio(ctx, id); err != nil {
			mensaje := err.Error()
			var p *plataforma.Problema
			if errors.As(err, &p) {
				mensaje = p.Detalle
			}
			if _, e := s.pool.Exec(ctx, `update campanas set estado = 'borrador', programada_para = null, updated_at = now()
				where id = $1 and estado = 'programada'`, id); e != nil {
				return iniciadas, e
			}
			s.log.Error("campanas: una programada no salió", "id", id, "error", mensaje)
			if s.avisos != nil {
				s.avisos.Avisar(ctx, push.Aviso{Titulo: "Una campaña programada no salió", Cuerpo: mensaje + " Quedó como borrador.",
					URL: "/admin/campanas/" + id, Etiqueta: "campana-fallida"})
			}
			continue
		}
		iniciadas++
	}
	return iniciadas, nil
}

/* ------------------------------- el panel ------------------------------- */

// Resumen es una campaña con sus conteos (ResumenDeCampana del TS).
type Resumen struct {
	ID              string     `json:"id"`
	Asunto          string     `json:"asunto"`
	Adelanto        *string    `json:"adelanto"`
	Cuerpo          string     `json:"cuerpo"`
	ImagenURL       *string    `json:"imagenUrl"`
	BotonTexto      *string    `json:"botonTexto"`
	BotonURL        *string    `json:"botonUrl"`
	Segmento        Segmento   `json:"segmento"`
	Estado          string     `json:"estado"`
	ProgramadaPara  *time.Time `json:"programadaPara"`
	CreadaPorUserID *string    `json:"creadaPorUserId"`
	CreadaPorNombre *string    `json:"creadaPorNombre"`
	IniciadaAt      *time.Time `json:"iniciadaAt"`
	TerminadaAt     *time.Time `json:"terminadaAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	Total           int        `json:"total"`
	Enviados        int        `json:"enviados"`
	Fallidos        int        `json:"fallidos"`
	Omitidos        int        `json:"omitidos"`
	Pendientes      int        `json:"pendientes"`
}

const columnasResumen = `c.id, c.asunto, c.adelanto, c.cuerpo, c.imagen_url, c.boton_texto, c.boton_url, c.segmento, c.estado::text,
	c.programada_para, c.creada_por_user_id, c.creada_por_nombre, c.iniciada_at, c.terminada_at, c.created_at, c.updated_at,
	coalesce(e.total, 0), coalesce(e.enviados, 0), coalesce(e.fallidos, 0), coalesce(e.omitidos, 0), coalesce(e.pendientes, 0)
	from campanas c
	left join lateral (select count(*)::int total,
		count(*) filter (where estado = 'enviado')::int enviados,
		count(*) filter (where estado = 'fallido')::int fallidos,
		count(*) filter (where estado = 'omitido')::int omitidos,
		count(*) filter (where estado = 'pendiente')::int pendientes
		from campana_envios where campana_id = c.id) e on true`

func escanearResumen(f pgx.Row) (Resumen, error) {
	var r Resumen
	var seg []byte
	err := f.Scan(&r.ID, &r.Asunto, &r.Adelanto, &r.Cuerpo, &r.ImagenURL, &r.BotonTexto, &r.BotonURL, &seg, &r.Estado,
		&r.ProgramadaPara, &r.CreadaPorUserID, &r.CreadaPorNombre, &r.IniciadaAt, &r.TerminadaAt, &r.CreatedAt, &r.UpdatedAt,
		&r.Total, &r.Enviados, &r.Fallidos, &r.Omitidos, &r.Pendientes)
	if err == nil {
		err = json.Unmarshal(seg, &r.Segmento)
		if r.Segmento.Rubros == nil {
			r.Segmento.Rubros = []string{}
		}
	}
	return r, err
}

// Listar son las últimas 200.
func (s *Servicio) Listar(ctx context.Context) ([]Resumen, error) {
	filas, err := s.pool.Query(ctx, `select `+columnasResumen+` order by c.created_at desc limit 200`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Resumen{}
	for filas.Next() {
		r, err := escanearResumen(filas)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, filas.Err()
}

// Obtener es una, o nil.
func (s *Servicio) Obtener(ctx context.Context, id string) (*Resumen, error) {
	r, err := escanearResumen(s.pool.QueryRow(ctx, `select `+columnasResumen+` where c.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &r, err
}

// Fallido es un envío que no salió, con el motivo.
type Fallido struct {
	Email  string  `json:"email"`
	Nombre *string `json:"nombre"`
	Error  *string `json:"error"`
}

// Fallidos son los que no salieron.
func (s *Servicio) Fallidos(ctx context.Context, id string) ([]Fallido, error) {
	filas, err := s.pool.Query(ctx, `select email, nombre, error from campana_envios
		where campana_id = $1 and estado = 'fallido' order by email limit 200`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Fallido{}
	for filas.Next() {
		var f Fallido
		if err := filas.Scan(&f.Email, &f.Nombre, &f.Error); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, filas.Err()
}

// CantidadDeBajas es cuántas direcciones se dieron de baja.
func (s *Servicio) CantidadDeBajas(ctx context.Context) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*)::int from bajas_de_correo`).Scan(&n)
	return n, err
}

func vacioANulo(p *string) *string {
	if p == nil || *p == "" {
		return nil
	}
	return p
}

// Guardar da de alta un borrador o edita uno que todavía no salió.
func (s *Servicio) Guardar(ctx context.Context, ses *auth.Sesion, id string, f FormCampana, seg Segmento) (string, error) {
	if f.BotonTexto != nil && *f.BotonTexto != "" && vacioANulo(f.BotonURL) == nil {
		return "", invalido("El botón necesita a dónde lleva.")
	}
	segJSON, _ := json.Marshal(seg)
	if id != "" {
		r, err := s.pool.Exec(ctx, `update campanas set asunto = $2, adelanto = $3, cuerpo = $4, imagen_url = $5, boton_texto = $6,
			boton_url = $7, segmento = $8, updated_at = now() where id = $1 and estado in ('borrador', 'programada')`,
			id, f.Asunto, f.Adelanto, f.Cuerpo, vacioANulo(f.ImagenURL), f.BotonTexto, vacioANulo(f.BotonURL), segJSON)
		if err != nil {
			return "", err
		}
		if r.RowsAffected() == 0 {
			return "", invalido("Esa campaña ya se envió: no se puede editar. Podés duplicarla.")
		}
		return id, nil
	}
	var nuevo string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `insert into campanas (asunto, adelanto, cuerpo, imagen_url, boton_texto, boton_url, segmento,
			creada_por_user_id, creada_por_nombre) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
			f.Asunto, f.Adelanto, f.Cuerpo, vacioANulo(f.ImagenURL), f.BotonTexto, vacioANulo(f.BotonURL), segJSON, ses.UserID, ses.Nombre).
			Scan(&nuevo); err != nil {
			return err
		}
		bitacora.Anotar(ctx, s.q.WithTx(tx), s.log, ses, sqlc.AccionAuditoriaCrear, "campana", nuevo, "Campaña «"+f.Asunto+"» (borrador)", nil)
		return nil
	})
	return nuevo, err
}

// Correo es el de una campaña armado para quien la está armando (vista
// previa y prueba).
func (s *Servicio) Correo(ses *auth.Sesion, f FormCampana) Correo {
	return ArmarCorreo(s.cfg.URLDelSitio(), s.cfg.Secreto, ParaArmar{Asunto: f.Asunto, Adelanto: f.Adelanto, Cuerpo: f.Cuerpo,
		ImagenURL: vacioANulo(f.ImagenURL), BotonTexto: f.BotonTexto, BotonURL: vacioANulo(f.BotonURL)}, ses.Correo, ses.Nombre)
}

// EnviarPrueba manda la campaña a la casilla de quien la arma.
func (s *Servicio) EnviarPrueba(ctx context.Context, ses *auth.Sesion, f FormCampana) (string, error) {
	if !s.envio.Real() {
		return "", invalido("El envío de correos no está conectado todavía.")
	}
	c := s.Correo(ses, f)
	r := s.envio.Enviar(ctx, email.Mensaje{Para: ses.Correo, Asunto: "[Prueba] " + c.Asunto, HTML: c.HTML, Texto: c.Texto, Cabeceras: c.Cabeceras})
	if !r.Enviado {
		m := r.Error
		if m == "" {
			m = "No salió."
		}
		return "", invalido(m)
	}
	return "Te la mandamos a " + ses.Correo + ".", nil
}

// Enviar arranca el envío ya.
func (s *Servicio) Enviar(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	n, err := s.IniciarEnvio(ctx, id)
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "campana", id, fmt.Sprintf("Envió la campaña a %d direcciones", n), nil)
	if n == 1 {
		return "Saliendo a 1 dirección.", nil
	}
	return fmt.Sprintf("Saliendo a %d direcciones.", n), nil
}

var zonaArgentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return zonaFija
	}
	return l
}()

// fechaHoraAR es toLocaleString("es-AR", { timeZone: Buenos Aires }):
// «5/11/2026, 18:00:00».
func fechaHoraAR(t time.Time) string {
	l := t.In(zonaArgentina)
	return fmt.Sprintf("%d/%d/%d, %02d:%02d:%02d", l.Day(), int(l.Month()), l.Year(), l.Hour(), l.Minute(), l.Second())
}

// Programar la deja para más tarde (hora de Buenos Aires).
func (s *Servicio) Programar(ctx context.Context, ses *auth.Sesion, id, cuando string) error {
	if !s.envio.Real() {
		return invalido(sinCorreo)
	}
	fecha, ok := LeerHoraLocal(cuando)
	if !ok {
		return invalido("La fecha no es válida.")
	}
	if fecha.Before(s.ahora().Add(time.Minute)) {
		return invalido("Para mandarla ahora, usá «Enviar ahora».")
	}
	r, err := s.pool.Exec(ctx, `update campanas set estado = 'programada', programada_para = $2, updated_at = now()
		where id = $1 and estado in ('borrador', 'programada')`, id, fecha)
	if err != nil {
		return err
	}
	if r.RowsAffected() == 0 {
		return invalido("Esa campaña ya se envió.")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "campana", id, "Programó la campaña para el "+fechaHoraAR(fecha), nil)
	return nil
}

// Desprogramar la vuelve a borrador.
func (s *Servicio) Desprogramar(ctx context.Context, id string) error {
	_, err := s.pool.Exec(ctx, `update campanas set estado = 'borrador', programada_para = null, updated_at = now()
		where id = $1 and estado = 'programada'`, id)
	return err
}

// Cancelar corta un envío en curso: lo pendiente queda omitido.
func (s *Servicio) Cancelar(ctx context.Context, ses *auth.Sesion, id string) (int, error) {
	omitidos := -1
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		r, err := tx.Exec(ctx, `update campanas set estado = 'cancelada', terminada_at = now(), updated_at = now()
			where id = $1 and estado = 'enviando'`, id)
		if err != nil || r.RowsAffected() == 0 {
			return err
		}
		r, err = tx.Exec(ctx, `update campana_envios set estado = 'omitido' where campana_id = $1 and estado = 'pendiente'`, id)
		omitidos = int(r.RowsAffected())
		return err
	})
	if err != nil {
		return 0, err
	}
	if omitidos < 0 {
		return 0, invalido("Esa campaña no se está enviando.")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "campana", id,
		fmt.Sprintf("Canceló el envío; %d direcciones quedaron sin mandar", omitidos), nil)
	return omitidos, nil
}

// Duplicar copia una campaña como borrador nuevo.
func (s *Servicio) Duplicar(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	var nuevo string
	err := s.pool.QueryRow(ctx, `insert into campanas (asunto, adelanto, cuerpo, imagen_url, boton_texto, boton_url, segmento,
		creada_por_user_id, creada_por_nombre)
		select asunto, adelanto, cuerpo, imagen_url, boton_texto, boton_url, segmento, $2, $3 from campanas where id = $1
		returning id`, id, ses.UserID, ses.Nombre).Scan(&nuevo)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", invalido("No existe esa campaña.")
	}
	return nuevo, err
}

// EliminarBorrador borra un borrador (lo enviado queda como registro).
func (s *Servicio) EliminarBorrador(ctx context.Context, ses *auth.Sesion, id string) error {
	var asunto string
	err := s.pool.QueryRow(ctx, `delete from campanas where id = $1 and estado = 'borrador' returning asunto`, id).Scan(&asunto)
	if errors.Is(err, pgx.ErrNoRows) {
		return invalido("Solo se borran los borradores: lo enviado queda como registro.")
	}
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "campana", id, "Borró el borrador «"+asunto+"»", nil)
	return nil
}

/* ------------------------------- las bajas ------------------------------- */

// DarDeBaja anota la dirección (por dirección, no vence).
func (s *Servicio) DarDeBaja(ctx context.Context, correo, origen string) error {
	_, err := s.pool.Exec(ctx, `insert into bajas_de_correo (email, origen) values ($1, $2) on conflict do nothing`, NormalizarCorreo(correo), origen)
	return err
}

// VolverARecibir la saca de las bajas.
func (s *Servicio) VolverARecibir(ctx context.Context, correo string) error {
	_, err := s.pool.Exec(ctx, `delete from bajas_de_correo where email = $1`, NormalizarCorreo(correo))
	return err
}

// EstaDadoDeBaja dice si la dirección se dio de baja.
func (s *Servicio) EstaDadoDeBaja(ctx context.Context, correo string) (bool, error) {
	var esta bool
	err := s.pool.QueryRow(ctx, `select exists(select 1 from bajas_de_correo where email = $1)`, NormalizarCorreo(correo)).Scan(&esta)
	return esta, err
}

// Verificar es la dirección del enlace, si es auténtico.
func (s *Servicio) Verificar(e, t string) (string, bool) { return VerificarBaja(e, t, s.cfg.Secreto) }

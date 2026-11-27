package profesionales

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/avisos"
	"mjbj/internal/bitacora"
	"mjbj/internal/cuit"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
)

// Servicio son los profesionales y los eventos.
type Servicio struct {
	pool   *pgxpool.Pool
	q      *sqlc.Queries
	avisos *avisos.Servicio
	sitio  string
	log    *slog.Logger
	ahora  func() time.Time
	// enSegundoPlano corre los avisos después de responder (el after() de
	// Next). Las pruebas lo cambian para esperarlos.
	enSegundoPlano func(func(context.Context))
	// PagoOnline dice si hay con qué cobrar en línea (pagos.Config.Elegir);
	// nil es que sí. Sin eso, un evento pago no reserva lugar.
	PagoOnline func() bool
}

// MsjEventoSinPago es lo que se contesta al anotarse a un evento pago con el
// cobro en línea apagado: reservaba el lugar y no había forma de pagarlo
// (mes simulado, M2S2-016).
const MsjEventoSinPago = "El pago online no está disponible. Escribinos por WhatsApp y te anotamos."

// Nuevo arma el servicio. sitio es APP_URL (para los enlaces de los correos).
func Nuevo(pool *pgxpool.Pool, av *avisos.Servicio, sitio string, log *slog.Logger) *Servicio {
	s := &Servicio{pool: pool, q: sqlc.New(pool), avisos: av, sitio: sitio, log: log, ahora: time.Now}
	s.enSegundoPlano = func(f func(context.Context)) {
		go func() {
			ctx, cancelar := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancelar()
			f(ctx)
		}()
	}
	return s
}

func invalido(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

/* ------------------------------- el panel ------------------------------- */

// ClienteExistente es la ficha que ya compra con ese CUIT.
type ClienteExistente struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
}

// SolicitudListada es una solicitud del panel.
type SolicitudListada struct {
	ID               string            `json:"id"`
	Nombre           string            `json:"nombre"`
	RazonSocial      *string           `json:"razonSocial"`
	DocumentoTipo    string            `json:"documentoTipo"`
	DocumentoNumero  string            `json:"documentoNumero"`
	Cuit             *string           `json:"cuit"`
	Email            string            `json:"email"`
	Telefono         string            `json:"telefono"`
	Rubro            string            `json:"rubro"`
	Matricula        *string           `json:"matricula"`
	VolumenEstimado  *string           `json:"volumenEstimado"`
	Localidad        *string           `json:"localidad"`
	RedSocial        *string           `json:"redSocial"`
	Mensaje          *string           `json:"mensaje"`
	Estado           string            `json:"estado"`
	MotivoRechazo    *string           `json:"motivoRechazo"`
	CustomerID       *string           `json:"customerId"`
	ClienteExistente *ClienteExistente `json:"clienteExistente"`
	CreatedAt        time.Time         `json:"createdAt"`
	ResueltoAt       *time.Time        `json:"resueltoAt"`
}

// Solicitudes son las últimas 200, con la ficha que ya existe con ese CUIT
// (el dato que decide si aprobar crea una ficha o marca la que ya compra).
// Las de DNI no se aparean: customers.cuit guarda CUIT.
func (s *Servicio) Solicitudes(ctx context.Context) ([]SolicitudListada, error) {
	filas, err := s.pool.Query(ctx, `select id, nombre, razon_social, documento_tipo::text, coalesce(documento_numero, ''), cuit, email,
		telefono, rubro::text, matricula, volumen_estimado, localidad, red_social, mensaje, estado::text, motivo_rechazo, customer_id,
		created_at, resuelto_at
		from professional_applications order by created_at desc limit 200`)
	if err != nil {
		return nil, err
	}
	out := []SolicitudListada{}
	for filas.Next() {
		var f SolicitudListada
		if err := filas.Scan(&f.ID, &f.Nombre, &f.RazonSocial, &f.DocumentoTipo, &f.DocumentoNumero, &f.Cuit, &f.Email, &f.Telefono,
			&f.Rubro, &f.Matricula, &f.VolumenEstimado, &f.Localidad, &f.RedSocial, &f.Mensaje, &f.Estado, &f.MotivoRechazo,
			&f.CustomerID, &f.CreatedAt, &f.ResueltoAt); err != nil {
			filas.Close()
			return nil, err
		}
		out = append(out, f)
	}
	filas.Close()
	if err := filas.Err(); err != nil || len(out) == 0 {
		return out, err
	}
	// Se busca por las dos formas en que puede estar guardado (con guiones y
	// sin) para usar el índice de customers.cuit.
	var buscados []string
	vistos := map[string]bool{}
	for _, f := range out {
		if f.Cuit != nil && !vistos[*f.Cuit] {
			vistos[*f.Cuit] = true
			buscados = append(buscados, cuit.Variantes(*f.Cuit)...)
		}
	}
	porCuit := map[string]*ClienteExistente{}
	if len(buscados) > 0 {
		ex, err := s.pool.Query(ctx, `select id, nombre, coalesce(cuit, '') from customers where active and cuit = any($1::text[])`, buscados)
		if err != nil {
			return nil, err
		}
		for ex.Next() {
			var c ClienteExistente
			var cu string
			if err := ex.Scan(&c.ID, &c.Nombre, &cu); err != nil {
				ex.Close()
				return nil, err
			}
			porCuit[cuit.SoloDigitos(cu)] = &c
		}
		ex.Close()
		if err := ex.Err(); err != nil {
			return nil, err
		}
	}
	for i := range out {
		if out[i].Cuit != nil {
			out[i].ClienteExistente = porCuit[*out[i].Cuit]
		}
	}
	return out, nil
}

// ListaAsignable es una lista de precios activa.
type ListaAsignable struct {
	ID        string `json:"id"`
	Nombre    string `json:"nombre"`
	EsGeneral bool   `json:"esGeneral"`
}

// Listas son las listas que se pueden asignar.
func (s *Servicio) Listas(ctx context.Context) ([]ListaAsignable, error) {
	filas, err := s.pool.Query(ctx, `select id, name, is_default from price_lists where active order by name`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []ListaAsignable{}
	for filas.Next() {
		var l ListaAsignable
		if err := filas.Scan(&l.ID, &l.Nombre, &l.EsGeneral); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, filas.Err()
}

// ResumenProfesionales son los números de arriba de la pantalla.
type ResumenProfesionales struct {
	Pendientes            int `json:"pendientes"`
	AprobadosMes          int `json:"aprobadosMes"`
	ClientesProfesionales int `json:"clientesProfesionales"`
}

// Resumen cuenta pendientes, aprobados este mes (en hora de Buenos Aires: el
// TS empezaba el mes en la zona del servidor, UTC) y profesionales activos.
func (s *Servicio) Resumen(ctx context.Context) (ResumenProfesionales, error) {
	a := s.ahora().In(Zona)
	inicio := time.Date(a.Year(), a.Month(), 1, 0, 0, 0, 0, Zona)
	var r ResumenProfesionales
	err := s.pool.QueryRow(ctx, `select
		(select count(*)::int from professional_applications where estado = 'pendiente'),
		(select count(*)::int from professional_applications where estado = 'aprobada' and resuelto_at >= $1),
		(select count(*)::int from customers where tipo = 'profesional' and active)`, inicio).
		Scan(&r.Pendientes, &r.AprobadosMes, &r.ClientesProfesionales)
	return r, err
}

type solicitud struct {
	id, nombre, email, telefono, rubro, estado string
	cuit, userID, razonSocial, motivo          *string
}

func (s *Servicio) leerSolicitud(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (*solicitud, error) {
	var x solicitud
	err := q.QueryRow(ctx, `select id, nombre, email, telefono, rubro::text, estado::text, cuit, user_id, razon_social, motivo_rechazo
		from professional_applications where id = $1`, id).
		Scan(&x.id, &x.nombre, &x.email, &x.telefono, &x.rubro, &x.estado, &x.cuit, &x.userID, &x.razonSocial, &x.motivo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &x, err
}

const noSePudo = "No pudimos habilitar esta cuenta. Fijate si el cliente ya tiene ficha cargada y avisanos si sigue pasando."

// Aprobar habilita el acceso, en una transacción: vincula o crea la ficha
// (gana la del CUIT; la cuenta web se muda a ella), asigna la lista y el
// límite, y marca el perfil de la cuenta web. Devuelve el mensaje.
func (s *Servicio) Aprobar(ctx context.Context, ses *auth.Sesion, id string, lista, limiteTexto *string, opciones ...Aprobacion) (string, error) {
	var op Aprobacion
	if len(opciones) > 0 {
		op = opciones[0]
	}
	sol, err := s.leerSolicitud(ctx, s.pool, id)
	if err != nil {
		return "", err
	}
	if sol == nil {
		return "", invalido("La solicitud no existe.")
	}
	if sol.estado == "aprobada" {
		return "", invalido("Esta solicitud ya estaba aprobada.")
	}
	limite := 0.0
	if limiteTexto != nil && *limiteTexto != "" {
		limite = precios.ParsearImporte(*limiteTexto)
	}
	if math.IsNaN(limite) || math.IsInf(limite, 0) || limite < 0 {
		return "", invalido("Revisá el límite de cuenta corriente.")
	}
	if op.CondicionIva != "" && !slices.Contains(CondicionesIva, op.CondicionIva) {
		return "", invalido("Elegí la condición frente al IVA.")
	}
	if op.DiasCredito != nil && (*op.DiasCredito < 0 || *op.DiasCredito > 365) {
		return "", invalido("Revisá a cuántos días paga.")
	}

	var nombreLista *string
	advertencia := ""
	enlace := ""
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// Quien pidió el acceso sin haber entrado quedaba aprobado sin
		// cuenta para entrar (notas del 9/11/2026). Ahora la cuenta se ata al
		// aprobar: la que ya tenga ese correo, o una nueva sin clave que se
		// activa con un link de un solo uso (va en la bienvenida y el panel
		// lo puede reenviar por WhatsApp).
		//
		// **Una solicitud anónima nunca se ata a una cuenta que ya existe**
		// (revisión del 10/11/2026): cualquiera puede escribir el correo de
		// otra persona en el formulario, y atarla le daba a quien la mandó la
		// cuenta y la lista del dueño del correo. Si el correo ya tiene
		// cuenta, se aprueba la ficha sin cuenta web y el panel avisa: que esa
		// persona entre con su cuenta y pida el acceso desde ahí.
		if sol.userID == nil {
			var existente string
			err := tx.QueryRow(ctx, `select id from "user" where email = lower(btrim($1))`, sol.email).Scan(&existente)
			switch {
			case err == nil:
				advertencia = "Ya hay una cuenta web con ese correo y la solicitud se hizo sin entrar: no se ataron. Si es de esa persona, que entre con su cuenta y vuelva a pedir el acceso desde el portal."
			case errors.Is(err, pgx.ErrNoRows):
				nueva, err := auth.CrearCuentaSinClave(ctx, s.q.WithTx(tx), sol.nombre, sol.email, s.ahora())
				if err != nil {
					return err
				}
				sol.userID = &nueva
				token, err := auth.NuevoEnlace(ctx, tx, nueva, auth.EnlaceActivacion, auth.VenceActivacion, s.ahora())
				if err != nil {
					return err
				}
				enlace = strings.TrimSuffix(s.sitio, "/") + "/entrar/" + token
				if _, err := tx.Exec(ctx, `update professional_applications set user_id = $2, cuenta_creada = true where id = $1`, sol.id, nueva); err != nil {
					return err
				}
			default:
				return err
			}
		}
		var porCuit, porUsuario *Candidata
		if sol.cuit != nil && *sol.cuit != "" {
			var c Candidata
			var correo, nombreFicha *string
			err := tx.QueryRow(ctx, `select id, user_id, email, nombre from customers where active and cuit = any($1::text[]) limit 1`, cuit.Variantes(*sol.cuit)).
				Scan(&c.ID, &c.UserID, &correo, &nombreFicha)
			switch {
			case err == nil:
				// El CUIT es público (está en el padrón): solo no alcanza para
				// darle a alguien la ficha de otro, con su cuenta corriente y
				// sus comprobantes. Se une si la ficha ya es de esa cuenta o
				// si el correo coincide con el que la ficha ya tenía.
				mismaCuenta := sol.userID != nil && c.UserID != nil && *c.UserID == *sol.userID
				mismoCorreo := correo != nil && strings.EqualFold(strings.TrimSpace(*correo), strings.TrimSpace(sol.email))
				if mismaCuenta || mismoCorreo {
					porCuit = &c
				} else {
					n := "otra ficha"
					if nombreFicha != nil {
						n = "la ficha de " + *nombreFicha
					}
					advertencia = "Ese CUIT ya está en " + n + ", con otro correo: no se unieron, para que nadie se quede con una cuenta ajena. Si es la misma persona, confirmalo con el cliente y uní las fichas a mano."
				}
			case !errors.Is(err, pgx.ErrNoRows):
				return err
			}
		}
		userID := ""
		if sol.userID != nil {
			userID = *sol.userID
			var c Candidata
			err := tx.QueryRow(ctx, `select id from customers where user_id = $1 limit 1`, userID).Scan(&c.ID)
			if err == nil {
				porUsuario = &c
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		d := DecidirFicha(porCuit, porUsuario, userID)
		limiteFijo := jsmath.Fijo2(limite)

		var customerID string
		if d.Destino != nil {
			if d.Liberar != nil {
				var vacia bool
				if err := tx.QueryRow(ctx, `select not exists(select 1 from account_movements where customer_id = $1)
					and not exists(select 1 from orders where customer_id = $1)
					and not exists(select 1 from quotes where customer_id = $1)`, *d.Liberar).Scan(&vacia); err != nil {
					return err
				}
				if vacia {
					_, err = tx.Exec(ctx, `update customers set user_id = null, active = false,
						notas = 'Ficha archivada al habilitar la cuenta profesional: se unió a la ficha con CUIT.', updated_at = now() where id = $1`, *d.Liberar)
				} else {
					_, err = tx.Exec(ctx, `update customers set user_id = null, updated_at = now() where id = $1`, *d.Liberar)
					advertencia = "Ojo: este cliente tenía dos fichas —la del mostrador y la que creó en el sitio— y la del sitio ya tiene movimientos. Revisá cuál conserva la cuenta corriente."
				}
				if err != nil {
					return err
				}
			}
			// Los datos de contacto de la solicitud son más nuevos, pero no
			// pisan el nombre (la ficha puede estar a nombre de la empresa).
			if _, err := tx.Exec(ctx, `update customers set tipo = 'profesional', rubro = $2, price_list_id = $3, limite_credito = $4,
				updated_at = now(), email = $5, telefono = $6, razon_social = coalesce($7, razon_social),
				user_id = case when $8 then $9 else user_id end
				where id = $1`, *d.Destino, sol.rubro, lista, limiteFijo, sol.email, sol.telefono, sol.razonSocial,
				d.VincularCuentaWeb, sol.userID); err != nil {
				return err
			}
			// El CUIT de la solicitud pasa a la ficha que no tenía (M2S1-020):
			// quedaba «CUIT —, Consumidor final» y se le facturaba B a quien
			// pidió la cuenta con CUIT. Solo si ninguna otra ficha lo tiene.
			if sol.cuit != nil && *sol.cuit != "" && porCuit == nil {
				if _, err := tx.Exec(ctx, `update customers c set cuit = $2 where c.id = $1 and (c.cuit is null or c.cuit = '')
					and not exists (select 1 from customers o where o.id <> c.id and o.cuit = any($3::text[]))`,
					*d.Destino, cuit.SoloDigitos(*sol.cuit), cuit.Variantes(*sol.cuit)); err != nil {
					return err
				}
			}
			if op.CondicionIva != "" {
				if _, err := tx.Exec(ctx, `update customers set condicion_iva = $2::condicion_iva where id = $1`, *d.Destino, op.CondicionIva); err != nil {
					return err
				}
			}
			customerID = *d.Destino
		} else {
			nombre := sol.nombre
			if sol.razonSocial != nil && *sol.razonSocial != "" {
				nombre = *sol.razonSocial
			}
			// Con CUIT factura A salvo que diga lo contrario; con DNI no hay
			// factura A posible: consumidor final.
			condicion := "consumidor_final"
			if sol.cuit != nil && *sol.cuit != "" {
				condicion = "responsable_inscripto"
			}
			// La elige quien aprueba (M3S2-092): un CUIT 27 de persona puede
			// ser monotributista, y antes quedaba inscripto sin que nadie lo
			// eligiera.
			if op.CondicionIva != "" {
				condicion = op.CondicionIva
			}
			if err := tx.QueryRow(ctx, `insert into customers (tipo, rubro, price_list_id, limite_credito, nombre, razon_social, cuit,
				condicion_iva, email, telefono, user_id, estado)
				values ('profesional', $1, $2, $3, $4, $5, $6, $7::condicion_iva, $8, $9, $10, 'activo')
				on conflict (user_id) do update set tipo = 'profesional', rubro = excluded.rubro, price_list_id = excluded.price_list_id,
					limite_credito = excluded.limite_credito, updated_at = now(), active = true, estado = 'activo'
				returning id`, sol.rubro, lista, limiteFijo, nombre, sol.razonSocial, sol.cuit, condicion, sol.email, sol.telefono, sol.userID).
				Scan(&customerID); err != nil {
				return err
			}
		}

		// El plazo de pago junto con el límite (M2S1-137: la ficha quedaba
		// «Paga a __ días»).
		if op.DiasCredito != nil {
			if _, err := tx.Exec(ctx, `update customers set dias_credito = $2 where id = $1`, customerID, *op.DiasCredito); err != nil {
				return err
			}
		}
		// La cuenta web: el rol (el personal conserva el suyo) y la lista, para
		// que el catálogo le muestre los precios nuevos apenas recargue.
		if sol.userID != nil {
			if _, err := tx.Exec(ctx, `update profiles set role = case when role = 'staff' then role else 'profesional' end,
				price_list_id = $2, updated_at = now() where user_id = $1`, *sol.userID, lista); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `update professional_applications set estado = 'aprobada', customer_id = $2, resuelto_por = $3,
			resuelto_at = now(), motivo_rechazo = null, updated_at = now() where id = $1`, sol.id, customerID, ses.UserID); err != nil {
			return err
		}
		if lista != nil {
			var n string
			if err := tx.QueryRow(ctx, `select name from price_lists where id = $1`, *lista).Scan(&n); err == nil {
				nombreLista = &n
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		return nil
	})
	if err != nil {
		// La solicitud queda pendiente y el profesional esperando: se dice en
		// pantalla y queda en el registro con el número de solicitud.
		s.log.Error("no se pudo aprobar la solicitud", "solicitud", sol.id, "error", err)
		return "", invalido(noSePudo)
	}

	descripcion := "Aprobó a " + sol.nombre
	if nombreLista != nil {
		descripcion += " con lista " + *nombreLista
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "profesional", sol.id, descripcion,
		// En el orden del TS ({ lista, limiteCredito }).
		struct {
			Lista         *string `json:"lista"`
			LimiteCredito float64 `json:"limiteCredito"`
		}{nombreLista, limite})

	s.enSegundoPlano(func(ctx context.Context) {
		s.avisos.Despachar(ctx, avisos.Despacho{Evento: "profesional_aprobado", Para: sol.email, EntidadTipo: "professional_application",
			EntidadID: sol.id, Correo: avisos.Correo(Bienvenida(s.sitio, PrimeraPalabra(sol.nombre), nombreLista, limite, enlace))})
	})

	m := sol.nombre + " quedó habilitado. Los precios le cambian apenas recargue."
	if enlace != "" {
		m = sol.nombre + " quedó habilitado. Como no tenía cuenta, le creamos una: mandale el link de acceso desde la lista de aprobados."
	}
	if advertencia != "" {
		m += " " + advertencia
	}
	return m, nil
}

// Rechazar rechaza con el motivo (va en el correo).
func (s *Servicio) Rechazar(ctx context.Context, ses *auth.Sesion, id, motivo string) error {
	if _, err := s.pool.Exec(ctx, `update professional_applications set estado = 'rechazada', motivo_rechazo = $2, resuelto_por = $3,
		resuelto_at = now(), updated_at = now() where id = $1`, id, motivo, ses.UserID); err != nil {
		return err
	}
	s.enSegundoPlano(func(ctx context.Context) {
		sol, err := s.leerSolicitud(ctx, s.pool, id)
		if err != nil || sol == nil {
			return
		}
		correo := Rechazo(s.sitio, PrimeraPalabra(sol.nombre), sol.motivo)
		evento := "profesional_rechazado"
		if sol.estado == "aprobada" {
			evento = "profesional_aprobado"
			correo = Bienvenida(s.sitio, PrimeraPalabra(sol.nombre), nil, 0, "")
		}
		s.avisos.Despachar(ctx, avisos.Despacho{Evento: evento, Para: sol.email, EntidadTipo: "professional_application",
			EntidadID: sol.id, Correo: avisos.Correo(correo)})
	})
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "profesional", id, "Rechazó una solicitud de cuenta profesional", nil)
	return nil
}

/* ------------------------------- lo público ------------------------------- */

// Solicitar guarda la solicitud de acceso (no habilita nada: la aprueba
// alguien del panel). Una pendiente por documento. Devuelve el mensaje.
func (s *Servicio) Solicitar(ctx context.Context, ses *auth.Sesion, f Solicitud) (string, error) {
	numero := cuit.SoloDigitos(f.DocumentoNumero)
	var cu, userID *string
	if f.DocumentoTipo == "cuit" {
		cu = &numero
	}
	if ses != nil {
		userID = &ses.UserID
	}
	// Una pendiente por documento. Si es de quien la manda (la misma cuenta
	// o el mismo correo), ya está; si es de otro, se dice: devolvía «Ya
	// tenemos tu solicitud» de una ajena y el formulario volvía al principio
	// sin que nada cambiara (mes 23).
	var pendiente, propia bool
	if err := s.pool.QueryRow(ctx, `select count(*) > 0,
		coalesce(bool_or(lower(email) = lower($2) or (user_id is not null and user_id = $3)), false)
		from professional_applications where documento_numero = $1 and estado = 'pendiente'`,
		numero, f.Email, userID).Scan(&pendiente, &propia); err != nil {
		return "", err
	}
	if pendiente && propia {
		return "Ya tenemos tu solicitud. Un asesor la está revisando.", nil
	}
	if pendiente {
		campo := "documentoNumero"
		return "", plataforma.Invalido(map[string]string{campo: "Ese documento ya tiene una solicitud en revisión. Si es tuya, escribinos por WhatsApp."})
	}
	var id string
	if err := s.pool.QueryRow(ctx, `insert into professional_applications (nombre, razon_social, documento_tipo, documento_numero, cuit,
		email, telefono, rubro, volumen_estimado, red_social, mensaje, user_id)
		values ($1, $2, $3::tipo_documento, $4, $5, $6, $7, $8::rubro_profesional, $9, $10, $11, $12) returning id`,
		f.Nombre, f.RazonSocial, f.DocumentoTipo, numero, cu, f.Email, f.Telefono, f.Rubro, f.VolumenEstimado, f.RedSocial, f.Mensaje, userID).
		Scan(&id); err != nil {
		return "", err
	}
	s.enSegundoPlano(func(ctx context.Context) {
		s.avisos.Despachar(ctx, avisos.Despacho{Evento: "solicitud_profesional", Para: f.Email, EntidadTipo: "professional_application",
			EntidadID: id, Correo: avisos.Correo(AcuseDeRecibo(s.sitio, PrimeraPalabra(f.Nombre)))})
	})
	// Sin plazo, como «Cómo funciona»: nadie confirmó las 24 horas (M2S1-201).
	return "Recibimos tu solicitud. Un asesor la va a revisar.", nil
}

// SolicitudEnCurso es la última solicitud de quien mira.
type SolicitudEnCurso struct {
	ID            string    `json:"id"`
	Estado        string    `json:"estado"`
	MotivoRechazo *string   `json:"motivoRechazo"`
	CreatedAt     time.Time `json:"createdAt"`
}

// EstadoProfesional es en qué situación está quien mira (estadoProfesional
// del TS). La verdad sobre si es profesional está en la ficha, no en la
// solicitud: un vendedor puede marcarlo desde el mostrador.
type EstadoProfesional struct {
	Aprobado      bool              `json:"aprobado"`
	CustomerID    *string           `json:"customerId"`
	Nombre        *string           `json:"nombre"`
	PriceListID   *string           `json:"priceListId"`
	NombreLista   *string           `json:"nombreLista"`
	LimiteCredito float64           `json:"limiteCredito"`
	Solicitud     *SolicitudEnCurso `json:"solicitud"`
}

// Estado es EstadoProfesional para la sesión (vacío sin sesión).
func (s *Servicio) Estado(ctx context.Context, ses *auth.Sesion) (EstadoProfesional, error) {
	var e EstadoProfesional
	if ses == nil {
		return e, nil
	}
	var cliente struct {
		id, nombre, tipo, estado string
		lista, nombreLista       *string
		limite                   jsmath.Num
	}
	err := s.pool.QueryRow(ctx, `select c.id, c.nombre, c.tipo::text, c.estado::text, c.price_list_id, pl.name, c.limite_credito
		from customers c left join price_lists pl on pl.id = c.price_list_id
		where c.user_id = $1 and c.active limit 1`, ses.UserID).
		Scan(&cliente.id, &cliente.nombre, &cliente.tipo, &cliente.estado, &cliente.lista, &cliente.nombreLista, &cliente.limite)
	hayCliente := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return e, err
	}
	var sol SolicitudEnCurso
	q := `select id, estado::text, motivo_rechazo, created_at from professional_applications where user_id = $1`
	args := []any{ses.UserID}
	if hayCliente {
		q += ` or customer_id = $2`
		args = append(args, cliente.id)
	}
	err = s.pool.QueryRow(ctx, q+` order by created_at desc limit 1`, args...).Scan(&sol.ID, &sol.Estado, &sol.MotivoRechazo, &sol.CreatedAt)
	if err == nil {
		e.Solicitud = &sol
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return e, err
	}
	if !hayCliente {
		return e, nil
	}
	e.Aprobado = cliente.tipo == "profesional" && cliente.estado != "inactivo"
	e.CustomerID, e.Nombre = &cliente.id, &cliente.nombre
	e.PriceListID, e.NombreLista = cliente.lista, cliente.nombreLista
	e.LimiteCredito = cliente.limite.F()
	return e, nil
}

// EnlaceDeAcceso arma un link de activación nuevo para un profesional
// aprobado, para mandárselo por WhatsApp desde el panel. **Solo para cuentas
// sin clave** (las que creó la aprobación): con una cuenta que ya tiene
// contraseña, un link que viaja al teléfono de la solicitud sería una forma
// de entrar a una cuenta ajena. Esa persona entra con su clave o pide su link
// por correo.
func (s *Servicio) EnlaceDeAcceso(ctx context.Context, ses *auth.Sesion, id string) (url, nombre, telefono string, err error) {
	sol, err := s.leerSolicitud(ctx, s.pool, id)
	if err != nil {
		return "", "", "", err
	}
	if sol == nil || sol.estado != "aprobada" {
		return "", "", "", invalido("Esa solicitud no está aprobada.")
	}
	if sol.userID == nil {
		return "", "", "", invalido("Esta solicitud no tiene cuenta web: el correo ya tenía una. Que entre con su correo, o que pida un link desde «Ingresar».")
	}
	// Solo para la cuenta que creó esta misma aprobación: el link viaja al
	// teléfono de la solicitud, y una solicitud con el correo de otra persona
	// no puede llevarse un acceso a su cuenta.
	var creada bool
	if err := s.pool.QueryRow(ctx, `select cuenta_creada from professional_applications where id = $1`, sol.id).Scan(&creada); err != nil {
		return "", "", "", err
	}
	if !creada {
		return "", "", "", invalido("Esta cuenta no la creó la aprobación: que entre con su correo, o que pida un link desde «Ingresar».")
	}
	var conClave bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from account where user_id = $1 and password is not null)`, *sol.userID).
		Scan(&conClave); err != nil {
		return "", "", "", err
	}
	if conClave {
		return "", "", "", invalido("Esta cuenta ya tiene contraseña: que entre con su correo, o que pida un link desde «Ingresar».")
	}
	token, err := auth.NuevoEnlace(ctx, s.pool, *sol.userID, auth.EnlaceActivacion, auth.VenceActivacion, s.ahora())
	if err != nil {
		return "", "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "profesional", sol.id, "Generó un link de acceso para "+sol.nombre, nil)
	return strings.TrimSuffix(s.sitio, "/") + "/entrar/" + token, sol.nombre, sol.telefono, nil
}

// Aprobacion es lo que elige quien aprueba además de la lista y el límite.
type Aprobacion struct {
	// CondicionIva: la condición frente al IVA de la ficha. Vacía, la de
	// antes (inscripto con CUIT en una ficha nueva; la existente no cambia).
	CondicionIva string
	// DiasCredito: a cuántos días paga. Nil, el de la ficha.
	DiasCredito *int
}

// CondicionesIva son las de condicion_iva.
var CondicionesIva = []string{"responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"}

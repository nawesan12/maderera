// Package portal es «Mi cuenta» del sitio: la ficha del cliente de la
// sesión, sus pedidos y presupuestos, sus datos y sus direcciones
// (lib/dal/cuenta.ts y app/(public)/mi-cuenta/actions.ts). Todo se filtra por
// la ficha del usuario de la sesión, nunca por un id que mande el navegador.
package portal

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/plataforma"
)

// Servicio son las lecturas y acciones del portal.
type Servicio struct{ pool *pgxpool.Pool }

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool) *Servicio { return &Servicio{pool: pool} }

// Cliente es la ficha del usuario de la sesión (clienteDeLaSesion).
type Cliente struct {
	ID            string  `json:"id"`
	Nombre        string  `json:"nombre"`
	RazonSocial   *string `json:"razonSocial"`
	Cuit          *string `json:"cuit"`
	CondicionIva  string  `json:"condicionIva"`
	Email         *string `json:"email"`
	Telefono      *string `json:"telefono"`
	Direccion     *string `json:"direccion"`
	Tipo          string  `json:"tipo"`
	Estado        string  `json:"estado"`
	LimiteCredito float64 `json:"limiteCredito"`
}

// ClienteDe es la ficha activa del usuario, o nil.
func (s *Servicio) ClienteDe(ctx context.Context, usuario string) (*Cliente, error) {
	var c Cliente
	err := s.pool.QueryRow(ctx, `SELECT id, nombre, razon_social, cuit, condicion_iva::text, email, telefono, direccion, tipo::text,
		estado::text, limite_credito::float8 FROM customers WHERE user_id = $1 AND active LIMIT 1`, usuario).
		Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Email, &c.Telefono, &c.Direccion, &c.Tipo, &c.Estado, &c.LimiteCredito)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// Resumen es lo de arriba de «Mi cuenta».
type Resumen struct {
	PedidosEnCurso         int     `json:"pedidosEnCurso"`
	PresupuestosAResponder int     `json:"presupuestosAResponder"`
	Saldo                  float64 `json:"saldo"`
	LimiteCredito          float64 `json:"limiteCredito"`
}

// ResumenDe es resumenCuenta.
func (s *Servicio) ResumenDe(ctx context.Context, c *Cliente) (Resumen, error) {
	r := Resumen{LimiteCredito: c.LimiteCredito}
	err := s.pool.QueryRow(ctx, `SELECT
		(SELECT count(*)::int FROM orders WHERE customer_id = $1 AND estado NOT IN ('entregado', 'cancelado')),
		(SELECT count(*)::int FROM quotes WHERE customer_id = $1 AND estado = 'enviado'),
		(SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE customer_id = $1)`, c.ID).
		Scan(&r.PedidosEnCurso, &r.PresupuestosAResponder, &r.Saldo)
	return r, err
}

// Pedido es un renglón de «Mis pedidos».
type Pedido struct {
	ID          string    `json:"id"`
	Numero      string    `json:"numero"`
	Estado      string    `json:"estado"`
	EstadoPago  string    `json:"estadoPago"`
	TipoEntrega string    `json:"tipoEntrega"`
	Total       float64   `json:"total"`
	Items       int       `json:"items"`
	Sucursal    *string   `json:"sucursal"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Pedidos es misPedidos: los más nuevos primero.
func (s *Servicio) Pedidos(ctx context.Context, c *Cliente) ([]Pedido, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.estado::text, o.estado_pago::text, o.tipo_entrega::text, o.total::float8,
		  (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id), b.name, o.created_at
		FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.customer_id = $1 ORDER BY o.created_at DESC`, c.ID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Pedido])
}

// Presupuesto es un renglón de «Mis presupuestos».
type Presupuesto struct {
	ID          string     `json:"id"`
	Numero      string     `json:"numero"`
	Estado      string     `json:"estado"`
	Total       float64    `json:"total"`
	Items       int        `json:"items"`
	ValidoHasta *time.Time `json:"validoHasta"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// Presupuestos es misPresupuestos.
func (s *Servicio) Presupuestos(ctx context.Context, c *Cliente) ([]Presupuesto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT q.id, q.numero, q.estado::text, q.total::float8, (SELECT count(*)::int FROM quote_items i WHERE i.quote_id = q.id),
		  q.valido_hasta, q.created_at
		FROM quotes q WHERE q.customer_id = $1 ORDER BY q.created_at DESC`, c.ID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Presupuesto])
}

// RenglonDePresupuesto es una fila de quote_items, como la daba drizzle
// (los importes como texto).
type RenglonDePresupuesto struct {
	ID             string  `json:"id"`
	QuoteID        string  `json:"quoteId"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       string  `json:"cantidad"`
	PrecioUnitario string  `json:"precioUnitario"`
	Subtotal       string  `json:"subtotal"`
	Notas          *string `json:"notas"`
	Orden          int32   `json:"orden"`
	Presentacion   *string `json:"presentacion"`
}

// DetalleDePresupuesto es miPresupuesto.
type DetalleDePresupuesto struct {
	ID          string                 `json:"id"`
	Numero      string                 `json:"numero"`
	Estado      string                 `json:"estado"`
	Subtotal    string                 `json:"subtotal"`
	Total       string                 `json:"total"`
	Notas       *string                `json:"notas"`
	Asesor      *string                `json:"asesor"`
	ValidoHasta *time.Time             `json:"validoHasta"`
	Sucursal    *string                `json:"sucursal"`
	CreatedAt   time.Time              `json:"createdAt"`
	Items       []RenglonDePresupuesto `json:"items"`
}

// ErrNoEsta es un presupuesto o una dirección que no es de este cliente.
var ErrNoEsta = errors.New("no está")

// PresupuestoDe es miPresupuesto: uno del cliente, por número.
func (s *Servicio) PresupuestoDe(ctx context.Context, c *Cliente, numero string) (*DetalleDePresupuesto, error) {
	var p DetalleDePresupuesto
	err := s.pool.QueryRow(ctx, `SELECT q.id, q.numero, q.estado::text, q.subtotal::text, q.total::text, q.notas, q.asesor, q.valido_hasta,
		b.name, q.created_at FROM quotes q LEFT JOIN branches b ON b.id = q.branch_id
		WHERE q.numero = $1 AND q.customer_id = $2`, numero, c.ID).
		Scan(&p.ID, &p.Numero, &p.Estado, &p.Subtotal, &p.Total, &p.Notas, &p.Asesor, &p.ValidoHasta, &p.Sucursal, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `SELECT id, quote_id, variant_id, descripcion, unidad, cantidad::text, precio_unitario::text,
		subtotal::text, notas, orden, presentacion FROM quote_items WHERE quote_id = $1 ORDER BY orden`, p.ID)
	if err != nil {
		return nil, err
	}
	p.Items, err = pgx.CollectRows(filas, pgx.RowToStructByPos[RenglonDePresupuesto])
	return &p, err
}

// Responder acepta o rechaza un presupuesto que está esperando respuesta.
func (s *Servicio) Responder(ctx context.Context, c *Cliente, numero, respuesta string) (string, error) {
	numero = strings.TrimSpace(numero)
	if numero == "" || (respuesta != "aceptado" && respuesta != "rechazado") {
		return "", plataforma.Invalido(map[string]string{"respuesta": "No pudimos guardar tu respuesta. Probá de nuevo."})
	}
	tag, err := s.pool.Exec(ctx, `UPDATE quotes SET estado = $1::estado_presupuesto, updated_at = now()
		WHERE numero = $2 AND customer_id = $3 AND estado = 'enviado'`, respuesta, numero, c.ID)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", plataforma.Invalido(map[string]string{"numero": "Ese presupuesto ya no está esperando respuesta. Escribinos y lo vemos."})
	}
	if respuesta == "aceptado" {
		return "Listo, avisamos al vendedor. Te contactamos para coordinar la entrega.", nil
	}
	return "Anotado. Si querés cambiar algo, escribinos y armamos otro.", nil
}

// FormDatos son «Mis datos», como texto.
type FormDatos struct{ Nombre, Telefono, RazonSocial, Cuit, CondicionIva string }

var reCuit = regexp.MustCompile(`^\d{2}-?\d{8}-?\d$`)
var noDigito = regexp.MustCompile(`\D`)

func mal(campo, m string) error { return plataforma.Invalido(map[string]string{campo: m}) }

func opcional(campo, v string, max int) (*string, error) {
	t := strings.TrimSpace(v)
	if plataforma.LargoJS(t) > max {
		return nil, mal(campo, "Too big: expected string to have <="+strconv.Itoa(max)+" characters")
	}
	if t == "" {
		return nil, nil
	}
	return &t, nil
}

// GuardarDatos es guardarMisDatos: la ficha y el perfil, juntos.
func (s *Servicio) GuardarDatos(ctx context.Context, usuario string, c *Cliente, f FormDatos) error {
	nombre := strings.TrimSpace(f.Nombre)
	switch {
	case plataforma.LargoJS(nombre) < 2:
		return mal("nombre", "Escribí tu nombre.")
	case plataforma.LargoJS(nombre) > 120:
		return mal("nombre", "Too big: expected string to have <=120 characters")
	}
	telefono, err := opcional("telefono", f.Telefono, 40)
	if err != nil {
		return err
	}
	razon, err := opcional("razonSocial", f.RazonSocial, 160)
	if err != nil {
		return err
	}
	cuitTexto, err := opcional("cuit", f.Cuit, 20)
	if err != nil {
		return err
	}
	if cuitTexto != nil && !reCuit.MatchString(*cuitTexto) {
		return mal("cuit", "El CUIT tiene que tener 11 dígitos, con o sin guiones.")
	}
	switch f.CondicionIva {
	case "responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado":
	default:
		return mal("condicionIva", `Invalid option: expected one of "responsable_inscripto"|"monotributista"|"exento"|"consumidor_final"|"no_categorizado"`)
	}
	var cuit *string
	if cuitTexto != nil {
		d := noDigito.ReplaceAllString(*cuitTexto, "")
		cuit = &d
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE customers SET nombre = $1, telefono = $2, razon_social = $3, cuit = $4,
			condicion_iva = $5::condicion_iva, updated_at = now() WHERE id = $6`, nombre, telefono, razon, cuit, f.CondicionIva, c.ID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `UPDATE profiles SET telefono = $1, razon_social = $2, cuit = $3, condicion_iva = $4::condicion_iva,
			updated_at = now() WHERE user_id = $5`, telefono, razon, cuit, f.CondicionIva, usuario)
		return err
	})
}

// Direccion es una dirección de entrega del cliente.
type Direccion struct {
	ID             string    `json:"id"`
	CustomerID     string    `json:"customerId"`
	Etiqueta       string    `json:"etiqueta"`
	Calle          string    `json:"calle"`
	Localidad      string    `json:"localidad"`
	CodigoPostal   *string   `json:"codigoPostal"`
	Notas          *string   `json:"notas"`
	Predeterminada bool      `json:"predeterminada"`
	CreatedAt      time.Time `json:"createdAt"`
}

// Direcciones es misDirecciones: la predeterminada primero.
func (s *Servicio) Direcciones(ctx context.Context, c *Cliente) ([]Direccion, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, customer_id, etiqueta, calle, localidad, codigo_postal, notas, predeterminada, created_at
		FROM addresses WHERE customer_id = $1 ORDER BY predeterminada DESC, etiqueta`, c.ID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Direccion])
}

// FormDireccion es una dirección, como texto.
type FormDireccion struct {
	ID, Etiqueta, Calle, Localidad, CodigoPostal, Notas string
	Predeterminada                                      bool
}

// GuardarDireccion la da de alta o la edita (solo una propia). La primera
// queda predeterminada; marcar una predeterminada desmarca las demás.
func (s *Servicio) GuardarDireccion(ctx context.Context, c *Cliente, f FormDireccion) error {
	if f.ID != "" && !plataforma.UUIDValido(f.ID) {
		return mal("id", "Invalid UUID")
	}
	etiqueta, calle, localidad := strings.TrimSpace(f.Etiqueta), strings.TrimSpace(f.Calle), strings.TrimSpace(f.Localidad)
	switch {
	case plataforma.LargoJS(etiqueta) < 2:
		return mal("etiqueta", "Poné un nombre para reconocerla: Casa, Obra Alem…")
	case plataforma.LargoJS(etiqueta) > 60:
		return mal("etiqueta", "Too big: expected string to have <=60 characters")
	case plataforma.LargoJS(calle) < 4:
		return mal("calle", "Escribí la calle y la altura.")
	case plataforma.LargoJS(calle) > 200:
		return mal("calle", "Too big: expected string to have <=200 characters")
	case plataforma.LargoJS(localidad) < 2:
		return mal("localidad", "Falta la localidad.")
	case plataforma.LargoJS(localidad) > 80:
		return mal("localidad", "Too big: expected string to have <=80 characters")
	}
	cp, err := opcional("codigoPostal", f.CodigoPostal, 12)
	if err != nil {
		return err
	}
	notas, err := opcional("notas", f.Notas, 300)
	if err != nil {
		return err
	}
	var cuantas int
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM addresses WHERE customer_id = $1`, c.ID).Scan(&cuantas); err != nil {
		return err
	}
	predeterminada := f.Predeterminada || cuantas == 0
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		id := f.ID
		if id != "" {
			tag, err := tx.Exec(ctx, `UPDATE addresses SET etiqueta = $1, calle = $2, localidad = $3, codigo_postal = $4, notas = $5,
				predeterminada = $6 WHERE id = $7 AND customer_id = $8`, etiqueta, calle, localidad, cp, notas, predeterminada, id, c.ID)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return ErrNoEsta
			}
		} else if err := tx.QueryRow(ctx, `INSERT INTO addresses (customer_id, etiqueta, calle, localidad, codigo_postal, notas, predeterminada)
			VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`, c.ID, etiqueta, calle, localidad, cp, notas, predeterminada).Scan(&id); err != nil {
			return err
		}
		if predeterminada {
			_, err := tx.Exec(ctx, `UPDATE addresses SET predeterminada = false WHERE customer_id = $1 AND id <> $2`, c.ID, id)
			return err
		}
		return nil
	})
	if errors.Is(err, ErrNoEsta) {
		return mal("id", "No encontramos esa dirección.")
	}
	return err
}

// BorrarDireccion borra una propia (una ajena, nada).
func (s *Servicio) BorrarDireccion(ctx context.Context, c *Cliente, id string) error {
	if !plataforma.UUIDValido(id) {
		return mal("id", "No encontramos esa dirección.")
	}
	_, err := s.pool.Exec(ctx, `DELETE FROM addresses WHERE id = $1 AND customer_id = $2`, id, c.ID)
	return err
}

// Package portal es «Mi cuenta» del sitio: la ficha del cliente de la
// sesión, sus pedidos y presupuestos, sus datos y sus direcciones
// (lib/dal/cuenta.ts y app/(public)/mi-cuenta/actions.ts). Todo se filtra por
// la ficha del usuario de la sesión, nunca por un id que mande el navegador.
package portal

import (
	"context"
	"errors"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/clientes"
	"mjbj/internal/cuit"
	"mjbj/internal/formato"
	"mjbj/internal/plataforma"
	"mjbj/internal/push"
	"mjbj/internal/sqlc"
)

// Servicio son las lecturas y acciones del portal.
type Servicio struct {
	pool *pgxpool.Pool
	push *push.Avisador
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool) *Servicio { return &Servicio{pool: pool} }

// ConAvisos le da con qué avisarle al panel (un presupuesto aceptado).
func (s *Servicio) ConAvisos(p *push.Avisador) *Servicio {
	s.push = p
	return s
}

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
	// DatosFiscalesFijos: la ficha ya facturó o mueve cuenta corriente. El
	// CUIT, la razón social y la condición frente al IVA deciden el tipo de
	// comprobante (A o B), así que desde ahí los cambia la casa, no el
	// cliente con un clic (mes simulado, H079).
	DatosFiscalesFijos bool `json:"datosFiscalesFijos"`
	// Vinculada: la ficha existía antes que la cuenta web (la abrió el
	// mostrador o vino de ISIS), o el local le ató la cuenta web después. A
	// esa no se le ofrece «vincular» (H090). El vínculo hecho desde el panel
	// se lee de la bitácora: la ficha del mostrador puede ser más nueva que
	// la cuenta web, y por la fecha sola se seguía ofreciendo.
	Vinculada bool `json:"vinculada"`
	// Lista es el nombre de la lista de precios propia, si tiene una.
	Lista *string `json:"lista"`
}

// ClienteDe es la ficha activa del usuario, o nil.
func (s *Servicio) ClienteDe(ctx context.Context, usuario string) (*Cliente, error) {
	var c Cliente
	err := s.pool.QueryRow(ctx, `SELECT c.id, c.nombre, c.razon_social, c.cuit, c.condicion_iva::text, c.email, c.telefono, c.direccion,
		  c.tipo::text, c.estado::text, c.limite_credito::float8,
		  c.limite_credito > 0
		    OR EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id AND i.estado <> 'borrador')
		    OR EXISTS (SELECT 1 FROM account_movements m WHERE m.customer_id = c.id),
		  c.codigo_legacy IS NOT NULL OR c.created_at < u.created_at - interval '1 minute'
		    OR EXISTS (SELECT 1 FROM audit_log a WHERE a.entidad = 'cliente' AND a.entidad_id = c.id::text
		      AND a.descripcion = '`+clientes.DescripcionDeVinculo+`'),
		  CASE WHEN l.is_default THEN NULL ELSE l.name END
		FROM customers c JOIN "user" u ON u.id = c.user_id LEFT JOIN price_lists l ON l.id = c.price_list_id
		WHERE c.user_id = $1 AND c.active LIMIT 1`, usuario).
		Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Email, &c.Telefono, &c.Direccion, &c.Tipo, &c.Estado, &c.LimiteCredito,
			&c.DatosFiscalesFijos, &c.Vinculada, &c.Lista)
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
	MedioPago   *string   `json:"medioPago"`
	TipoEntrega string    `json:"tipoEntrega"`
	Total       float64   `json:"total"`
	Items       int       `json:"items"`
	Sucursal    *string   `json:"sucursal"`
	EnAcopio    bool      `json:"enAcopio"`
	CreatedAt   time.Time `json:"createdAt"`
	// EnRevision es lo informado que falta verificar (las transferencias
	// con comprobante): la lista decía «Falta abonarlo» y el detalle
	// «Verificando tu pago».
	EnRevision *float64 `json:"enRevision"`
	// DebeEnCuenta es lo que falta pagar de un pedido a cuenta corriente,
	// con los pagos imputados a la deuda más vieja (Imputar). Nil si el
	// pedido no se cargó a la cuenta.
	DebeEnCuenta *float64 `json:"debeEnCuenta" db:"-"`
}

// Pedidos es misPedidos: los más nuevos primero.
//
// Una venta del mostrador anulada sin remito ni factura no se lista: casi
// siempre es una venta cargada al cliente equivocado, y mostrársela le decía
// a quién se le había vendido (H386). Su detalle se sigue abriendo por número
// (la nota de crédito que la cancela lo enlaza). Solo la del mostrador: un
// pedido cancelado que salió de un presupuesto o se tomó por teléfono es del
// cliente y sigue en su lista (H310).
//
// «En acopio» es que ya retiró algo y todavía le queda: con un remito vivo y
// algún renglón con saldo (lo mismo que entregas.SaldoDeAcopio).
func (s *Servicio) Pedidos(ctx context.Context, c *Cliente) ([]Pedido, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT o.id, o.numero, o.estado::text, o.estado_pago::text, o.medio_pago::text, o.tipo_entrega::text, o.total::float8,
		  (SELECT count(*)::int FROM order_items i WHERE i.order_id = o.id), b.name,
		  o.estado NOT IN ('entregado', 'cancelado') AND EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada')
		    AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND NOT (oi.variant_id IS NULL AND oi.del_corte)
		      AND oi.cantidad - coalesce((SELECT sum(di.del_acopio) FROM devolucion_items di WHERE di.order_item_id = oi.id), 0)
		        - coalesce((SELECT sum(di.cantidad) FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id
		                    WHERE di.order_item_id = oi.id AND d.estado <> 'anulada'), 0) > 0.01),
		  o.created_at,
		  (SELECT nullif(sum(pr.monto), 0)::float8 FROM payments pr WHERE pr.order_id = o.id AND pr.estado = 'en_revision')
		FROM orders o LEFT JOIN branches b ON b.id = o.branch_id
		WHERE o.customer_id = $1
		  AND NOT (o.estado = 'cancelado' AND o.origen = 'mostrador' AND o.quote_id IS NULL
		    AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.order_id = o.id AND d.estado <> 'anulada')
		    AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id AND i.estado <> 'borrador'))
		ORDER BY o.created_at DESC`, c.ID)
	if err != nil {
		return nil, err
	}
	pedidos, err := pgx.CollectRows(filas, pgx.RowToStructByPos[Pedido])
	if err != nil {
		return nil, err
	}
	debe, err := s.pendientesDeLaCuenta(ctx, c)
	if err != nil {
		return nil, err
	}
	for i := range pedidos {
		if v, ok := debe[pedidos[i].Numero]; ok {
			pedidos[i].DebeEnCuenta = &v
		}
	}
	return pedidos, nil
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

// Presupuestos es misPresupuestos. Los que armó el bot de WhatsApp y todavía
// no revisó nadie no aparecen: llevan precios que no miró una persona.
func (s *Servicio) Presupuestos(ctx context.Context, c *Cliente) ([]Presupuesto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT q.id, q.numero, q.estado::text, q.total::float8, (SELECT count(*)::int FROM quote_items i WHERE i.quote_id = q.id),
		  q.valido_hasta, q.created_at
		FROM quotes q WHERE q.customer_id = $1 AND NOT (q.origen = 'whatsapp' AND q.estado = 'revision')
		ORDER BY q.created_at DESC`, c.ID)
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
	// Pedido es el número del pedido que salió de este presupuesto, si ya
	// se hizo (H215).
	Pedido *string `json:"pedido"`
}

// ErrNoEsta es un presupuesto o una dirección que no es de este cliente.
var ErrNoEsta = errors.New("no está")

// PresupuestoDe es miPresupuesto: uno del cliente, por número.
func (s *Servicio) PresupuestoDe(ctx context.Context, c *Cliente, numero string) (*DetalleDePresupuesto, error) {
	var p DetalleDePresupuesto
	err := s.pool.QueryRow(ctx, `SELECT q.id, q.numero, q.estado::text, q.subtotal::text, q.total::text, q.notas, q.asesor, q.valido_hasta,
		b.name, q.created_at,
		(SELECT o.numero FROM orders o WHERE o.quote_id = q.id AND o.customer_id = q.customer_id AND o.estado <> 'cancelado'
		 ORDER BY o.created_at DESC LIMIT 1)
		FROM quotes q LEFT JOIN branches b ON b.id = q.branch_id
		WHERE q.numero = $1 AND q.customer_id = $2 AND NOT (q.origen = 'whatsapp' AND q.estado = 'revision')`, numero, c.ID).
		Scan(&p.ID, &p.Numero, &p.Estado, &p.Subtotal, &p.Total, &p.Notas, &p.Asesor, &p.ValidoHasta, &p.Sucursal, &p.CreatedAt, &p.Pedido)
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
	var id string
	var total float64
	err := s.pool.QueryRow(ctx, `UPDATE quotes SET estado = $1::estado_presupuesto, updated_at = now()
		WHERE numero = $2 AND customer_id = $3 AND estado = 'enviado' RETURNING id, total::float8`, respuesta, numero, c.ID).Scan(&id, &total)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.Invalido(map[string]string{"numero": "Ese presupuesto ya no está esperando respuesta. Escribinos y lo vemos."})
	}
	if err != nil {
		return "", err
	}
	if respuesta == "aceptado" {
		// Que alguien de la casa se entere sin abrir la lista (H215).
		if s.push != nil {
			go s.push.Avisar(context.WithoutCancel(ctx), push.Aviso{
				Titulo: "Presupuesto aceptado · " + numero, Cuerpo: c.Nombre + " aceptó " + formato.Importe(total) + " desde Mi cuenta.",
				URL: "/admin/presupuestos/" + id, Pantalla: "/admin/presupuestos", Etiqueta: "presupuesto_aceptado",
			})
		}
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
//
// El CUIT se verifica con el dígito verificador (internal/cuit), no solo el
// formato: la ficha alimenta la factura, y uno mal tipeado la hace rebotar en
// ARCA (H078). Con los datos fiscales fijos (ver Cliente.DatosFiscalesFijos)
// el cliente cambia su nombre y su teléfono, y lo fiscal lo cambia la casa;
// si todavía no facturó, puede cambiarlo, y queda en la bitácora (H079).
func (s *Servicio) GuardarDatos(ctx context.Context, ses *auth.Sesion, c *Cliente, f FormDatos) error {
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
	condicion := f.CondicionIva
	if c.DatosFiscalesFijos {
		// El formulario no los manda: se quedan los de la ficha. Si llegan
		// distintos (un formulario viejo, o a mano), no se pisan en silencio.
		if (f.RazonSocial != "" && texto(razon) != texto(c.RazonSocial)) ||
			(f.Cuit != "" && cuit.SoloDigitos(texto(cuitTexto)) != texto(c.Cuit)) ||
			(condicion != "" && condicion != c.CondicionIva) {
			return mal("cuit", "Tus datos para facturar los cambiamos desde el local. Escribinos.")
		}
		razon, cuitTexto, condicion = c.RazonSocial, c.Cuit, c.CondicionIva
	} else {
		if cuitTexto != nil && (!reCuit.MatchString(*cuitTexto) || !cuit.Valido(*cuitTexto)) {
			if !reCuit.MatchString(*cuitTexto) {
				return mal("cuit", "El CUIT tiene que tener 11 dígitos, con o sin guiones.")
			}
			return mal("cuit", "El CUIT no es válido: revisá los números.")
		}
		switch condicion {
		case "responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado":
		default:
			return mal("condicionIva", `Invalid option: expected one of "responsable_inscripto"|"monotributista"|"exento"|"consumidor_final"|"no_categorizado"`)
		}
	}
	var elCuit *string
	if cuitTexto != nil {
		d := noDigito.ReplaceAllString(*cuitTexto, "")
		elCuit = &d
	}
	cambioFiscal := texto(razon) != texto(c.RazonSocial) || texto(elCuit) != texto(c.Cuit) || condicion != c.CondicionIva
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE customers SET nombre = $1, telefono = $2, razon_social = $3, cuit = $4,
			condicion_iva = $5::condicion_iva, updated_at = now() WHERE id = $6`, nombre, telefono, razon, elCuit, condicion, c.ID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE profiles SET telefono = $1, razon_social = $2, cuit = $3, condicion_iva = $4::condicion_iva,
			updated_at = now() WHERE user_id = $5`, telefono, razon, elCuit, condicion, ses.UserID); err != nil {
			return err
		}
		if cambioFiscal {
			bitacora.Anotar(ctx, sqlc.New(tx), slog.Default(), ses, sqlc.AccionAuditoriaEditar, "cliente", c.ID,
				"El cliente cambió sus datos fiscales desde Mi cuenta", map[string]any{
					"antes":   map[string]any{"razonSocial": c.RazonSocial, "cuit": c.Cuit, "condicionIva": c.CondicionIva},
					"despues": map[string]any{"razonSocial": razon, "cuit": elCuit, "condicionIva": condicion},
				})
		}
		return nil
	})
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
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

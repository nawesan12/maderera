package entregas

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
)

func sprintf(f string, a ...any) string { return fmt.Sprintf(f, a...) }
func fijo2(x float64) string            { return jsmath.ToFixed(x, 2) }
func numeroJS(s string) float64         { return jsmath.Numero(s) }

// direcciones son las de las fichas publicadas de lib/sucursales.ts (commit
// 3f7910e): la dirección del remito sale de ahí, no de la fila de la
// sucursal. Datos fijos en código, como en el TS.
var direcciones = map[string]string{
	"casa-central": "Av. Juan B. Justo 4153, Mar del Plata",
	"aserradero":   "Diagonal Canosa 61, Mar del Plata",
}

// LineaDelRemito es un renglón que salió con el remito.
type LineaDelRemito struct {
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Cantidad    float64 `json:"cantidad"`
}

// PendienteDelRemito es lo que quedaba en acopio.
type PendienteDelRemito struct {
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Pendiente   float64 `json:"pendiente"`
}

// FacturaDelRemito es la factura con la que viaja la mercadería.
type FacturaDelRemito struct {
	Etiqueta       string     `json:"etiqueta"`
	Cae            *string    `json:"cae"`
	CaeVencimiento *time.Time `json:"caeVencimiento"`
}

// RemitoCompleto es RemitoCompleto de lib/dal/admin/entregas.ts.
type RemitoCompleto struct {
	ID                string               `json:"id"`
	Numero            string               `json:"numero"`
	Tipo              string               `json:"tipo"`
	Estado            string               `json:"estado"`
	ReceptorNombre    *string              `json:"receptorNombre"`
	ReceptorDocumento *string              `json:"receptorDocumento"`
	FirmaURL          *string              `json:"firmaUrl"`
	FirmadoAt         *time.Time           `json:"firmadoAt"`
	Notas             *string              `json:"notas"`
	CreatedAt         time.Time            `json:"createdAt"`
	PedidoNumero      string               `json:"pedidoNumero"`
	PedidoID          string               `json:"pedidoId"`
	ClienteNombre     string               `json:"clienteNombre"`
	ClienteDireccion  *string              `json:"clienteDireccion"`
	CustomerID        *string              `json:"customerId"`
	EstadoPago        string               `json:"estadoPago"`
	MedioPago         *string              `json:"medioPago"`
	Sucursal          *string              `json:"sucursal"`
	SucursalDireccion *string              `json:"sucursalDireccion"`
	Transportista     *string              `json:"transportista"`
	NumeroSeguimiento *string              `json:"numeroSeguimiento"`
	Lineas            []LineaDelRemito     `json:"lineas"`
	Pendientes        []PendienteDelRemito `json:"pendientes"`
	Factura           *FacturaDelRemito    `json:"factura"`
}

// nombreComprobante es el de lib/fiscal/comprobantes.ts.
func nombreComprobante(tipo string) string {
	letra := strings.ToUpper(tipo[len(tipo)-1:])
	switch {
	case strings.HasPrefix(tipo, "nota_credito"):
		return "Nota de crédito " + letra
	case strings.HasPrefix(tipo, "nota_debito"):
		return "Nota de débito " + letra
	}
	return "Factura " + letra
}

// RemitoCompleto lee un remito para imprimirlo o mostrarlo. No mira la
// sesión: cada pantalla decide antes quién lo ve.
func (s *Servicio) RemitoCompleto(ctx context.Context, id string) (*RemitoCompleto, error) {
	if !plataforma.UUIDValido(id) {
		return nil, ErrNoEsta
	}
	var r RemitoCompleto
	var slug *string
	err := s.pool.QueryRow(ctx, `
		SELECT d.id, d.numero, d.tipo::text, d.estado::text, d.receptor_nombre, d.receptor_documento, d.firma_url, d.firmado_at,
		  d.notas, d.created_at, o.numero, o.id, o.contacto_nombre, o.direccion_entrega, o.customer_id, o.estado_pago::text,
		  o.medio_pago::text, b.name, b.slug, s.transportista, s.numero_seguimiento
		FROM deliveries d JOIN orders o ON o.id = d.order_id
		LEFT JOIN branches b ON b.id = d.branch_id
		LEFT JOIN shipments s ON s.delivery_id = d.id
		WHERE d.id = $1 LIMIT 1`, id).Scan(&r.ID, &r.Numero, &r.Tipo, &r.Estado, &r.ReceptorNombre, &r.ReceptorDocumento, &r.FirmaURL,
		&r.FirmadoAt, &r.Notas, &r.CreatedAt, &r.PedidoNumero, &r.PedidoID, &r.ClienteNombre, &r.ClienteDireccion, &r.CustomerID,
		&r.EstadoPago, &r.MedioPago, &r.Sucursal, &slug, &r.Transportista, &r.NumeroSeguimiento)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	if slug != nil {
		if d, ok := direcciones[*slug]; ok {
			r.SucursalDireccion = &d
		}
	}
	filas, err := s.pool.Query(ctx, `
		SELECT oi.descripcion, oi.unidad, di.cantidad::text
		FROM delivery_items di JOIN order_items oi ON oi.id = di.order_item_id
		WHERE di.delivery_id = $1 ORDER BY di.orden`, id)
	if err != nil {
		return nil, err
	}
	r.Lineas = []LineaDelRemito{}
	for filas.Next() {
		var l LineaDelRemito
		var c string
		if err := filas.Scan(&l.Descripcion, &l.Unidad, &c); err != nil {
			filas.Close()
			return nil, err
		}
		l.Cantidad = numeroJS(c)
		r.Lineas = append(r.Lineas, l)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	pendientes, err := SaldoAlRemito(ctx, s.pool, r.PedidoID, id)
	if err != nil {
		return nil, err
	}
	r.Pendientes = []PendienteDelRemito{}
	for _, p := range pendientes {
		r.Pendientes = append(r.Pendientes, PendienteDelRemito{Descripcion: p.Descripcion, Unidad: p.Unidad, Pendiente: p.Pendiente})
	}
	// La última factura vigente del pedido; una rechazada se nombra igual
	// (es la emitida sin certificado: «sin CAE, sin valor fiscal»).
	var tipo string
	var pv, numero int32
	var f FacturaDelRemito
	err = s.pool.QueryRow(ctx, `
		SELECT tipo::text, punto_venta, numero, cae, cae_vencimiento FROM invoices
		WHERE order_id = $1 AND estado <> 'anulada' AND estado <> 'borrador' AND tipo::text LIKE 'factura%'
		ORDER BY created_at DESC LIMIT 1`, r.PedidoID).Scan(&tipo, &pv, &numero, &f.Cae, &f.CaeVencimiento)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return nil, err
	default:
		f.Etiqueta = nombreComprobante(tipo) + " " + fmt.Sprintf("%04d-%08d", pv, numero)
		r.Factura = &f
	}
	return &r, nil
}

// RemitoPorToken es el remito del enlace de firma: el token es lo único que
// sabe quien firma.
func (s *Servicio) RemitoPorToken(ctx context.Context, token string) (*RemitoCompleto, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM deliveries WHERE firma_token = $1 LIMIT 1`, token).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	return s.RemitoCompleto(ctx, id)
}

// ParaAvisar es lo que necesitan los avisos de entrega (lib/notificaciones/
// entregas.ts): el enlace de firma y a quién escribirle.
type ParaAvisar struct {
	FirmaToken   *string `json:"firmaToken"`
	Numero       string  `json:"numero"`
	PedidoNumero string  `json:"pedidoNumero"`
	Nombre       string  `json:"nombre"`
	Email        *string `json:"email"`
	EmailCliente *string `json:"emailCliente"`
	EstadoPedido string  `json:"estadoPedido"`
}

// DatosParaAvisar lee el remito, su pedido y el correo del cliente.
func (s *Servicio) DatosParaAvisar(ctx context.Context, id string) (*ParaAvisar, error) {
	if !plataforma.UUIDValido(id) {
		return nil, ErrNoEsta
	}
	var a ParaAvisar
	err := s.pool.QueryRow(ctx, `
		SELECT d.firma_token, d.numero, o.numero, o.contacto_nombre, o.contacto_email, c.email, o.estado::text
		FROM deliveries d JOIN orders o ON o.id = d.order_id LEFT JOIN customers c ON c.id = o.customer_id
		WHERE d.id = $1`, id).Scan(&a.FirmaToken, &a.Numero, &a.PedidoNumero, &a.Nombre, &a.Email, &a.EmailCliente, &a.EstadoPedido)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	return &a, err
}

// DuenoDelRemito es el cliente del pedido del remito (nil si no tiene).
func (s *Servicio) DuenoDelRemito(ctx context.Context, id string) (*string, error) {
	if !plataforma.UUIDValido(id) {
		return nil, ErrNoEsta
	}
	var c *string
	err := s.pool.QueryRow(ctx, `SELECT o.customer_id FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE d.id = $1`, id).Scan(&c)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	return c, err
}

func esSinFilas(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// timeNow es el reloj del PDF (el remito no lo usa: sus fechas son las del
// remito).
var timeNow = time.Now

func deTexto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ParaElPdf convierte el remito al de internal/pdf.
func (r *RemitoCompleto) ParaElPdf() pdf.RemitoCompleto {
	out := pdf.RemitoCompleto{ID: r.ID, Numero: r.Numero, Tipo: r.Tipo, Estado: r.Estado, ReceptorNombre: deTexto(r.ReceptorNombre),
		ReceptorDocumento: deTexto(r.ReceptorDocumento), FirmaURL: deTexto(r.FirmaURL), FirmadoAt: r.FirmadoAt, Notas: deTexto(r.Notas),
		CreatedAt: r.CreatedAt, PedidoNumero: r.PedidoNumero, ClienteNombre: r.ClienteNombre, ClienteDireccion: deTexto(r.ClienteDireccion),
		EstadoPago: r.EstadoPago, MedioPago: deTexto(r.MedioPago), Sucursal: deTexto(r.Sucursal), SucursalDireccion: deTexto(r.SucursalDireccion),
		Transportista: deTexto(r.Transportista), NumeroSeguimiento: deTexto(r.NumeroSeguimiento)}
	for _, l := range r.Lineas {
		out.Lineas = append(out.Lineas, pdf.LineaDelRemito{Descripcion: l.Descripcion, Unidad: l.Unidad, Cantidad: l.Cantidad})
	}
	for _, p := range r.Pendientes {
		out.Pendientes = append(out.Pendientes, pdf.PendienteDelRemito{Descripcion: p.Descripcion, Unidad: p.Unidad, Pendiente: p.Pendiente})
	}
	if f := r.Factura; f != nil {
		out.Factura = &pdf.FacturaDelRemito{Etiqueta: f.Etiqueta, Cae: deTexto(f.Cae), CaeVencimiento: f.CaeVencimiento}
	}
	return out
}

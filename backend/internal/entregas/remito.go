package entregas

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
	"mjbj/internal/ventas/fragmentos"
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
	// Corte dice qué parte del renglón sale cortada y según qué corte: el
	// cliente firmaba «3 placas de MDF» y recibía 14 piezas (mes simulado).
	Corte *string `json:"corte"`
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
	// SinCobrar es lo que falta cobrar del pedido fuera de la cuenta
	// corriente (fragmentos.SinCobrarDelPedido): el chofer de un envío
	// contra entrega tiene que saber cuánto traer, y el remito decía solo
	// «Pendiente de pago».
	SinCobrar *float64 `json:"sinCobrar"`
	// Visita son los remitos de otros pedidos que salieron en la misma
	// visita y se firman con este enlace (solo en RemitoPorToken).
	Visita []RemitoDeLaVisita `json:"visita"`
	// Reposicion es el corte de una reposición sin cargo (H321): lo que sale
	// son sus piezas, no renglones del pedido, y no se cobra nada.
	Reposicion *string `json:"reposicion"`
	// Los datos fiscales del cliente, como pide un remito R (mes simulado 2:
	// no llevaba CUIT ni condición de IVA).
	ClienteRazonSocial  *string `json:"clienteRazonSocial"`
	ClienteCuit         *string `json:"clienteCuit"`
	ClienteCondicionIva *string `json:"clienteCondicionIva"`
	// Final: se llevó lo último de un pedido que ya había salido en parte
	// (decía «Remito de entrega total» con 2 juegos).
	Final bool `json:"final"`
}

// RemitoDeLaVisita es otro remito que se firma junto con el del enlace.
type RemitoDeLaVisita struct {
	Numero       string           `json:"numero"`
	PedidoNumero string           `json:"pedidoNumero"`
	Lineas       []LineaDelRemito `json:"lineas"`
}

// cortesDelRemito son, por variante, los cortes del pedido cuyas piezas
// salieron con **este** remito (mes simulado 2): el texto se armaba con los
// cortes vivos del pedido al leerlo, así que el remito de un acopio hacía
// firmar «Cortado según CRT-3» con el corte en cola, tres remitos firmaban
// las mismas diez piezas, y un remito ya firmado pasaba a citar un corte
// hecho después.
//
// Un corte va en un remito si salió de la máquina antes de hacerlo (las
// piezas existían) y no fue ya en otro remito vivo del pedido, anterior,
// con esa placa. La reposición sin cargo no: sale con su propio remito.
// Como depende solo de lo que pasó antes del remito, el papel no cambia
// después.
func cortesDelRemito(ctx context.Context, db consultor, pedido, remito string) (map[string][]corteDelRenglon, error) {
	filas, err := db.Query(ctx, `
		WITH r AS (SELECT id, created_at FROM deliveries WHERE id = $2),
		c AS (
		  SELECT co.id, co.variant_id, co.numero, co.placas, co.mitad IS NOT NULL AS mitad,
		         coalesce(co.terminado_at, co.updated_at) AS salio
		  FROM cutting_orders co
		  WHERE co.order_id = $1 AND co.estado IN ('terminado', 'retirado') AND co.variant_id IS NOT NULL AND NOT co.sin_cargo)
		SELECT c.variant_id::text, c.numero, c.placas,
		       coalesce((SELECT sum(ci.cantidad) FROM cutting_items ci WHERE ci.cutting_order_id = c.id), 0)::int, c.mitad
		FROM c, r
		WHERE c.salio <= r.created_at
		  AND NOT EXISTS (
		    SELECT 1 FROM deliveries d2 JOIN delivery_items di2 ON di2.delivery_id = d2.id
		    JOIN order_items oi2 ON oi2.id = di2.order_item_id
		    WHERE d2.order_id = $1 AND d2.id <> r.id AND d2.estado <> 'anulada' AND d2.cutting_order_id IS NULL
		      AND oi2.variant_id = c.variant_id AND d2.created_at >= c.salio AND d2.created_at < r.created_at)
		ORDER BY c.numero`, pedido, remito)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := map[string][]corteDelRenglon{}
	for filas.Next() {
		var variante string
		var c corteDelRenglon
		if err := filas.Scan(&variante, &c.numero, &c.placas, &c.piezas, &c.mitad); err != nil {
			return nil, err
		}
		out[variante] = append(out[variante], c)
	}
	return out, filas.Err()
}

type corteDelRenglon struct {
	numero         string
	placas, piezas int
	// mitad: el corte sale de medias placas; sus placas son medias.
	mitad bool
}

// TextoDelCorte es cómo se lee lo cortado de un renglón: «Cortado según
// CRT-13: 14 piezas de 2 placas · 1 entera». Las placas del corte no pasan
// lo que lleva el renglón (CRT-2 usaba 3 medias y el remito llevaba 2), y
// de una media placa se dice «media placa» (decía «2 placas» y «6 piezas de
// 3 placas» en el mismo papel).
func TextoDelCorte(cs []corteDelRenglon, cantidad float64) *string {
	if len(cs) == 0 {
		return nil
	}
	var partes []string
	placas := 0
	medias := false
	for _, c := range cs {
		piezas := "piezas"
		if c.piezas == 1 {
			piezas = "pieza"
		}
		n := c.placas
		if queda := int(math.Floor(cantidad+0.001)) - placas; n > queda {
			n = max(queda, 0)
		}
		if n == 0 {
			continue
		}
		de := "placas"
		switch {
		case c.mitad && n == 1:
			de = "media placa"
		case c.mitad:
			de = "medias placas"
		case n == 1:
			de = "placa"
		}
		medias = medias || c.mitad
		partes = append(partes, "Cortado según "+c.numero+": "+fmt.Sprint(c.piezas)+" "+piezas+" de "+fmt.Sprint(n)+" "+de)
		placas += n
	}
	if len(partes) == 0 {
		return nil
	}
	t := strings.Join(partes, " · ")
	if enteras := cantidad - float64(placas); enteras > 0.001 {
		t += " · " + jsmath.Texto(enteras)
		switch {
		case medias && enteras == 1:
			t += " media placa entera"
		case medias:
			t += " medias placas enteras"
		case enteras == 1:
			t += " entera"
		default:
			t += " enteras"
		}
	}
	return &t
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
//
// El domicilio de un envío va con la zona: el fletero leía «Av. Colón 1234»
// sin saber de qué ciudad (tercera prueba, Tandil).
func (s *Servicio) RemitoCompleto(ctx context.Context, id string) (*RemitoCompleto, error) {
	if !plataforma.UUIDValido(id) {
		return nil, ErrNoEsta
	}
	var r RemitoCompleto
	var slug, zona, corte, dirCliente *string
	var anteriores bool
	err := s.pool.QueryRow(ctx, `
		SELECT d.id, d.numero, d.tipo::text, d.estado::text, d.receptor_nombre, d.receptor_documento, d.firma_url, d.firmado_at,
		  d.notas, d.created_at, o.numero, o.id, o.contacto_nombre, o.direccion_entrega, o.customer_id, o.estado_pago::text,
		  o.medio_pago::text, b.name, b.slug, s.transportista, s.numero_seguimiento, `+fragmentos.SinCobrarDelPedido+`::float8,
		  o.zona_envio, d.cutting_order_id::text,
		  nullif(c.razon_social, ''), nullif(c.cuit, ''), CASE WHEN c.id IS NOT NULL THEN c.condicion_iva::text END,
		  coalesce(nullif(trim(c.direccion), ''), (SELECT a.calle || ', ' || a.localidad FROM addresses a WHERE a.customer_id = c.id
		    ORDER BY a.predeterminada DESC, a.created_at LIMIT 1)),
		  EXISTS (SELECT 1 FROM deliveries d2 WHERE d2.order_id = d.order_id AND d2.id <> d.id AND d2.estado <> 'anulada'
		    AND d2.cutting_order_id IS NULL AND d2.created_at < d.created_at)
		FROM deliveries d JOIN orders o ON o.id = d.order_id
		LEFT JOIN customers c ON c.id = o.customer_id
		LEFT JOIN branches b ON b.id = d.branch_id
		LEFT JOIN shipments s ON s.delivery_id = d.id
		WHERE d.id = $1 LIMIT 1`, id).Scan(&r.ID, &r.Numero, &r.Tipo, &r.Estado, &r.ReceptorNombre, &r.ReceptorDocumento, &r.FirmaURL,
		&r.FirmadoAt, &r.Notas, &r.CreatedAt, &r.PedidoNumero, &r.PedidoID, &r.ClienteNombre, &r.ClienteDireccion, &r.CustomerID,
		&r.EstadoPago, &r.MedioPago, &r.Sucursal, &slug, &r.Transportista, &r.NumeroSeguimiento, &r.SinCobrar, &zona, &corte,
		&r.ClienteRazonSocial, &r.ClienteCuit, &r.ClienteCondicionIva, &dirCliente, &anteriores)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	if r.Tipo == "envio" {
		r.ClienteDireccion = DomicilioConZona(r.ClienteDireccion, zona)
	} else if r.ClienteDireccion == nil || strings.TrimSpace(*r.ClienteDireccion) == "" {
		// En un retiro, el domicilio de la ficha del cliente (o su primera
		// dirección): decía «Domicilio del cliente: -» con «Sim Casa»
		// cargada en Mi cuenta (mes simulado 2).
		r.ClienteDireccion = dirCliente
	}
	if slug != nil {
		if d, ok := direcciones[*slug]; ok {
			r.SucursalDireccion = &d
		}
	}
	if corte != nil {
		return s.completarReposicion(ctx, &r, *corte)
	}
	cortes, err := cortesDelRemito(ctx, s.pool, r.PedidoID, id)
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT oi.descripcion, oi.unidad, di.cantidad::text, coalesce(oi.variant_id::text, '')
		FROM delivery_items di JOIN order_items oi ON oi.id = di.order_item_id
		WHERE di.delivery_id = $1 ORDER BY di.orden`, id)
	if err != nil {
		return nil, err
	}
	r.Lineas = []LineaDelRemito{}
	for filas.Next() {
		var l LineaDelRemito
		var c, variante string
		if err := filas.Scan(&l.Descripcion, &l.Unidad, &c, &variante); err != nil {
			filas.Close()
			return nil, err
		}
		l.Cantidad = numeroJS(c)
		if variante != "" {
			l.Corte = TextoDelCorte(cortes[variante], l.Cantidad)
		}
		r.Lineas = append(r.Lineas, l)
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}
	r.Visita = []RemitoDeLaVisita{}
	pendientes, err := SaldoAlRemito(ctx, s.pool, r.PedidoID, id)
	if err != nil {
		return nil, err
	}
	r.Pendientes = []PendienteDelRemito{}
	for _, p := range pendientes {
		r.Pendientes = append(r.Pendientes, PendienteDelRemito{Descripcion: p.Descripcion, Unidad: p.Unidad, Pendiente: p.Pendiente})
	}
	r.Final = len(r.Pendientes) == 0 && anteriores
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
//
// El DNI de quien retira sale enmascarado (comité del 25/11): el enlace va
// por correo al contacto del pedido, que nadie verificó, y quien retira
// puede ser otra persona. Basta con los últimos tres números para que lo
// reconozca; firmar sin escribirlo conserva el que se cargó en el mostrador
// (Firmar: coalesce(nullif(...), receptor_documento)).
func (s *Servicio) RemitoPorToken(ctx context.Context, token string) (*RemitoCompleto, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM deliveries WHERE firma_token = $1 LIMIT 1`, token).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNoEsta
	}
	if err != nil {
		return nil, err
	}
	r, err := s.RemitoCompleto(ctx, id)
	if err != nil || r == nil {
		return r, err
	}
	r.ReceptorDocumento = DocumentoEnmascarado(r.ReceptorDocumento)
	filas, err := s.pool.Query(ctx, `SELECT id::text FROM deliveries WHERE visita_de = $1 AND estado <> 'anulada' ORDER BY numero`, id)
	if err != nil {
		return nil, err
	}
	otros, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	for _, otro := range otros {
		o, err := s.RemitoCompleto(ctx, otro)
		if err != nil {
			return nil, err
		}
		r.Visita = append(r.Visita, RemitoDeLaVisita{Numero: o.Numero, PedidoNumero: o.PedidoNumero, Lineas: o.Lineas})
	}
	return r, nil
}

// DocumentoEnmascarado deja a la vista solo los últimos tres caracteres:
// «•••678». Nil o vacío queda igual; uno de tres o menos se tapa entero.
func DocumentoEnmascarado(d *string) *string {
	if d == nil || strings.TrimSpace(*d) == "" {
		return d
	}
	r := []rune(strings.TrimSpace(*d))
	if len(r) <= 3 {
		m := "•••"
		return &m
	}
	m := "•••" + string(r[len(r)-3:])
	return &m
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
	// EstadoRemito: el pedido de firma sale solo si sigue «preparada».
	EstadoRemito string `json:"estadoRemito"`
}

// DatosParaAvisar lee el remito, su pedido y el correo del cliente.
func (s *Servicio) DatosParaAvisar(ctx context.Context, id string) (*ParaAvisar, error) {
	if !plataforma.UUIDValido(id) {
		return nil, ErrNoEsta
	}
	var a ParaAvisar
	err := s.pool.QueryRow(ctx, `
		SELECT d.firma_token, d.numero, o.numero, o.contacto_nombre, o.contacto_email, c.email, o.estado::text, d.estado::text
		FROM deliveries d JOIN orders o ON o.id = d.order_id LEFT JOIN customers c ON c.id = o.customer_id
		WHERE d.id = $1`, id).Scan(&a.FirmaToken, &a.Numero, &a.PedidoNumero, &a.Nombre, &a.Email, &a.EmailCliente, &a.EstadoPedido, &a.EstadoRemito)
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
		out.Lineas = append(out.Lineas, pdf.LineaDelRemito{Descripcion: l.Descripcion, Unidad: l.Unidad, Cantidad: l.Cantidad, Corte: deTexto(l.Corte)})
	}
	if r.SinCobrar != nil {
		out.SinCobrar = *r.SinCobrar
	}
	for _, p := range r.Pendientes {
		out.Pendientes = append(out.Pendientes, pdf.PendienteDelRemito{Descripcion: p.Descripcion, Unidad: p.Unidad, Pendiente: p.Pendiente})
	}
	if f := r.Factura; f != nil {
		out.Factura = &pdf.FacturaDelRemito{Etiqueta: f.Etiqueta, Cae: deTexto(f.Cae), CaeVencimiento: f.CaeVencimiento}
	}
	out.Reposicion = deTexto(r.Reposicion)
	out.ClienteRazonSocial, out.ClienteCuit, out.ClienteCondicionIva = deTexto(r.ClienteRazonSocial), deTexto(r.ClienteCuit), deTexto(r.ClienteCondicionIva)
	out.Final = r.Final
	return out
}

// completarReposicion llena el remito de una reposición sin cargo con las
// piezas de su corte: no cobra nada, no tiene factura y no dice lo que queda
// en acopio del pedido (no es una entrega de su mercadería).
func (s *Servicio) completarReposicion(ctx context.Context, r *RemitoCompleto, corte string) (*RemitoCompleto, error) {
	var numero, material string
	var sinCargo bool
	if err := s.pool.QueryRow(ctx, `SELECT numero, material_descripcion, sin_cargo FROM cutting_orders WHERE id = $1`, corte).Scan(&numero, &material, &sinCargo); err != nil {
		return nil, err
	}
	// El remito de un pedido que solo lleva el corte (RemitoDelCorte) lista
	// las mismas piezas, pero es una entrega cobrada: no dice «sin cargo».
	if sinCargo {
		r.Reposicion = &numero
		r.SinCobrar = nil
	}
	r.Pendientes = []PendienteDelRemito{}
	r.Visita = []RemitoDeLaVisita{}
	filas, err := s.pool.Query(ctx, `
		SELECT largo_mm, ancho_mm, cantidad, coalesce(etiqueta, '') FROM cutting_items
		WHERE cutting_order_id = $1 ORDER BY orden, id`, corte)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	r.Lineas = []LineaDelRemito{}
	for filas.Next() {
		var largo, ancho, cantidad int32
		var etiqueta string
		if err := filas.Scan(&largo, &ancho, &cantidad, &etiqueta); err != nil {
			return nil, err
		}
		d := fmt.Sprintf("%s — %d × %d mm", material, largo, ancho)
		if etiqueta != "" {
			d += " · " + etiqueta
		}
		r.Lineas = append(r.Lineas, LineaDelRemito{Descripcion: d, Unidad: "pieza", Cantidad: float64(cantidad)})
	}
	return r, filas.Err()
}

// DomicilioConZona suma la zona de envío al domicilio, salvo que ya la diga.
func DomicilioConZona(domicilio, zona *string) *string {
	if zona == nil || strings.TrimSpace(*zona) == "" {
		return domicilio
	}
	z := strings.TrimSpace(*zona)
	if domicilio == nil || strings.TrimSpace(*domicilio) == "" {
		return &z
	}
	d := strings.TrimSpace(*domicilio)
	if strings.Contains(strings.ToLower(d), strings.ToLower(z)) {
		return &d
	}
	d += " · " + z
	return &d
}

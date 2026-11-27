// Package buscador es el buscador del panel (lib/dal/admin/busqueda-panel.ts):
// clientes, pedidos, presupuestos, comprobantes, cortes y proveedores, hasta
// cuatro de cada uno, y solo de las pantallas a las que entra el rol.
package buscador

import (
	"context"
	"encoding/json"
	"fmt"
	"mjbj/internal/busqueda"
	"mjbj/internal/cortes"
	"mjbj/internal/cuit"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/buscadorapi"
	"mjbj/internal/auth"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// Resultado es un renglón del buscador.
type Resultado struct {
	ID      string `json:"id"`
	Tipo    string `json:"tipo"`
	Titulo  string `json:"titulo"`
	Detalle string `json:"detalle"`
	Href    string `json:"href"`
}

const porTipo = 4

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// fecha es toLocaleDateString("es-AR") en hora argentina (el TS usaba la del
// servidor: un pedido de las 22 decía el día siguiente).
func fecha(t time.Time) string {
	a := t.In(argentina)
	return fmt.Sprintf("%d/%d/%d", a.Day(), int(a.Month()), a.Year())
}

// coincide es coincideBusqueda: cada palabra (hasta seis) tiene que estar en
// alguna de las columnas, sin tildes.
func coincide(texto string, args *[]any, columnas ...string) string {
	return coincideONumero(texto, args, nil, columnas...)
}

// coincideONumero es coincide, salvo que lo buscado sea un teléfono o un CUIT:
// entonces compara solo los dígitos de esas columnas (las de `numericas`).
// «2235551234» no encontraba «223 555-1234».
func coincideONumero(texto string, args *[]any, numericas []string, columnas ...string) string {
	if d, ok := busqueda.Numero(texto); ok && len(numericas) > 0 {
		*args = append(*args, "%"+busqueda.SinPrefijos(d)+"%")
		p := fmt.Sprintf("$%d", len(*args))
		var col []string
		for _, c := range numericas {
			col = append(col, busqueda.Digitos(c)+" LIKE "+p)
		}
		return "(" + strings.Join(col, " OR ") + ")"
	}
	t := terminos(texto)
	var por []string
	for _, termino := range t {
		*args = append(*args, "%"+termino+"%")
		p := fmt.Sprintf("$%d", len(*args))
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		por = append(por, "("+strings.Join(col, " OR ")+")")
	}
	if len(por) == 0 {
		return "true"
	}
	return "(" + strings.Join(por, " AND ") + ")"
}

// minimoDeLetras es lo más corto que se busca. Con dos letras los trigramas
// no tienen de dónde agarrarse y el índice se recorre entero, o la tabla:
// «de», «la» o «12» tocaban cada pedido de la historia en cada tecla.
const minimoDeLetras = 3

// terminos son las palabras de la búsqueda (hasta seis, como
// coincideBusqueda) sin las de menos de tres letras: «Juan de la Cruz»
// busca «juan» y «cruz».
func terminos(texto string) []string {
	var t []string
	for _, p := range strings.Fields(texto) {
		if len([]rune(p)) >= minimoDeLetras {
			t = append(t, p)
		}
	}
	if len(t) > 6 {
		t = t[:6]
	}
	return t
}

// Consultor es lo que el buscador le pide a la base (un pool, o en las
// pruebas uno que anota las consultas para mirar su plan).
type Consultor interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func juntar(partes ...*string) string {
	var out []string
	for _, p := range partes {
		if p != nil && *p != "" {
			out = append(out, *p)
		}
	}
	return strings.Join(out, " · ")
}

// distinta es la razón social solo si dice algo que el nombre no dice:
// «Constructora del Sur SRL · Constructora del Sur SRL · …» repetía el
// título como subtítulo (mes simulado).
func distinta(razon *string, nombre string) *string {
	if razon == nil || strings.EqualFold(strings.TrimSpace(*razon), strings.TrimSpace(nombre)) {
		return nil
	}
	return razon
}

// conGuiones es el CUIT como se lee en el resto del panel: «30-71555444-1».
func conGuiones(c *string) *string {
	if c == nil {
		return nil
	}
	f := cuit.FormatearLargo(*c)
	return &f
}

// nombreComprobante es el de lib/fiscal/comprobantes.ts: «Factura A»,
// «Nota de crédito B».
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

// estados son las etiquetas del panel (components/admin/etiqueta-estado.tsx,
// con el contexto del pedido): el buscador decía «en-cola», «pendiente» y
// «aceptado» en clave, en minúscula (mes simulado, M2S2-132, M2S4-070).
var estados = map[string]map[string]string{
	"pedido": {"pendiente": "Sin preparar", "preparando": "Preparando", "listo": "Listo", "en-camino": "En camino",
		"entregado": "Entregado", "cancelado": "Cancelado"},
	"presupuesto": {"pendiente": "Pendiente", "revision": "En revisión", "enviado": "Enviado", "aceptado": "Aceptado",
		"rechazado": "Rechazado", "vencido": "Vencido"},
	"corte": {"en-cola": "En cola", "en-proceso": "En la máquina", "terminado": "Terminado", "retirado": "Retirado",
		"cancelado": "Anulado"},
	"remito": {"preparada": "Preparado", "en_camino": "En camino", "entregada": "Entregado", "anulada": "Anulado"},
	"cheque": {"informado": "Informado", "cartera": "En cartera", "depositado": "Depositado", "acreditado": "Acreditado",
		"entregado": "Entregado", "rechazado": "Rechazado", "anulado": "Anulado", "endosado": "Endosado"},
	"recibo": {"emitido": "Emitido", "anulado": "Anulado"},
}

// estado es la etiqueta de `valor` para un tipo, o el valor con mayúscula si
// no está en la tabla.
func estado(tipo, valor string) string {
	if e, ok := estados[tipo][valor]; ok {
		return e
	}
	v := strings.ReplaceAll(strings.ReplaceAll(valor, "-", " "), "_", " ")
	if v == "" {
		return v
	}
	return strings.ToUpper(v[:1]) + v[1:]
}

// numeroDe es lo que se escribió, sin espacios: el número de un recibo, un
// remito o un cheque («REC-0005», «00045678»). Con menos de tres letras o
// sin ningún dígito no se busca: un nombre no es un número.
func numeroDe(texto string) (string, bool) {
	t := strings.Join(strings.Fields(texto), "")
	return t, len([]rune(t)) >= minimoDeLetras && strings.ContainsAny(t, "0123456789")
}

// plural es «1 medida» y «3 medidas» (decía «1 medidas»).
func plural(n int, uno, varios string) string {
	if n == 1 {
		return "1 " + uno
	}
	return fmt.Sprintf("%d %s", n, varios)
}

// medidaCorta: un término de solo dígitos con menos de tres («18» de
// «melamina 18»). No arranca la búsqueda, pero filtra: tiene que ser un
// número entero en la medida («18mm» sí, «1830» no).
func medidaCorta(p string) bool {
	if len(p) == 0 || len(p) >= minimoDeLetras {
		return false
	}
	for _, r := range p {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// Buscar es buscarEnElPanel.
func Buscar(ctx context.Context, pool Consultor, rol *sqlc.StaffRole, texto string) ([]Resultado, error) {
	texto = strings.TrimSpace(texto)
	out := []Resultado{}
	if _, esNumero := busqueda.Numero(texto); !esNumero && len(terminos(texto)) == 0 {
		return out, nil
	}
	puede := func(ruta string) bool { return roles.PuedeEntrar(ruta, rol) }
	type busqueda struct {
		ruta  string
		hacer func() ([]Resultado, error)
	}
	todas := []busqueda{
		{"/admin/clientes", func() ([]Resultado, error) {
			var a []any
			// Solo las vivas: la ficha que se apagó al unirla con otra
			// aparecía como un segundo cliente (M3S1-025).
			filas, err := pool.Query(ctx, `SELECT id, nombre, razon_social, cuit, telefono FROM customers WHERE active AND (`+
				coincideONumero(texto, &a, []string{"cuit", "telefono"}, "nombre", "razon_social", "cuit", "telefono")+`) ORDER BY nombre LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, nombre string
				var razon, cuit, tel *string
				err := r.Scan(&id, &nombre, &razon, &cuit, &tel)
				return Resultado{id, "Cliente", nombre, juntar(distinta(razon, nombre), conGuiones(cuit), tel), "/admin/clientes/" + id}, err
			})
		}},
		{"/admin/pedidos", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, numero, contacto_nombre, estado::text, created_at FROM orders WHERE `+
				coincideONumero(texto, &a, []string{"contacto_telefono"}, "numero", "contacto_nombre")+` ORDER BY created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, contacto, e string
				var creado time.Time
				err := r.Scan(&id, &numero, &contacto, &e, &creado)
				return Resultado{id, "Pedido", numero + " · " + contacto, estado("pedido", e) + " · " + fecha(creado), "/admin/pedidos/" + id}, err
			})
		}},
		{"/admin/presupuestos", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, numero, contacto_nombre, estado::text, created_at FROM quotes WHERE `+
				coincideONumero(texto, &a, []string{"contacto_telefono"}, "numero", "contacto_nombre")+` ORDER BY created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, contacto, e string
				var creado time.Time
				err := r.Scan(&id, &numero, &contacto, &e, &creado)
				return Resultado{id, "Presupuesto", numero + " · " + contacto, estado("presupuesto", e) + " · " + fecha(creado), "/admin/presupuestos/" + id}, err
			})
		}},
		{"/admin/facturacion", func() ([]Resultado, error) {
			var a []any
			cond := coincide(texto, &a, "receptor_nombre")
			a = append(a, "%"+texto+"%")
			filas, err := pool.Query(ctx, `SELECT id, tipo::text, receptor_nombre,
				  lpad(punto_venta::text, 4, '0') || '-' || lpad(numero::text, 8, '0')
				FROM invoices WHERE (`+cond+` OR lpad(punto_venta::text, 4, '0') || '-' || lpad(numero::text, 8, '0') ILIKE $`+
				fmt.Sprint(len(a))+`) ORDER BY created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, tipo, receptor, formateado string
				err := r.Scan(&id, &tipo, &receptor, &formateado)
				return Resultado{id, "Comprobante", nombreComprobante(tipo) + " " + formateado, receptor, "/admin/facturacion/" + id}, err
			})
		}},
		// Quien vende o entrega no entra a Facturación, pero el cliente le
		// dicta el número de la factura: lo lleva al pedido (M2S1-087).
		{"/admin/pedidos", func() ([]Resultado, error) {
			if puede("/admin/facturacion") {
				return nil, nil
			}
			var a []any
			cond := coincide(texto, &a, "i.receptor_nombre")
			a = append(a, "%"+texto+"%")
			filas, err := pool.Query(ctx, `SELECT i.order_id, i.tipo::text, i.receptor_nombre,
				  lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0')
				FROM invoices i WHERE i.order_id IS NOT NULL AND (`+cond+` OR lpad(i.punto_venta::text, 4, '0') || '-' || lpad(i.numero::text, 8, '0') ILIKE $`+
				fmt.Sprint(len(a))+`) ORDER BY i.created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, tipo, receptor, formateado string
				err := r.Scan(&id, &tipo, &receptor, &formateado)
				return Resultado{id + "-" + formateado, "Comprobante", nombreComprobante(tipo) + " " + formateado, receptor, "/admin/pedidos/" + id}, err
			})
		}},
		// Recibos, remitos y cheques por número (M2S1-096, M2S2-132): el
		// recibo y el cheque llevan a la ficha del cliente, en su renglón; el
		// remito, al pedido.
		{"/admin/clientes", func() ([]Resultado, error) {
			n, ok := numeroDe(texto)
			if !ok {
				return nil, nil
			}
			// El recibo tiene renglón en la ficha si pasó por la cuenta o si
			// cobró un pedido (el suyo o el de la factura que paga). El que
			// cobró una factura suelta, o uno sin cliente, va a esa factura
			// (M2S1-096: REC-0014 llevaba a un ancla que no existía).
			filas, err := pool.Query(ctx, `SELECT r.id, r.numero, r.customer_id, r.recibido_de, r.estado::text, r.total::float8, r.created_at,
				  (r.account_movement_id IS NOT NULL OR r.order_id IS NOT NULL OR EXISTS (SELECT 1 FROM account_movements m WHERE m.receipt_id = r.id)
				    OR EXISTS (SELECT 1 FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE ip.receipt_id = r.id AND i.order_id IS NOT NULL)) AS en_la_ficha,
				  (SELECT ip.invoice_id FROM invoice_payments ip WHERE ip.receipt_id = r.id ORDER BY ip.created_at LIMIT 1) AS factura
				FROM receipts r WHERE f_unaccent(r.numero) ILIKE f_unaccent($1)
				  AND (r.customer_id IS NOT NULL OR EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.receipt_id = r.id))
				ORDER BY r.created_at DESC LIMIT 4`, "%"+n+"%")
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, de, e string
				var cliente, factura *string
				var total float64
				var creado time.Time
				var enLaFicha bool
				err := r.Scan(&id, &numero, &cliente, &de, &e, &total, &creado, &enLaFicha, &factura)
				return Resultado{id, "Recibo", numero + " · " + de, estado("recibo", e) + " · " + plata(total) + " · " + fecha(creado),
					destinoDelRecibo(numero, cliente, factura, enLaFicha)}, err
			})
		}},
		{"/admin/pedidos", func() ([]Resultado, error) {
			n, ok := numeroDe(texto)
			if !ok {
				return nil, nil
			}
			filas, err := pool.Query(ctx, `SELECT d.id, d.numero, d.order_id, o.numero, o.contacto_nombre, d.estado::text, d.created_at
				FROM deliveries d JOIN orders o ON o.id = d.order_id WHERE f_unaccent(d.numero) ILIKE f_unaccent($1)
				ORDER BY d.created_at DESC LIMIT 4`, "%"+n+"%")
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, pedido, pedidoNumero, contacto, e string
				var creado time.Time
				err := r.Scan(&id, &numero, &pedido, &pedidoNumero, &contacto, &e, &creado)
				return Resultado{id, "Remito", numero + " · " + contacto, pedidoNumero + " · " + estado("remito", e) + " · " + fecha(creado),
					"/admin/pedidos/" + pedido + "#remito"}, err
			})
		}},
		{"/admin/clientes", func() ([]Resultado, error) {
			n, ok := numeroDe(texto)
			if !ok {
				return nil, nil
			}
			cartera := puede("/admin/cheques")
			filas, err := pool.Query(ctx, `SELECT c.id, c.numero, c.banco, c.customer_id, c.estado::text, c.importe::float8, cu.nombre
				FROM cheques c LEFT JOIN customers cu ON cu.id = c.customer_id
				WHERE f_unaccent(c.numero) ILIKE f_unaccent($1) AND ($2 OR c.customer_id IS NOT NULL)
				ORDER BY c.fecha_pago DESC LIMIT 4`, "%"+n+"%", cartera)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, e string
				var banco, cliente, nombre *string
				var importe float64
				err := r.Scan(&id, &numero, &banco, &cliente, &e, &importe, &nombre)
				titulo := "Cheque " + numero
				if banco != nil && *banco != "" {
					titulo += " · " + *banco
				}
				href := "/admin/cheques"
				if cliente != nil {
					href = "/admin/clientes/" + *cliente + "?ver=cheques&periodo=todo"
				}
				return Resultado{id, "Cheque", titulo, juntar(nombre, ptr(estado("cheque", e)), ptr(plata(importe))), href}, err
			})
		}},
		// Los productos, por nombre, medida, código o rubro (M2S1-087): antes
		// los buscaba Next solo por el nombre, y «PLA-MEL-BLA-18» o «melamina
		// 18» no los encontraban. Van antes que los cortes que los usan.
		{"/admin/productos", func() ([]Resultado, error) {
			return productos(ctx, pool, texto)
		}},
		{"/admin/cortes", func() ([]Resultado, error) {
			var a []any
			// También por el pedido: el aserradero tiene el «PED-1368» del
			// papel y el corte no aparecía (mes simulado, M3S4-024).
			filas, err := pool.Query(ctx, `SELECT co.id, co.numero, co.contacto_nombre, co.material_descripcion, co.estado::text,
				       pv.largo_mm, pv.ancho_mm
				FROM cutting_orders co LEFT JOIN orders o ON o.id = co.order_id
				LEFT JOIN product_variants pv ON pv.id = co.variant_id WHERE `+
				coincide(texto, &a, "co.numero", "co.contacto_nombre", "co.material_descripcion", "o.numero")+` ORDER BY co.created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, contacto, material, e string
				var largo, ancho *int32
				err := r.Scan(&id, &numero, &contacto, &material, &e, &largo, &ancho)
				// Con la medida en orden, como en la cola (CRT-21).
				material = cortes.MaterialEnOrden(material, largo, ancho)
				return Resultado{id, "Corte", numero + " · " + contacto, material + " · " + estado("corte", e), "/admin/cortes/" + id}, err
			})
		}},
		{"/admin/proveedores", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, nombre, razon_social, cuit, rubro FROM suppliers WHERE `+
				coincideONumero(texto, &a, []string{"cuit", "telefono"}, "nombre", "razon_social", "cuit", "rubro")+` ORDER BY nombre LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, nombre string
				var razon, cuit, rubro *string
				err := r.Scan(&id, &nombre, &razon, &cuit, &rubro)
				return Resultado{id, "Proveedor", nombre, juntar(distinta(razon, nombre), conGuiones(cuit), rubro), "/admin/proveedores/" + id}, err
			})
		}},
	}
	for _, b := range todas {
		if !puede(b.ruta) {
			continue
		}
		r, err := b.hacer()
		if err != nil {
			return nil, err
		}
		out = append(out, r...)
	}
	return out, nil
}

func ptr(s string) *string { return &s }

// plata es el importe como lo escribe el panel: «$ 12.345» o «$ 12.345,50».
func plata(v float64) string {
	centavos := int64(v*100 + 0.5)
	if v < 0 {
		centavos = int64(v*100 - 0.5)
	}
	signo := ""
	if centavos < 0 {
		signo, centavos = "-", -centavos
	}
	entero := fmt.Sprint(centavos / 100)
	var b strings.Builder
	for i, r := range entero {
		if i > 0 && (len(entero)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	out := signo + "$ " + b.String()
	if c := centavos % 100; c != 0 {
		out += fmt.Sprintf(",%02d", c)
	}
	return out
}

// productos busca en el catálogo activo. Arranca por la palabra más larga
// (con índice de trigramas en el nombre, la medida y el código) y después
// pide que cada palabra esté en el nombre, la marca, el rubro, o la medida o
// el código de alguna medida activa. Un número corto («18») tiene que ser
// un número entero en el texto: «18mm» sí, «1830 x 2600» no.
func productos(ctx context.Context, pool Consultor, texto string) ([]Resultado, error) {
	var largos, cortos []string
	for _, p := range strings.Fields(texto) {
		switch {
		case len([]rune(p)) >= minimoDeLetras:
			largos = append(largos, p)
		case medidaCorta(p):
			cortos = append(cortos, p)
		}
	}
	if len(largos) == 0 {
		return nil, nil
	}
	if len(largos) > 6 {
		largos = largos[:6]
	}
	guia := largos[0]
	for _, p := range largos {
		if len([]rune(p)) > len([]rune(guia)) {
			guia = p
		}
	}
	// $1 arranca la búsqueda; $2 ordena lo que empieza con lo escrito.
	a := []any{"%" + guia + "%", largos[0]}
	var cond []string
	for _, p := range largos {
		a = append(a, "%"+p+"%")
		n := fmt.Sprintf("$%d", len(a))
		cond = append(cond, `(f_unaccent(p.name) ILIKE f_unaccent(`+n+`) OR f_unaccent(coalesce(p.brand, '')) ILIKE f_unaccent(`+n+`)
		  OR f_unaccent(coalesce(c.name, '')) ILIKE f_unaccent(`+n+`)
		  OR EXISTS (SELECT 1 FROM product_variants w WHERE w.product_id = p.id AND w.active
		    AND (f_unaccent(w.label) ILIKE f_unaccent(`+n+`) OR f_unaccent(coalesce(w.sku, '')) ILIKE f_unaccent(`+n+`))))`)
	}
	for _, p := range cortos {
		a = append(a, `(^|[^0-9])`+p+`([^0-9]|$)`)
		n := fmt.Sprintf("$%d", len(a))
		cond = append(cond, `(p.name ~ `+n+` OR EXISTS (SELECT 1 FROM product_variants w WHERE w.product_id = p.id AND w.active
		    AND (w.label ~ `+n+` OR coalesce(w.sku, '') ~ `+n+`)))`)
	}
	filas, err := pool.Query(ctx, `
		WITH candidatos AS (
		  SELECT id FROM products WHERE f_unaccent(name) ILIKE f_unaccent($1)
		  UNION
		  SELECT product_id FROM product_variants WHERE f_unaccent(label) ILIKE f_unaccent($1) OR f_unaccent(sku) ILIKE f_unaccent($1)
		)
		SELECT p.id, p.name, c.name, p.brand,
		  (SELECT count(*)::int FROM product_variants v WHERE v.product_id = p.id AND v.active)
		FROM products p JOIN candidatos k ON k.id = p.id
		LEFT JOIN categories c ON c.id = p.category_id
		WHERE p.active AND `+strings.Join(cond, " AND ")+`
		ORDER BY (f_unaccent(p.name) ILIKE f_unaccent($2) || '%') DESC, p.name
		LIMIT 4`, a...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
		var id, nombre string
		var rubro, marca *string
		var medidas int
		err := r.Scan(&id, &nombre, &rubro, &marca, &medidas)
		return Resultado{id, "Producto", nombre, juntar(rubro, marca, ptr(plural(medidas, "medida", "medidas"))), "/admin/productos/" + id}, err
	})
}

// API es la ruta de api/buscador.yaml.
type API struct{ pool *pgxpool.Pool }

// NuevaAPI arma el handler.
func NuevaAPI(pool *pgxpool.Pool) *API { return &API{pool: pool} }

var _ buscadorapi.StrictServerInterface = (*API)(nil)

type respuesta []Resultado

func (o respuesta) VisitBuscarEnElPanelResponse(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return json.NewEncoder(w).Encode(o)
}

func (a *API) BuscarEnElPanel(ctx context.Context, r buscadorapi.BuscarEnElPanelRequestObject) (buscadorapi.BuscarEnElPanelResponseObject, error) {
	ses, err := auth.ExigirStaff(ctx)
	if err != nil {
		return nil, err
	}
	v, err := Buscar(ctx, a.pool, ses.RolStaff, r.Params.Q)
	if err != nil {
		return nil, err
	}
	return respuesta(v), nil
}

// destinoDelRecibo es adónde lleva un recibo del buscador: a su renglón en la
// ficha del cliente si lo tiene, si no a la factura que cobró, y si no a la
// ficha a secas.
func destinoDelRecibo(numero string, cliente, factura *string, enLaFicha bool) string {
	switch {
	case cliente != nil && enLaFicha:
		return "/admin/clientes/" + *cliente + "?periodo=todo#recibo-" + numero
	case factura != nil:
		return "/admin/facturacion/" + *factura
	case cliente != nil:
		return "/admin/clientes/" + *cliente + "?periodo=todo"
	}
	return "/admin/facturacion"
}

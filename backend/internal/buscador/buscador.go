// Package buscador es el buscador del panel (lib/dal/admin/busqueda-panel.ts):
// clientes, pedidos, presupuestos, comprobantes, cortes y proveedores, hasta
// cuatro de cada uno, y solo de las pantallas a las que entra el rol.
package buscador

import (
	"context"
	"encoding/json"
	"fmt"
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
	t := strings.Fields(texto)
	if len(t) > 6 {
		t = t[:6]
	}
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

func juntar(partes ...*string) string {
	var out []string
	for _, p := range partes {
		if p != nil && *p != "" {
			out = append(out, *p)
		}
	}
	return strings.Join(out, " · ")
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

// Buscar es buscarEnElPanel.
func Buscar(ctx context.Context, pool *pgxpool.Pool, rol *sqlc.StaffRole, texto string) ([]Resultado, error) {
	texto = strings.TrimSpace(texto)
	out := []Resultado{}
	if len([]rune(texto)) < 2 {
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
			filas, err := pool.Query(ctx, `SELECT id, nombre, razon_social, cuit, telefono FROM customers WHERE `+
				coincide(texto, &a, "nombre", "razon_social", "cuit", "telefono")+` ORDER BY nombre LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, nombre string
				var razon, cuit, tel *string
				err := r.Scan(&id, &nombre, &razon, &cuit, &tel)
				return Resultado{id, "Cliente", nombre, juntar(razon, cuit, tel), "/admin/clientes/" + id}, err
			})
		}},
		{"/admin/pedidos", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, numero, contacto_nombre, estado::text, created_at FROM orders WHERE `+
				coincide(texto, &a, "numero", "contacto_nombre")+` ORDER BY created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, contacto, estado string
				var creado time.Time
				err := r.Scan(&id, &numero, &contacto, &estado, &creado)
				return Resultado{id, "Pedido", numero + " · " + contacto, estado + " · " + fecha(creado), "/admin/pedidos/" + id}, err
			})
		}},
		{"/admin/presupuestos", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, numero, contacto_nombre, estado::text, created_at FROM quotes WHERE `+
				coincide(texto, &a, "numero", "contacto_nombre")+` ORDER BY created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, contacto, estado string
				var creado time.Time
				err := r.Scan(&id, &numero, &contacto, &estado, &creado)
				return Resultado{id, "Presupuesto", numero + " · " + contacto, estado + " · " + fecha(creado), "/admin/presupuestos/" + id}, err
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
		{"/admin/cortes", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, numero, contacto_nombre, material_descripcion, estado::text FROM cutting_orders WHERE `+
				coincide(texto, &a, "numero", "contacto_nombre", "material_descripcion")+` ORDER BY created_at DESC LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, numero, contacto, material, estado string
				err := r.Scan(&id, &numero, &contacto, &material, &estado)
				return Resultado{id, "Corte", numero + " · " + contacto, material + " · " + estado, "/admin/cortes/" + id}, err
			})
		}},
		{"/admin/proveedores", func() ([]Resultado, error) {
			var a []any
			filas, err := pool.Query(ctx, `SELECT id, nombre, razon_social, cuit, rubro FROM suppliers WHERE `+
				coincide(texto, &a, "nombre", "razon_social", "cuit", "rubro")+` ORDER BY nombre LIMIT 4`, a...)
			if err != nil {
				return nil, err
			}
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Resultado, error) {
				var id, nombre string
				var razon, cuit, rubro *string
				err := r.Scan(&id, &nombre, &razon, &cuit, &rubro)
				return Resultado{id, "Proveedor", nombre, juntar(razon, cuit, rubro), "/admin/proveedores/" + id}, err
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

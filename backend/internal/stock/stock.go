// Package stock es el stock del panel: la grilla por sucursal, las alertas,
// los últimos movimientos, el ajuste rápido y la transferencia entre
// sucursales. Era app/admin/stock y lib/dal/admin/inventory.ts.
//
// Todo cambio de cantidad toma el candado de lib/inventario/locks.ts
// (hashtext(variante || sucursal)), el mismo de las reservas del TS, y deja
// su movimiento.
package stock

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/catalogo"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/listado"
	"mjbj/internal/plataforma"
	"mjbj/internal/productos"
	"mjbj/internal/sqlc"
)

// Servicio es el stock.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

// --- ayudantes (lib/unidades.ts) ---

// Cantidad es cantidadDeStock: redondeada a 3 decimales.
func Cantidad(v float64) float64 { return jsmath.Round(v*1000) / 1000 }

var reCantidad = regexp.MustCompile(`^-?\d+(\.\d+)?$`)

// LeerCantidad es leerCantidad: «2,5», «2.5» y «2» son lo mismo; lo demás
// (incluido «1e3») es NaN.
func LeerCantidad(texto string) float64 {
	if texto == "" {
		return math.NaN()
	}
	limpio := strings.Replace(strings.TrimSpace(texto), ",", ".", 1)
	if !reCantidad.MatchString(limpio) {
		return math.NaN()
	}
	return jsmath.Numero(limpio)
}

var nombreLargo = map[string]string{
	"unidad": "unidad", "metro_lineal": "metro", "metro_cuadrado": "metro cuadrado", "tabla": "tabla",
	"placa": "placa", "rollo": "rollo", "par": "par", "juego": "juego", "kg": "kilo", "litro": "litro",
}

// UnidadLarga es formatearUnidadLarga: la unidad dicha en una oración.
func UnidadLarga(u string) string {
	if u == "" {
		return "unidad"
	}
	if n, ok := nombreLargo[u]; ok {
		return n
	}
	return strings.ReplaceAll(u, "_", " ")
}

// revisarCantidad es revisarCantidadDeStock: una cantidad con decimales solo
// para lo que se fracciona.
func (s *Servicio) revisarCantidad(ctx context.Context, variante string, cantidad float64) error {
	if math.IsNaN(cantidad) || math.IsInf(cantidad, 0) {
		return plataforma.Invalido(map[string]string{"cantidad": "La cantidad tiene que ser un número."})
	}
	unidad, err := s.q.UnidadDeVariante(ctx, variante)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.Invalido(map[string]string{"variantId": "No se encontró el producto."})
	}
	if err != nil {
		return err
	}
	if !productos.AdmiteDecimales(unidad) && cantidad != math.Trunc(cantidad) {
		return plataforma.Invalido(map[string]string{"cantidad": "Este producto se cuenta por " + UnidadLarga(unidad) + ": la cantidad va sin decimales."})
	}
	return nil
}

// --- la grilla ---

// Sucursal es una de las sucursales activas, en el orden de la base. La
// grilla tiene una columna por cada una: salen de `branches`, no de una lista
// escrita en el código.
type Sucursal struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Nombre string `json:"nombre"`
}

// StockEnSucursal es el stock de una medida en una sucursal.
type StockEnSucursal struct {
	Sucursal
	Qty       float64             `json:"qty"`
	Reservado float64             `json:"reservado"`
	Min       float64             `json:"min"`
	Nivel     catalogo.NivelStock `json:"nivel"`
}

// FilaStock es una medida con su stock en cada sucursal activa.
type FilaStock struct {
	VariantID    string            `json:"variantId"`
	ProductID    string            `json:"productId"`
	ProductSlug  string            `json:"productSlug"`
	ProductName  string            `json:"productName"`
	Label        string            `json:"label"`
	SKU          string            `json:"sku"`
	CodigoBarras *string           `json:"codigoBarras"`
	CategoryName string            `json:"categoryName"`
	Unidad       string            `json:"unidad"`
	LargoMm      *int32            `json:"largoMm"`
	Imagen       *string           `json:"imagen"`
	Sucursales   []StockEnSucursal `json:"sucursales"`
	Total        float64           `json:"total"`
}

// ConteosDeStock son los totales de cada grupo con los mismos filtros.
type ConteosDeStock struct {
	Todas    int `json:"todas"`
	SinStock int `json:"sinStock"`
	Reponer  int `json:"reponer"`
	ConStock int `json:"conStock"`
}

// GrillaDeStock es una página de la grilla, con el total del filtro y las
// sucursales que forman las columnas.
type GrillaDeStock struct {
	Filas      []FilaStock    `json:"filas"`
	Total      int            `json:"total"`
	Conteos    ConteosDeStock `json:"conteos"`
	Sucursales []Sucursal     `json:"sucursales"`
}

// PorPaginaStock: dos columnas de tarjetas.
const PorPaginaStock = 30

// Sucursales son las activas, por orden.
func (s *Servicio) Sucursales(ctx context.Context) ([]Sucursal, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, slug, name FROM branches WHERE active ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (Sucursal, error) {
		var x Sucursal
		return x, r.Scan(&x.ID, &x.Slug, &x.Nombre)
	})
}

// Los grupos de la pantalla, en SQL. «Total» es la suma del físico en las
// sucursales activas; «bajo» es catalogo.Nivel == Bajo en alguna: hay
// disponible, hay mínimo y el disponible no lo supera. Una sucursal en cero
// con otra con stock no cuenta como «reponer», igual que antes.
const (
	totalDeLaMedida = `coalesce((SELECT sum(i.qty) FROM inventory i JOIN branches b ON b.id = i.branch_id AND b.active WHERE i.variant_id = v.id), 0)`
	bajoEnAlguna    = `EXISTS (SELECT 1 FROM inventory i JOIN branches b ON b.id = i.branch_id AND b.active
		WHERE i.variant_id = v.id AND i.min_qty > 0 AND greatest(i.qty - i.reservado, 0) > 0
		  AND greatest(i.qty - i.reservado, 0) <= i.min_qty)`
)

var estadosDeStock = map[string]string{
	"sin-stock": totalDeLaMedida + ` = 0`,
	"reponer":   totalDeLaMedida + ` > 0 AND ` + bajoEnAlguna,
	"con-stock": `NOT (` + totalDeLaMedida + ` = 0) AND NOT (` + totalDeLaMedida + ` > 0 AND ` + bajoEnAlguna + `)`,
}

// Listar es listarStock, de a páginas: las medidas activas, por nombre.
func (s *Servicio) Listar(ctx context.Context, f listado.Filtros) (GrillaDeStock, error) {
	out := GrillaDeStock{Filas: []FilaStock{}, Sucursales: []Sucursal{}}
	sucs, err := s.Sucursales(ctx)
	if err != nil {
		return out, err
	}
	out.Sucursales = append(out.Sucursales, sucs...)
	var c listado.Consulta
	c.Y("p.active")
	c.Y("v.active")
	c.Comunes(f, "v.id")
	// El lector de código de barras escribe el número entero.
	c.Busqueda(f.Busqueda, []string{"p.name", "v.sku", "v.label", "v.material", "v.color", "c.name"}, "v.codigo_barras")
	desde := ` FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id `
	k := &out.Conteos
	if err := s.pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE `+estadosDeStock["sin-stock"]+`),
		count(*) FILTER (WHERE `+estadosDeStock["reponer"]+`), count(*) FILTER (WHERE `+estadosDeStock["con-stock"]+`)`+desde+c.Donde(),
		c.Args()...).Scan(&k.Todas, &k.SinStock, &k.Reponer, &k.ConStock); err != nil {
		return out, err
	}
	out.Total = map[string]int{"sin-stock": k.SinStock, "reponer": k.Reponer, "con-stock": k.ConStock}[f.Estado]
	if cond, ok := estadosDeStock[f.Estado]; ok {
		c.Y(cond)
	} else {
		out.Total = k.Todas
	}
	limite, salto := f.Pagina(PorPaginaStock)
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, p.slug, p.name, v.label, v.sku, v.codigo_barras, c.name, p.unit::text, v.largo_mm,
		  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order LIMIT 1)
		`+desde+c.Donde()+`
		ORDER BY p.name, v.sort_order, v.id
		LIMIT `+c.Arg(limite)+` OFFSET `+c.Arg(salto), c.Args()...)
	if err != nil {
		return out, err
	}
	pagina, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaStock, error) {
		var x FilaStock
		err := r.Scan(&x.VariantID, &x.ProductID, &x.ProductSlug, &x.ProductName, &x.Label, &x.SKU, &x.CodigoBarras,
			&x.CategoryName, &x.Unidad, &x.LargoMm, &x.Imagen)
		return x, err
	})
	if err != nil || len(pagina) == 0 {
		return out, err
	}
	ids := make([]string, len(pagina))
	for i, x := range pagina {
		ids[i] = x.VariantID
	}
	type clave struct{ variante, sucursal string }
	type cantidades struct{ qty, res, min float64 }
	inv := map[clave]cantidades{}
	rs, err := s.pool.Query(ctx, `SELECT variant_id, branch_id, qty::float8, reservado::float8, min_qty::float8
		FROM inventory WHERE variant_id = ANY($1::uuid[])`, ids)
	if err != nil {
		return out, err
	}
	for rs.Next() {
		var k clave
		var c cantidades
		if err := rs.Scan(&k.variante, &k.sucursal, &c.qty, &c.res, &c.min); err != nil {
			rs.Close()
			return out, err
		}
		inv[k] = c
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return out, err
	}
	for i := range pagina {
		x := &pagina[i]
		x.Sucursales = make([]StockEnSucursal, len(sucs))
		suma := 0.0
		for j, b := range sucs {
			c := inv[clave{x.VariantID, b.ID}]
			x.Sucursales[j] = StockEnSucursal{Sucursal: b, Qty: c.qty, Reservado: c.res, Min: c.min,
				Nivel: catalogo.Nivel(catalogo.Disponible(c.qty, c.res), c.min)}
			suma += c.qty
		}
		x.Total = Cantidad(suma)
	}
	out.Filas = pagina
	return out, nil
}

// Alerta es una medida en o debajo de su mínimo.
type Alerta struct {
	VariantID   string  `json:"variantId"`
	ProductName string  `json:"productName"`
	Label       string  `json:"label"`
	BranchName  string  `json:"branchName"`
	Qty         float64 `json:"qty"`
	Reservado   float64 `json:"reservado"`
	MinQty      float64 `json:"minQty"`
}

// Alertas son las medidas cuyo disponible llegó al mínimo, las más justas primero.
func (s *Servicio) Alertas(ctx context.Context, limite int) ([]Alerta, error) {
	filas, err := s.q.AlertasDeStock(ctx, int32(limite))
	if err != nil {
		return nil, err
	}
	out := make([]Alerta, len(filas))
	for i, f := range filas {
		out[i] = Alerta{f.VariantID, f.ProductName, f.Label, f.BranchName, float64(f.Qty), float64(f.Reservado), float64(f.MinQty)}
	}
	return out, nil
}

// Movimiento es uno de los últimos.
type Movimiento struct {
	ID          string    `json:"id"`
	ProductID   string    `json:"productId"`
	ProductName string    `json:"productName"`
	Label       string    `json:"label"`
	BranchName  string    `json:"branchName"`
	Type        string    `json:"type"`
	Qty         float64   `json:"qty"`
	Note        *string   `json:"note"`
	CreatedAt   time.Time `json:"createdAt"`
}

// Movimientos son los últimos.
func (s *Servicio) Movimientos(ctx context.Context, limite int) ([]Movimiento, error) {
	filas, err := s.q.UltimosMovimientos(ctx, int32(limite))
	if err != nil {
		return nil, err
	}
	out := make([]Movimiento, len(filas))
	for i, f := range filas {
		out[i] = Movimiento{f.ID, f.ProductID, f.ProductName, f.Label, f.BranchName, string(f.Type), float64(f.Qty), f.Note, f.CreatedAt}
	}
	return out, nil
}

// --- el ajuste rápido ---

// Ajustar suma (o resta) una cantidad al stock de una sucursal: el ajuste
// rápido de la grilla. Devuelve el mensaje («Casa Central: 3 → 5»), o "" si
// la cantidad es cero (no hace nada).
func (s *Servicio) Ajustar(ctx context.Context, ses *auth.Sesion, variante, sucursal string, delta float64) (string, error) {
	return s.AjustarCon(ctx, ses, variante, sucursal, delta, nil, "")
}

// MotivosDeAjuste es por qué se tocó el stock a mano, para el libro de
// movimientos: un faltante por rotura no es lo mismo que uno por conteo.
//
// «correccion» es el «Deshacer» del ajuste rápido: el movimiento inverso de
// uno que se cargó mal. Queda en el libro con su nombre, y no como «otro»: un
// libro lleno de «otro» no le dice nada a nadie (T4, hallazgo 21).
var MotivosDeAjuste = map[string]string{
	"ingreso": "Ingreso", "rotura": "Rotura", "conteo": "Conteo", "devolucion": "Devolución",
	"faltante": "Faltante", "correccion": "Corrección", "otro": "Ajuste",
}

// revisarDireccion: el motivo dice para qué lado va el stock. Un ingreso que
// resta o una rotura que suma dejan el libro diciendo lo contrario de lo que
// pasó; la pantalla convertía en silencio una «rotura» que sumaba en «otro»
// (T4, hallazgo 21). La devolución va para los dos lados —la del cliente
// entra, la al proveedor sale—, y la corrección y «otro» también: deshacer
// una rotura es sumar.
func revisarDireccion(motivo string, delta float64, contado *float64) error {
	mal := func(m string) error { return plataforma.Invalido(map[string]string{"motivo": m}) }
	if contado != nil {
		if motivo != "" && motivo != "conteo" {
			return mal("Lo contado va con el motivo «Conteo».")
		}
		return nil
	}
	switch motivo {
	case "conteo":
		return mal("Para contar hay que decir cuánto hay.")
	case "ingreso":
		if delta < 0 {
			return mal("Un ingreso suma: para sacar, elegí otro motivo.")
		}
	case "rotura", "faltante":
		if delta > 0 {
			return mal("«" + MotivosDeAjuste[motivo] + "» resta: para sumar, elegí otro motivo.")
		}
	}
	return nil
}

// AjustarCon es Ajustar con el motivo y, si viene `contado`, fijando el stock
// en lo que se contó. La diferencia se calcula adentro, con el candado: si
// se vendió algo mientras se contaba, el conteo no lo pisa con un número
// viejo de la pantalla.
func (s *Servicio) AjustarCon(ctx context.Context, ses *auth.Sesion, variante, sucursal string, delta float64, contado *float64, motivo string) (string, error) {
	cantidad := Cantidad(delta)
	if contado != nil {
		c := Cantidad(*contado)
		contado = &c
		cantidad = 0
	}
	// La sucursal la busca SucursalPorSlug más abajo: estaban las dos escritas
	// acá y una tercera no se podía ajustar desde la grilla.
	if !plataforma.UUIDValido(variante) || strings.TrimSpace(sucursal) == "" || math.IsNaN(cantidad) || math.IsInf(cantidad, 0) ||
		contado != nil && (math.IsNaN(*contado) || math.IsInf(*contado, 0) || *contado < 0) {
		return "", plataforma.Invalido(map[string]string{"cantidad": "La cantidad tiene que ser un número, sin letras."})
	}
	if _, ok := MotivosDeAjuste[motivo]; motivo != "" && !ok {
		return "", plataforma.Invalido(map[string]string{"motivo": "Ese motivo no existe."})
	}
	if err := revisarDireccion(motivo, cantidad, contado); err != nil {
		return "", err
	}
	if cantidad == 0 && contado == nil {
		return "", nil
	}
	revisar := cantidad
	if contado != nil {
		revisar = *contado
	}
	if err := s.revisarCantidad(ctx, variante, revisar); err != nil {
		return "", err
	}
	suc, err := s.q.SucursalPorSlug(ctx, sucursal)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.Invalido(map[string]string{"branchSlug": "No se encontró la sucursal."})
	}
	if err != nil {
		return "", err
	}
	var ok string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: variante, Sucursal: suc.ID}); err != nil {
			return err
		}
		previo, reservado := 0.0, 0.0
		if a, err := q.StockYReservado(ctx, sqlc.StockYReservadoParams{VariantID: variante, BranchID: suc.ID}); err == nil {
			previo, reservado = float64(a.Qty), float64(a.Reservado)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if contado != nil {
			cantidad = Cantidad(*contado - previo)
			if cantidad == 0 {
				ok = suc.Name + ": el conteo coincide, " + formato.Cantidad(previo)
				return nil
			}
		}
		nuevo := Cantidad(previo + cantidad)
		if nuevo < 0 {
			return plataforma.Invalido(map[string]string{"cantidad": "Solo hay " + formato.Cantidad(previo) + " en " + suc.Name + "."})
		}
		// Lo reservado es de clientes que ya pagaron: un ajuste que baja el
		// físico no puede dejar lo disponible en negativo (el TS miraba solo
		// el físico, como la transferencia). Sumar siempre se puede.
		if cantidad < 0 && nuevo < reservado {
			libre := catalogo.Disponible(previo, reservado)
			m := "En " + suc.Name + " hay " + formato.Cantidad(previo) + " y " + formato.Cantidad(reservado) +
				" está" + pluralN(reservado) + " reservado" + plural(reservado) + " para clientes"
			if libre > 0 {
				m += ": se pueden sacar hasta " + formato.Cantidad(libre) + "."
			} else {
				m += ": no se puede sacar nada sin antes liberar o entregar esas reservas."
			}
			return plataforma.Invalido(map[string]string{"cantidad": m})
		}
		if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: variante, BranchID: suc.ID, Qty: jsmath.Num(nuevo)}); err != nil {
			return err
		}
		tipo := sqlc.MovementTypeEgreso
		if cantidad > 0 {
			tipo = sqlc.MovementTypeIngreso
		}
		que := "Ajuste rápido desde Stock"
		if m, ok := MotivosDeAjuste[motivo]; ok && motivo != "otro" {
			que = m + " desde Stock"
		}
		// La devolución va para los dos lados, y el libro dice cuál: la que
		// entra es de un cliente y la que sale, a un proveedor (comité de T4:
		// la pantalla solo la ofrecía sumando, y la del proveedor quedaba
		// como «Faltante»).
		if motivo == "devolucion" {
			que = "Devolución de cliente desde Stock"
			if cantidad < 0 {
				que = "Devolución al proveedor desde Stock"
			}
		}
		nota := que + " (" + formato.Cantidad(previo) + " → " + formato.Cantidad(nuevo) + ")"
		ok = suc.Name + ": " + formato.Cantidad(previo) + " → " + formato.Cantidad(nuevo)
		return q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: variante, BranchID: suc.ID, Type: tipo,
			Qty: jsmath.Num(cantidad), Note: &nota, CreatedByUserID: &ses.UserID})
	})
	return ok, err
}

// --- la transferencia ---

// FormTransferencia es el formulario, como texto.
type FormTransferencia struct{ VariantID, OrigenID, DestinoID, Cantidad, Nota string }

func validarTransferencia(f FormTransferencia) (float64, string, error) {
	mal := func(campo, m string) (float64, string, error) {
		return 0, "", plataforma.Invalido(map[string]string{campo: m})
	}
	if !plataforma.UUIDValido(f.VariantID) {
		return mal("variantId", "Elegí un producto.")
	}
	if !plataforma.UUIDValido(f.OrigenID) {
		return mal("origenId", "Elegí la sucursal de origen.")
	}
	if !plataforma.UUIDValido(f.DestinoID) {
		return mal("destinoId", "Elegí la sucursal de destino.")
	}
	c := Cantidad(LeerCantidad(f.Cantidad))
	switch {
	case math.IsNaN(c):
		return mal("cantidad", "Invalid input: expected number, received NaN")
	case math.IsInf(c, 0):
		return mal("cantidad", "La cantidad tiene que ser un número.")
	case c <= 0:
		return mal("cantidad", "La cantidad tiene que ser mayor a cero.")
	}
	nota := strings.TrimSpace(f.Nota)
	if plataforma.LargoJS(nota) > 300 {
		return mal("nota", "Too big: expected string to have <=300 characters")
	}
	return c, nota, nil
}

// Transferir mueve stock de una sucursal a otra: un movimiento de salida y
// uno de entrada con el mismo grupo.
//
// Dos diferencias con el TS, a propósito: toma el candado de las dos
// sucursales (el TS no tomaba ninguno y podía pisarse con una venta), en un
// orden fijo para que dos transferencias cruzadas no se traben, y controla
// contra lo disponible (físico − reservado), no contra el físico: el TS
// dejaba mover mercadería ya reservada para un cliente.
func (s *Servicio) Transferir(ctx context.Context, ses *auth.Sesion, f FormTransferencia) error {
	cantidad, nota, err := validarTransferencia(f)
	if err != nil {
		return err
	}
	if f.OrigenID == f.DestinoID {
		return plataforma.Invalido(map[string]string{"destinoId": "El origen y el destino tienen que ser distintos."})
	}
	if err := s.revisarCantidad(ctx, f.VariantID, cantidad); err != nil {
		return err
	}
	var notaP *string
	if nota != "" {
		notaP = &nota
	}
	grupo := uuid()
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		sucursales := []string{f.OrigenID, f.DestinoID}
		sort.Strings(sucursales)
		for _, suc := range sucursales {
			if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: f.VariantID, Sucursal: suc}); err != nil {
				return err
			}
		}
		fisico, reservado := 0.0, 0.0
		if a, err := q.StockYReservado(ctx, sqlc.StockYReservadoParams{VariantID: f.VariantID, BranchID: f.OrigenID}); err == nil {
			fisico, reservado = float64(a.Qty), float64(a.Reservado)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if disponible := catalogo.Disponible(fisico, reservado); disponible < cantidad {
			m := "En la sucursal de origen hay " + formato.Cantidad(fisico)
			if reservado > 0 {
				m += " (" + formato.Cantidad(reservado) + " reservado" + plural(reservado) + " para clientes)"
			}
			return plataforma.Invalido(map[string]string{"cantidad": m + ". No se pueden mover " + formato.Cantidad(cantidad) + "."})
		}
		if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: f.VariantID, BranchID: f.OrigenID, Qty: jsmath.Num(Cantidad(fisico - cantidad))}); err != nil {
			return err
		}
		if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: f.VariantID, BranchID: f.DestinoID, Qty: jsmath.Num(cantidad)}); err != nil {
			return err
		}
		for _, m := range []struct {
			suc  string
			tipo sqlc.MovementType
			qty  float64
		}{{f.OrigenID, sqlc.MovementTypeTransferenciaSalida, -cantidad}, {f.DestinoID, sqlc.MovementTypeTransferenciaEntrada, cantidad}} {
			if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: f.VariantID, BranchID: m.suc, Type: m.tipo,
				Qty: jsmath.Num(m.qty), Note: notaP, CreatedByUserID: &ses.UserID, TransferGroup: &grupo}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	desc := "Transfirió " + jsmath.Texto(cantidad) + " entre sucursales"
	if nota != "" {
		desc += ": " + nota
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "stock", f.VariantID, desc,
		map[string]any{"variantId": f.VariantID, "origenId": f.OrigenID, "destinoId": f.DestinoID, "cantidad": cantidad})
	return nil
}

func plural(n float64) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// pluralN es la n del verbo: «está» o «están».
func pluralN(n float64) string {
	if n == 1 {
		return ""
	}
	return "n"
}

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

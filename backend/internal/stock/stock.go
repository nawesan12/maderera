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

// FilaStock es una medida con su stock en las dos sucursales.
type FilaStock struct {
	VariantID           string              `json:"variantId"`
	ProductID           string              `json:"productId"`
	ProductSlug         string              `json:"productSlug"`
	ProductName         string              `json:"productName"`
	Label               string              `json:"label"`
	SKU                 string              `json:"sku"`
	CategoryName        string              `json:"categoryName"`
	Unidad              string              `json:"unidad"`
	LargoMm             *int32              `json:"largoMm"`
	Imagen              *string             `json:"imagen"`
	QtyCentral          float64             `json:"qtyCentral"`
	QtyAserradero       float64             `json:"qtyAserradero"`
	ReservadoCentral    float64             `json:"reservadoCentral"`
	ReservadoAserradero float64             `json:"reservadoAserradero"`
	MinCentral          float64             `json:"minCentral"`
	MinAserradero       float64             `json:"minAserradero"`
	NivelCentral        catalogo.NivelStock `json:"nivelCentral"`
	NivelAserradero     catalogo.NivelStock `json:"nivelAserradero"`
	Total               float64             `json:"total"`
}

// Listar es listarStock: las medidas activas, por nombre.
func (s *Servicio) Listar(ctx context.Context, busqueda, categoria string) ([]FilaStock, error) {
	cond := []string{"p.active", "v.active"}
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if categoria != "" && categoria != "todos" {
		cond = append(cond, "c.slug = "+arg(categoria))
	}
	t := strings.Fields(busqueda)
	if len(t) > 6 {
		t = t[:6]
	}
	for _, termino := range t {
		patron := arg("%" + termino + "%")
		var col []string
		for _, c := range []string{"p.name", "v.sku", "v.label", "v.material", "c.name"} {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+patron+")")
		}
		cond = append(cond, "("+strings.Join(col, " OR ")+")")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, p.slug, p.name, v.label, v.sku, c.name, p.unit::text, v.largo_mm,
		  (SELECT i.url FROM product_images i WHERE i.product_id = p.id ORDER BY i.sort_order LIMIT 1),
		  b.slug, inv.qty::float8, inv.reservado::float8, inv.min_qty::float8
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN inventory inv ON inv.variant_id = v.id
		LEFT JOIN branches b ON b.id = inv.branch_id
		WHERE `+strings.Join(cond, " AND ")+`
		ORDER BY p.name, v.sort_order`, args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var orden []string
	por := map[string]*FilaStock{}
	for filas.Next() {
		var f FilaStock
		var suc *string
		var qty, res, min *float64
		if err := filas.Scan(&f.VariantID, &f.ProductID, &f.ProductSlug, &f.ProductName, &f.Label, &f.SKU, &f.CategoryName,
			&f.Unidad, &f.LargoMm, &f.Imagen, &suc, &qty, &res, &min); err != nil {
			return nil, err
		}
		x, ok := por[f.VariantID]
		if !ok {
			f.NivelCentral, f.NivelAserradero = catalogo.SinStock, catalogo.SinStock
			x = &f
			por[f.VariantID] = x
			orden = append(orden, f.VariantID)
		}
		v := func(p *float64) float64 {
			if p == nil {
				return 0
			}
			return *p
		}
		switch deref(suc) {
		case "casa-central":
			x.QtyCentral, x.ReservadoCentral, x.MinCentral = v(qty), v(res), v(min)
			x.NivelCentral = catalogo.Nivel(catalogo.Disponible(x.QtyCentral, x.ReservadoCentral), x.MinCentral)
		case "aserradero":
			x.QtyAserradero, x.ReservadoAserradero, x.MinAserradero = v(qty), v(res), v(min)
			x.NivelAserradero = catalogo.Nivel(catalogo.Disponible(x.QtyAserradero, x.ReservadoAserradero), x.MinAserradero)
		}
		x.Total = Cantidad(x.QtyCentral + x.QtyAserradero)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	out := make([]FilaStock, len(orden))
	for i, id := range orden {
		out[i] = *por[id]
	}
	return out, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
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
	cantidad := Cantidad(delta)
	if !plataforma.UUIDValido(variante) || (sucursal != "casa-central" && sucursal != "aserradero") || math.IsNaN(cantidad) || math.IsInf(cantidad, 0) {
		return "", plataforma.Invalido(map[string]string{"cantidad": "La cantidad tiene que ser un número, sin letras."})
	}
	if cantidad == 0 {
		return "", nil
	}
	if err := s.revisarCantidad(ctx, variante, cantidad); err != nil {
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
		nota := "Ajuste rápido desde Stock (" + formato.Cantidad(previo) + " → " + formato.Cantidad(nuevo) + ")"
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

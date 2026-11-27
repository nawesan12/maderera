package cortes

// La cola del taller y la ficha de cada trabajo: lib/dal/admin/cortes.ts,
// lib/dal/cortes-tarifas.ts, lib/dal/admin/cortes-exportacion.ts,
// lib/dal/calculadora-parametros.ts y las acciones de app/admin/cortes.

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/catalogo"
	"mjbj/internal/cola"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// Servicio es el corte a medida.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	cat  *catalogo.Servicio
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), cat: catalogo.Nuevo(pool), log: log}
}

var noEncontrado = plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el corte.")

// error422 es un aviso para quien está usando la pantalla (el `{ error }`
// que devolvía la acción).
func error422(msg string) error { return plataforma.Invalido(map[string]string{"form": msg}) }

// --- la cola ---

// CorteListado es un renglón de la cola.
type CorteListado struct {
	ID              string    `json:"id"`
	Numero          string    `json:"numero"`
	Cliente         string    `json:"cliente"`
	Material        string    `json:"material"`
	Placas          int32     `json:"placas"`
	Pasadas         int32     `json:"pasadas"`
	Estado          string    `json:"estado"`
	Urgente         bool      `json:"urgente"`
	Sucursal        *string   `json:"sucursal"`
	Notas           *string   `json:"notas"`
	Piezas          int32     `json:"piezas"`
	MetrosCuadrados float64   `json:"metrosCuadrados"`
	CreatedAt       time.Time `json:"createdAt"`
	// Mitad: las placas de la tarjeta son medias (mes simulado, H052).
	Mitad    *string `json:"mitad"`
	SinCargo bool    `json:"sinCargo"`
	BranchID *string `json:"branchId"`
	// SalioAt es cuándo salió de la máquina: terminado_at, o para lo de antes
	// de la 00240 la última modificación. Nulo mientras está en la cola.
	SalioAt *time.Time `json:"salioAt"`
	// UpdatedAt es lo que compara el agente del taller para volver a bajar
	// un corte corregido. No sale en la cola.
	UpdatedAt time.Time `json:"-"`
}

// condicionBusqueda es coincideBusqueda: cada palabra (hasta 6) en alguna
// columna, sin tildes.
func condicionBusqueda(texto string, columnas []string, args *[]any) string {
	terminos := strings.Fields(texto)
	if len(terminos) > 6 {
		terminos = terminos[:6]
	}
	if len(terminos) == 0 {
		return ""
	}
	var porTermino []string
	for _, t := range terminos {
		*args = append(*args, "%"+t+"%")
		p := "$" + strconv.Itoa(len(*args))
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		porTermino = append(porTermino, "("+strings.Join(col, " OR ")+")")
	}
	return "(" + strings.Join(porTermino, " AND ") + ")"
}

// Listar es listarCortes: primero lo urgente, después por antigüedad.
// sucursal (un id) deja solo los de ese taller. Un corte sin sucursal (de
// antes, o cargado sin elegirla) va al taller de la primera sucursal activa,
// la misma que le pone el alta: antes salía en los dos talleres y lo podían
// cortar dos veces (tercera prueba del mes).
func (s *Servicio) Listar(ctx context.Context, busqueda, estado string, sucursal ...string) ([]CorteListado, error) {
	var args []any
	var cond []string
	if estado != "" && estado != "todos" {
		args = append(args, estado)
		cond = append(cond, "co.estado::text = $1")
	}
	if len(sucursal) > 0 && sucursal[0] != "" && plataforma.UUIDValido(sucursal[0]) {
		args = append(args, sucursal[0])
		n := "$" + strconv.Itoa(len(args)) + "::uuid"
		cond = append(cond, "(co.branch_id = "+n+" OR (co.branch_id IS NULL AND "+n+
			" = (SELECT id FROM branches WHERE active ORDER BY sort_order LIMIT 1)))")
	}
	if c := condicionBusqueda(busqueda, []string{"co.numero", "co.contacto_nombre", "co.material_descripcion"}, &args); c != "" {
		cond = append(cond, c)
	} else if estado == "" || estado == "todos" {
		// En el tablero, de lo retirado y lo cancelado solo lo de hoy: las
		// columnas juntaban todo desde el primer día (los cancelados, comité
		// final). Lo anterior se encuentra buscando o filtrando por estado.
		cond = append(cond, `(co.estado NOT IN ('retirado', 'cancelado') OR co.updated_at >= (date_trunc('day', now() AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'America/Argentina/Buenos_Aires'))`)
	}
	where := ""
	if len(cond) > 0 {
		where = "WHERE " + strings.Join(cond, " AND ")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT co.id::text, co.numero, co.contacto_nombre, co.material_descripcion, co.placas, co.pasadas,
		       co.estado::text, co.urgente, co.notas, b.name, co.created_at, co.updated_at, r.piezas, r.superficie,
		       co.mitad::text, co.sin_cargo, co.branch_id::text,
		       CASE WHEN co.estado IN ('terminado', 'retirado') THEN coalesce(co.terminado_at, co.updated_at) END,
		       pv.largo_mm, pv.ancho_mm
		FROM cutting_orders co
		LEFT JOIN branches b ON b.id = co.branch_id
		LEFT JOIN product_variants pv ON pv.id = co.variant_id
		LEFT JOIN (
			-- Las piezas solo de los cortes del tablero: antes se agrupaba
			-- cutting_items entero, con todo lo cortado desde el primer día.
			SELECT cutting_order_id, sum(cantidad)::int AS piezas,
			       sum(largo_mm * ancho_mm * cantidad / 1000000.0) AS superficie
			FROM cutting_items
			WHERE cutting_order_id IN (SELECT co.id FROM cutting_orders co `+where+`)
			GROUP BY cutting_order_id
		) r ON r.cutting_order_id = co.id
		`+where+`
		ORDER BY co.urgente DESC, co.created_at ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []CorteListado{}
	for filas.Next() {
		var c CorteListado
		var urgente int32
		var piezas *int32
		var sup *jsmath.Num
		var vl, va *int32
		if err := filas.Scan(&c.ID, &c.Numero, &c.Cliente, &c.Material, &c.Placas, &c.Pasadas, &c.Estado, &urgente,
			&c.Notas, &c.Sucursal, &c.CreatedAt, &c.UpdatedAt, &piezas, &sup, &c.Mitad, &c.SinCargo, &c.BranchID, &c.SalioAt, &vl, &va); err != nil {
			return nil, err
		}
		c.Material = MaterialEnOrden(c.Material, vl, va)
		c.Urgente = urgente == 1
		if piezas != nil {
			c.Piezas = *piezas
		}
		if sup != nil {
			c.MetrosCuadrados = jsmath.Round(float64(sup.F()*100)) / 100
		}
		out = append(out, c)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	filas.Close()
	// Las placas de la tarjeta son las del plano, que es lo que el operario
	// baja del depósito (mes simulado, H113): las del alta las tipeaba una
	// persona y podían decir 3 con un plano de 2. Desde el arreglo el alta
	// guarda las del plano; esto corrige en la cola lo cargado antes.
	for i := range out {
		if out[i].Estado != "en-cola" && out[i].Estado != "en-proceso" {
			continue
		}
		c, err := s.Obtener(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		if c == nil || len(c.Piezas) == 0 {
			continue
		}
		// Con las placas que vende su pedido marcadas: si las vende todas,
		// no hay pasadas que confirmar (H184).
		plano, err := s.PlanoParaCobrar(ctx, c)
		if err != nil {
			return nil, err
		}
		if n := len(plano.Placas); n > 0 {
			out[i].Placas = int32(n)
		}
		// Las que el taller confirma al terminar (H403): las guardadas o,
		// en uno de antes que no las tenía, las del plano.
		out[i].Pasadas = int32(PasadasACobrar(c, plano))
	}
	return out, nil
}

// CorteDelPedido es un corte que salió de un pedido.
type CorteDelPedido struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Material  string    `json:"material"`
	Estado    string    `json:"estado"`
	Urgente   int32     `json:"urgente"`
	CreatedAt time.Time `json:"createdAt"`
	// VariantID y PlacasEnteras: con qué placa y cuántas (dos medias son
	// una), para que el alta cuente lo que ya usan los otros cortes del
	// pedido, como la ficha (mes simulado, H184).
	VariantID     *string `json:"variantId"`
	PlacasEnteras float64 `json:"placasEnteras"`
	SinCargo      bool    `json:"sinCargo"`
}

// DelPedido son los cortes que salieron de un pedido, el más nuevo primero.
func (s *Servicio) DelPedido(ctx context.Context, orderID string) ([]CorteDelPedido, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id::text, numero, material_descripcion, estado::text, urgente, created_at, variant_id::text,
		       (CASE WHEN mitad IS NULL THEN placas ELSE placas / 2.0 END)::float8, sin_cargo
		FROM cutting_orders WHERE order_id = $1 ORDER BY created_at DESC`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (CorteDelPedido, error) {
		var c CorteDelPedido
		err := r.Scan(&c.ID, &c.Numero, &c.Material, &c.Estado, &c.Urgente, &c.CreatedAt, &c.VariantID, &c.PlacasEnteras, &c.SinCargo)
		return c, err
	})
}

// PiezaDelCorte es una fila de cutting_items.
type PiezaDelCorte struct {
	ID             string  `json:"id"`
	CuttingOrderID string  `json:"cuttingOrderId"`
	LargoMm        float64 `json:"largoMm"`
	AnchoMm        float64 `json:"anchoMm"`
	Cantidad       float64 `json:"cantidad"`
	RespetaVeta    float64 `json:"respetaVeta"`
	CantoLargo     float64 `json:"cantoLargo"`
	CantoAncho     float64 `json:"cantoAncho"`
	Aclaracion     *string `json:"aclaracion"`
	Etiqueta       *string `json:"etiqueta"`
	Orden          int32   `json:"orden"`
}

// Corte es la ficha de un trabajo (obtenerCorte).
type Corte struct {
	ID               string          `json:"id"`
	Numero           string          `json:"numero"`
	Cliente          string          `json:"cliente"`
	CustomerID       *string         `json:"customerId"`
	OrderID          *string         `json:"orderId"`
	PedidoNumero     *string         `json:"pedidoNumero"`
	Telefono         *string         `json:"telefono"`
	RetiraEl         *string         `json:"retiraEl"`
	Empresa          *string         `json:"empresa"`
	PriceListID      *string         `json:"priceListId"`
	Material         string          `json:"material"`
	VariantID        *string         `json:"variantId"`
	VarianteLargoMm  *float64        `json:"varianteLargoMm"`
	VarianteAnchoMm  *float64        `json:"varianteAnchoMm"`
	PropiaLargoMm    *float64        `json:"propiaLargoMm"`
	PropiaAnchoMm    *float64        `json:"propiaAnchoMm"`
	Mitad            *string         `json:"mitad"`
	Color            *string         `json:"color"`
	Categoria        *string         `json:"categoria"`
	PrecioMediaPct   *float64        `json:"precioMediaPct"`
	Placas           int32           `json:"placas"`
	Pasadas          int32           `json:"pasadas"`
	CantoDescripcion *string         `json:"cantoDescripcion"`
	AcomodoManual    *string         `json:"acomodoManual"`
	AnchoSierraMm    float64         `json:"anchoSierraMm"`
	MotorPlano       int32           `json:"motorPlano"`
	Estado           string          `json:"estado"`
	Urgente          bool            `json:"urgente"`
	Notas            *string         `json:"notas"`
	Sucursal         *string         `json:"sucursal"`
	CreatedAt        time.Time       `json:"createdAt"`
	Piezas           []PiezaDelCorte `json:"piezas"`
	PrecioPlaca      *float64        `json:"precioPlaca"`
	Medida           MedidaDePlaca   `json:"medida"`
	// Para cobrarlo en el mostrador (H173): cómo se vende la placa, en qué
	// unidad, y si ya está cobrado (con venta y sin nada por cobrar).
	FormaDeVenta *string `json:"formaDeVenta"`
	Unidad       *string `json:"unidad"`
	Cobrado      bool    `json:"cobrado"`
	// SinCargo: una reposición, atada al pedido que la originó (00240).
	SinCargo bool `json:"sinCargo"`
	// MotivoAnulado: por qué se canceló («Reemplazado por CRT-15»).
	MotivoAnulado *string `json:"motivoAnulado"`
	BranchID      *string `json:"branchId"`
	// PedidoEntregarEl es el día comprometido del pedido (AAAA-MM-DD).
	PedidoEntregarEl *string `json:"-"`
}

func i32f(p *int32) *float64 {
	if p == nil {
		return nil
	}
	f := float64(*p)
	return &f
}

// Obtener es obtenerCorte: la ficha con sus piezas, el precio de la placa en
// la lista del cliente y la medida con la que se arma el plano.
func (s *Servicio) Obtener(ctx context.Context, id string) (*Corte, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var c Corte
	var vl, va, pl, pa, pct *int32
	var sierra jsmath.Num
	var urgente int32
	err := s.pool.QueryRow(ctx, `
		SELECT co.id::text, co.numero, co.contacto_nombre, co.customer_id::text, co.order_id::text, o.numero,
		       cu.razon_social, cu.price_list_id::text, co.material_descripcion, co.variant_id::text,
		       pv.largo_mm, pv.ancho_mm, co.placa_largo_mm, co.placa_ancho_mm, co.mitad::text, pv.color,
		       cat.name, p.precio_media_pct, co.placas, co.pasadas, co.canto_descripcion, co.acomodo_manual,
		       co.ancho_sierra_mm, co.motor_plano, co.estado::text, co.urgente, co.notas, b.name, co.created_at,
		       coalesce(co.contacto_telefono, o.contacto_telefono, cu.telefono), to_char(co.retira_el, 'YYYY-MM-DD'),
		       p.forma_de_venta::text, p.unit::text,
		       (o.id IS NOT NULL AND o.estado <> 'cancelado' AND coalesce(`+fragmentos.SinCobrarDelPedido+`, 0) <= 0.009
		        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = co.cargo_order_id AND coalesce(`+fragmentos.SinCobrarDelPedido+`, 0) > 0.009)),
		       co.sin_cargo, co.motivo_anulado, co.branch_id::text, to_char(o.entregar_el, 'YYYY-MM-DD')
		FROM cutting_orders co
		LEFT JOIN product_variants pv ON pv.id = co.variant_id
		LEFT JOIN products p ON p.id = pv.product_id
		LEFT JOIN categories cat ON cat.id = p.category_id
		LEFT JOIN customers cu ON cu.id = co.customer_id
		LEFT JOIN orders o ON o.id = co.order_id
		LEFT JOIN branches b ON b.id = co.branch_id
		WHERE co.id = $1 LIMIT 1`, id).Scan(
		&c.ID, &c.Numero, &c.Cliente, &c.CustomerID, &c.OrderID, &c.PedidoNumero, &c.Empresa, &c.PriceListID,
		&c.Material, &c.VariantID, &vl, &va, &pl, &pa, &c.Mitad, &c.Color, &c.Categoria, &pct, &c.Placas,
		&c.Pasadas, &c.CantoDescripcion, &c.AcomodoManual, &sierra, &c.MotorPlano, &c.Estado, &urgente,
		&c.Notas, &c.Sucursal, &c.CreatedAt, &c.Telefono, &c.RetiraEl, &c.FormaDeVenta, &c.Unidad, &c.Cobrado,
		&c.SinCargo, &c.MotivoAnulado, &c.BranchID, &c.PedidoEntregarEl)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.VarianteLargoMm, c.VarianteAnchoMm, c.PropiaLargoMm, c.PropiaAnchoMm, c.PrecioMediaPct = i32f(vl), i32f(va), i32f(pl), i32f(pa), i32f(pct)
	c.Material = MaterialEnOrden(c.Material, vl, va)
	c.AnchoSierraMm = sierra.F()
	c.Urgente = urgente == 1

	filas, err := s.pool.Query(ctx, `
		SELECT id::text, cutting_order_id::text, largo_mm, ancho_mm, cantidad, respeta_veta, canto_largo,
		       canto_ancho, aclaracion, etiqueta, orden
		FROM cutting_items WHERE cutting_order_id = $1 ORDER BY orden ASC`, id)
	if err != nil {
		return nil, err
	}
	c.Piezas, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (PiezaDelCorte, error) {
		var p PiezaDelCorte
		var l, a, n, v, cl, ca int32
		err := r.Scan(&p.ID, &p.CuttingOrderID, &l, &a, &n, &v, &cl, &ca, &p.Aclaracion, &p.Etiqueta, &p.Orden)
		p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.CantoLargo, p.CantoAncho = float64(l), float64(a), float64(n), float64(v), float64(cl), float64(ca)
		return p, err
	})
	if err != nil {
		return nil, err
	}

	if c.VariantID != nil {
		precio, err := s.precioPara(ctx, *c.VariantID, c.CustomerID)
		if err != nil {
			return nil, err
		}
		c.PrecioPlaca = precio
	}
	// Con la sierra del trabajo, si nació con el motor que la descuenta: la
	// media placa de uno viejo es la que se le vendió.
	c.Medida = ResolverMedida(c.PropiaLargoMm, c.PropiaAnchoMm, c.VarianteLargoMm, c.VarianteAnchoMm, c.Mitad, SierraDeLaMitad(c.MotorPlano, c.AnchoSierraMm))
	return &c, nil
}

// precioPara es preciosPara (lib/mostrador/buscar.ts) para una variante: la
// lista del cliente —propia, o la general por el factor derivado—, o la
// general si no hay cliente. Sin precio cargado es 0.
func (s *Servicio) precioPara(ctx context.Context, variantID string, customerID *string) (*float64, error) {
	var generalID *string
	err := s.pool.QueryRow(ctx, `SELECT id::text FROM price_lists WHERE is_default AND active LIMIT 1`).Scan(&generalID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	listaID, factor := generalID, 1.0
	if customerID != nil {
		var propia *string
		var pct *jsmath.Num
		err := s.pool.QueryRow(ctx, `
			SELECT cu.price_list_id::text, pl.porcentaje_sobre_general
			FROM customers cu LEFT JOIN price_lists pl ON pl.id = cu.price_list_id
			WHERE cu.id = $1 LIMIT 1`, *customerID).Scan(&propia, &pct)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if propia != nil {
			listaID, factor = propia, catalogo.FactorDeLista(pct)
		}
	}
	var precio *jsmath.Num
	err = s.pool.QueryRow(ctx, `
		SELECT coalesce(pp.price, round((pg.price * $4::numeric)::numeric, 2))
		FROM product_variants pv
		LEFT JOIN price_list_items pp ON pp.variant_id = pv.id AND pp.price_list_id = $2
		LEFT JOIN price_list_items pg ON pg.variant_id = pv.id AND pg.price_list_id = $3
		WHERE pv.id = $1`, variantID, listaID, generalID, jsmath.Num(factor)).Scan(&precio)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	v := 0.0
	if precio != nil {
		v = precio.F()
	}
	return &v, nil
}

// UnidadesDelCorte son las piezas sueltas del despiece (la suma de las
// cantidades).
func UnidadesDelCorte(c *Corte) float64 {
	total := 0.0
	for _, p := range c.Piezas {
		total += p.Cantidad
	}
	return total
}

// errDemasiadasPiezas es un corte que pasa TopeDeUnidades: el motor crece
// cuadrático (10 000 piezas son 5 s de CPU) y no se arma su plano.
var errDemasiadasPiezas = plataforma.NuevoProblema(http.StatusConflict, msgDemasiadasPiezas)

var msgDemasiadasPiezas = fmt.Sprintf("Son demasiadas piezas para un corte (el máximo es %d). Partí el despiece en más de uno.", TopeDeUnidades)

// PlanoDelMotor rehace el plano de un trabajo con el disco, lo fijado a
// mano y el motor con que nació, tal como lo acomoda el motor: de este sale
// la hoja de corte. Un corte viejo que pasa el tope sale sin placas, para
// que la ficha abra igual (ver PlanoDelCorteConTope).
func PlanoDelMotor(c *Corte) Plano {
	piezas := make([]PiezaAcortar, len(c.Piezas))
	for i, p := range c.Piezas {
		piezas[i] = PiezaAcortar{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.Etiqueta, p.CantoLargo, p.CantoAncho}
	}
	if UnidadesDelCorte(c) > TopeDeUnidades {
		piezas = nil
	}
	acomodo := ""
	if c.AcomodoManual != nil {
		acomodo = *c.AcomodoManual
	}
	sierra := c.AnchoSierraMm
	busqueda := c.MotorPlano >= 2
	return CalcularPlano(DatosDelPlano{
		Piezas: piezas, PlacaLargo: c.Medida.Largo, PlacaAncho: c.Medida.Ancho,
		AnchoSierra: &sierra, Fijadas: LeerAcomodoManual(acomodo), Busqueda: &busqueda,
	})
}

// ConLaHojaSi es el plano del motor contado como la hoja, si el trabajo nació
// con ese motor (MotorPasadasDeLaHoja); uno de antes queda como se cobró.
func ConLaHojaSi(motor int32, p Plano) Plano {
	if motor >= MotorPasadasDeLaHoja {
		return ConLaHoja(p)
	}
	return p
}

// PlanoDelCorte es el plano que muestran la ficha, el PDF y el plano del
// taller: el del motor y, desde MotorPasadasDeLaHoja, con las pasadas y los
// retales de la hoja.
func PlanoDelCorte(c *Corte) Plano {
	return ConLaHojaSi(c.MotorPlano, PlanoDelMotor(c))
}

// PlanoDelCorteConTope es PlanoDelMotor para lo que no tiene sentido sin
// plano (la hoja, el PTX, cambiar el disco): pasado el tope, el aviso.
func PlanoDelCorteConTope(c *Corte) (Plano, error) {
	if UnidadesDelCorte(c) > TopeDeUnidades {
		return Plano{}, errDemasiadasPiezas
	}
	return PlanoDelMotor(c), nil
}

func piezasConCanto(c *Corte) []PiezaConCanto {
	out := make([]PiezaConCanto, len(c.Piezas))
	for i, p := range c.Piezas {
		out[i] = PiezaConCanto{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	return out
}

// --- las acciones de la cola ---

var ordenDeLaCola = []string{"en-cola", "en-proceso", "terminado", "retirado"}

// Avanzar pasa el corte al siguiente paso de la cola. Un cancelado no avanza.
//
// desde es el estado que vio quien tocó (vacío: no se controla). Con una
// pantalla de hace un minuto, o el taller y el panel a la vez, «Empezar»
// sobre un corte que ya estaba en la máquina lo daba por terminado sin
// cortarlo. El UPDATE además exige el estado leído: dos toques a la vez dan
// un solo paso.
//
// **Retirar uno sin cobrar avisa** (mes simulado, H173 y H348): un corte
// «paga al retirar» sin venta pasaba a retirado con un clic y el material se
// entregaba sin cobrar. Con el pedido sin cobrar, o suelto con algo para
// cobrar, el paso a retirado se rechaza con el aviso, y solo pasa con
// `sinCobrar` (quien toca lo sabe). Se cobra trayéndolo al mostrador. La
// reposición sin cargo no cobra nada.
//
// Retirar es del mostrador, no del taller (H115).
//
// pasadas, al terminar, son las que confirma el operario en la tarjeta del
// taller (mes simulado, H403): quedan en el mismo UPDATE.
func (s *Servicio) Avanzar(ctx context.Context, ses *auth.Sesion, id, desde string, sinCobrar bool, pasadas ...float64) (string, error) {
	var estado, numero string
	var pedido *string
	var sinCargo bool
	if err := s.pool.QueryRow(ctx, `SELECT estado::text, numero, order_id::text, sin_cargo FROM cutting_orders WHERE id = $1`, id).
		Scan(&estado, &numero, &pedido, &sinCargo); errors.Is(err, pgx.ErrNoRows) {
		return "", noEncontrado
	} else if err != nil {
		return "", err
	}
	if desde != "" && desde != estado {
		return "", yaCambio(numero, estado)
	}
	pos := -1
	for i, e := range ordenDeLaCola {
		if e == estado {
			pos = i
		}
	}
	if pos == -1 {
		return "", error422("Ese corte está anulado.")
	}
	if pos+1 >= len(ordenDeLaCola) {
		return "", error422("El corte ya está retirado.")
	}
	sig := ordenDeLaCola[pos+1]
	if sig == "retirado" {
		if esDelTaller(ses) {
			return "", plataforma.NuevoProblema(http.StatusForbidden, "La entrega la marca el mostrador.")
		}
		if !sinCobrar && !sinCargo {
			cobrado := true
			if pedido != nil {
				// Y el pedido aparte con sus pasadas, si lo tiene (H184).
				if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cutting_orders co JOIN orders o ON o.id = co.order_id
					WHERE co.id = $1 AND o.estado <> 'cancelado' AND coalesce(`+fragmentos.SinCobrarDelPedido+`, 0) <= 0.009)
					AND NOT EXISTS (SELECT 1 FROM cutting_orders co JOIN orders o ON o.id = co.cargo_order_id
					WHERE co.id = $1 AND coalesce(`+fragmentos.SinCobrarDelPedido+`, 0) > 0.009)`, id).Scan(&cobrado); err != nil {
					return "", err
				}
			} else {
				f, err := s.Ficha(ctx, id)
				if err != nil {
					return "", err
				}
				cobrado = f == nil || f.Cuenta.Total <= 0
			}
			if !cobrado {
				return "", plataforma.NuevoProblema(http.StatusConflict, numero+" no está cobrado. Cobralo en el mostrador antes de entregarlo.")
			}
		}
	}
	var confirmadas *int32
	if sig == "terminado" && len(pasadas) > 0 && !math.IsNaN(pasadas[0]) {
		n := math.Max(0, math.Floor(pasadas[0]))
		if n > 100_000 {
			return "", error422("Son demasiadas pasadas.")
		}
		x := int32(n)
		confirmadas = &x
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE cutting_orders SET estado = $2::estado_corte, updated_at = now(),
			terminado_at = CASE WHEN $2 = 'terminado' THEN now() ELSE terminado_at END,
			pasadas = coalesce($4, pasadas)
		WHERE id = $1 AND estado = $3::estado_corte`, id, sig, estado, confirmadas)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		var ahora string
		_ = s.pool.QueryRow(ctx, `SELECT estado::text FROM cutting_orders WHERE id = $1`, id).Scan(&ahora)
		return "", yaCambio(numero, ahora)
	}
	desc := numero + ": " + estado + " → " + sig
	if confirmadas != nil {
		desc += fmt.Sprintf(" (%d pasadas)", *confirmadas)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "corte", id, desc, nil)
	if sig == "terminado" {
		if err := s.listoConElCorte(ctx, ses, id, numero); err != nil {
			return "", err
		}
	}
	// La reposición entregada queda escrita en el pedido que la originó: el
	// reclamo se cierra con constancia (H321).
	// Sale con su remito sin cargo, para firmar con el dedo: la firma es la
	// constancia que cierra el reclamo.
	if sig == "retirado" && sinCargo && pedido != nil {
		if _, err := s.RemitoDeLaReposicion(ctx, ses, id); err != nil {
			return "", err
		}
	}
	texto := map[string]string{"en-proceso": "en la máquina", "terminado": "terminado", "retirado": "retirado"}[sig]
	return numero + " quedó " + texto + ".", nil
}

// listoConElCorte: la venta del mostrador que lleva un corte queda en curso
// hasta que el corte sale de la máquina (mes simulado); con el último corte
// terminado pasa sola a «listo», con el aviso al cliente. Los pedidos de
// otro origen los marca listos el depósito, que sabe qué más falta.
func (s *Servicio) listoConElCorte(ctx context.Context, ses *auth.Sesion, corte, numero string) error {
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var pedido, origen, estado string
		err := tx.QueryRow(ctx, `
			SELECT o.id::text, o.origen::text, o.estado::text FROM cutting_orders c JOIN orders o ON o.id = c.order_id
			WHERE c.id = $1 FOR UPDATE OF o`, corte).Scan(&pedido, &origen, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		if origen != "mostrador" || (estado != "pendiente" && estado != "preparando") {
			return nil
		}
		var faltan int
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM cutting_orders WHERE order_id = $1 AND estado IN ('en-cola', 'en-proceso')`,
			pedido).Scan(&faltan); err != nil || faltan > 0 {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE orders SET estado = 'listo', updated_at = now() WHERE id = $1`, pedido); err != nil {
			return err
		}
		var usuario *string
		if ses != nil {
			usuario = &ses.UserID
		}
		if _, err := tx.Exec(ctx, `INSERT INTO order_status_history (order_id, estado, nota, created_by_user_id) VALUES ($1, 'listo', $2, $3)`,
			pedido, "Corte "+numero+" terminado", usuario); err != nil {
			return err
		}
		_, err = cola.Encolar(ctx, sqlc.New(tx), "pedido.estado", map[string]string{"orderId": pedido, "estado": "listo"}, time.Time{})
		return err
	})
}

// esDelTaller es quien no decide en la cola (roles.DecidenEnLaCola): el
// aserradero empieza y termina, pero urgencias y entregas son del mostrador.
func esDelTaller(ses *auth.Sesion) bool {
	return ses != nil && !ses.Tiene(roles.DecidenEnLaCola...)
}

// Volver deshace el último paso del taller (mes simulado, H116): de la
// máquina a la cola, o de terminado a la máquina. En una tablet con las
// manos sucias, un toque equivocado no podía revertirse. Lo retirado y lo
// anulado no vuelven.
func (s *Servicio) Volver(ctx context.Context, ses *auth.Sesion, id, desde string) (string, error) {
	var estado, numero string
	if err := s.pool.QueryRow(ctx, `SELECT estado::text, numero FROM cutting_orders WHERE id = $1`, id).Scan(&estado, &numero); errors.Is(err, pgx.ErrNoRows) {
		return "", noEncontrado
	} else if err != nil {
		return "", err
	}
	if desde != "" && desde != estado {
		return "", yaCambio(numero, estado)
	}
	anterior := map[string]string{"en-proceso": "en-cola", "terminado": "en-proceso"}[estado]
	if anterior == "" {
		return "", error422(numero + " ya no se puede volver atrás.")
	}
	tag, err := s.pool.Exec(ctx, `
		UPDATE cutting_orders SET estado = $2::estado_corte, updated_at = now(),
			terminado_at = CASE WHEN $3 = 'terminado' THEN NULL ELSE terminado_at END
		WHERE id = $1 AND estado = $3::estado_corte`, id, anterior, estado)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		var ahora string
		_ = s.pool.QueryRow(ctx, `SELECT estado::text FROM cutting_orders WHERE id = $1`, id).Scan(&ahora)
		return "", yaCambio(numero, ahora)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "corte", id, numero+": "+estado+" → "+anterior+" (deshecho)", nil)
	texto := map[string]string{"en-cola": "volvió a la cola", "en-proceso": "volvió a la máquina"}[anterior]
	return numero + " " + texto + ".", nil
}

// Anular saca de la cola un corte cargado mal (mes simulado, H185 y H228):
// con motivo, solo si todavía no se cortó, y no si lo cobró la venta que lo
// creó (eso se anula con la venta).
func (s *Servicio) Anular(ctx context.Context, ses *auth.Sesion, id, motivo string) (string, error) {
	motivo = strings.TrimSpace(motivo)
	if len([]rune(motivo)) < 3 {
		return "", plataforma.Invalido(map[string]string{"motivo": "Decí por qué se anula."})
	}
	if len([]rune(motivo)) > 300 {
		return "", plataforma.Invalido(map[string]string{"motivo": "El motivo es muy largo."})
	}
	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		numero, err = anularEnLaTransaccion(ctx, tx, id, motivo)
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "corte", id, numero+": anulado ("+motivo+")", nil)
	return numero + " quedó anulado.", nil
}

// anularEnLaTransaccion bloquea el corte y lo cancela con su motivo.
func anularEnLaTransaccion(ctx context.Context, tx pgx.Tx, id, motivo string) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", noEncontrado
	}
	var estado, numero string
	var pedido *string
	err := tx.QueryRow(ctx, `SELECT estado::text, numero, order_id::text FROM cutting_orders WHERE id = $1 FOR UPDATE`, id).
		Scan(&estado, &numero, &pedido)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", noEncontrado
	}
	if err != nil {
		return "", err
	}
	// Uno ya anulado o reemplazado no «salió de la máquina» (mes simulado).
	if estado == "cancelado" {
		return "", error422(numero + " ya está anulado.")
	}
	if estado != "en-cola" && estado != "en-proceso" {
		return "", error422(numero + " ya salió de la máquina: no se anula.")
	}
	if pedido != nil {
		var vendido *string
		err := tx.QueryRow(ctx, `
			SELECT o.numero FROM orders o
			WHERE (o.id = $1 AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.del_corte
			         AND (oi.cutting_order_id IS NULL OR oi.cutting_order_id = $2)))
			   OR o.id = (SELECT cargo_order_id FROM cutting_orders WHERE id = $2)
			ORDER BY o.id = $1 DESC LIMIT 1`, *pedido, id).Scan(&vendido)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", err
		}
		if vendido != nil {
			return "", error422(numero + " se cobró en la venta " + *vendido + ": se corrige desde la venta.")
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE cutting_orders SET estado = 'cancelado', motivo_anulado = $2, updated_at = now() WHERE id = $1`, id, motivo); err != nil {
		return "", err
	}
	return numero, nil
}

// yaCambio es el 409 de un avance sobre un estado que ya no es el que se vio.
func yaCambio(numero, estado string) error {
	texto := map[string]string{"en-cola": "en la cola", "en-proceso": "en la máquina", "terminado": "terminado",
		"retirado": "retirado", "cancelado": "cancelado"}[estado]
	if texto == "" {
		texto = estado
	}
	return plataforma.NuevoProblema(http.StatusConflict, numero+" ya estaba "+texto+": se actualizó la lista.")
}

// AlternarUrgente marca o desmarca el corte como urgente. Lo decide el
// mostrador, no el taller (mes simulado, H115).
func (s *Servicio) AlternarUrgente(ctx context.Context, id string) (string, error) {
	var numero string
	var urgente int32
	err := s.pool.QueryRow(ctx, `
		UPDATE cutting_orders SET urgente = CASE WHEN urgente = 1 THEN 0 ELSE 1 END, updated_at = now()
		WHERE id = $1 RETURNING numero, urgente`, id).Scan(&numero, &urgente)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", noEncontrado
	}
	if err != nil {
		return "", err
	}
	if urgente == 1 {
		return numero + " pasó al principio de la cola.", nil
	}
	return numero + " volvió al orden normal.", nil
}

// CargarPasadas anota las pasadas que dio la máquina.
//
// Lo que se cobra lo cambia el mostrador (ManejanPlata, en el handler): el
// depósito veía el campo y podía bajar el cobro de un corte sin cobrar antes
// de entregarlo (mes simulado, M2S4-008). Bajarlas de lo que dice el plano
// es un descuento, y lo hace un administrador.
func (s *Servicio) CargarPasadas(ctx context.Context, ses *auth.Sesion, id string, pasadas float64) error {
	cantidad := 0.0
	if !math.IsNaN(pasadas) {
		cantidad = math.Max(0, math.Floor(pasadas))
	}
	if cantidad > math.MaxInt32 {
		return error422("Son demasiadas pasadas.")
	}
	if ses == nil || ses.RolStaff == nil || *ses.RolStaff != sqlc.StaffRoleAdmin {
		c, err := s.Obtener(ctx, id)
		if err != nil {
			return err
		}
		if c == nil {
			return plataforma.NuevoProblema(http.StatusNotFound, "No encontramos la orden de corte.")
		}
		if sugeridas := PlanoDelCorte(c).PasadasCobrables; int(cantidad) < sugeridas {
			return plataforma.NuevoProblema(http.StatusForbidden,
				fmt.Sprintf("El plano dice %d: cobrar menos pasadas lo autoriza un administrador.", sugeridas))
		}
	}
	var numero string
	var previas int32
	err := s.pool.QueryRow(ctx, `
		UPDATE cutting_orders n SET pasadas = $2, updated_at = now()
		FROM cutting_orders v WHERE n.id = $1 AND v.id = n.id
		RETURNING n.numero, v.pasadas`, id, int32(cantidad)).Scan(&numero, &previas)
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(http.StatusNotFound, "No encontramos la orden de corte.")
	}
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "corte", id,
		fmt.Sprintf("%s: %d → %d pasadas", numero, previas, int32(cantidad)), nil)
	return nil
}

// GuardarAcomodo guarda el acomodo corregido a mano. Una lista vacía vuelve
// al automático (la columna en nulo). Como el disco, solo en un trabajo que
// todavía no pasó por la máquina: el plano de uno cortado es el que se cortó.
func (s *Servicio) GuardarAcomodo(ctx context.Context, ses *auth.Sesion, id string, fijadas []PiezaFijada) (string, error) {
	var guardado *string
	if len(fijadas) > 0 {
		b, err := jsonSinEscapar(fijadas)
		if err != nil {
			return "", err
		}
		guardado = &b
	}
	// Las pasadas y las placas a cobrar pasan a ser las del plano acomodado:
	// la ficha cobraba 10 pasadas del automático mientras el plano y la hoja
	// decían 8 (mes simulado, M2S2-045).
	c, err := s.Obtener(ctx, id)
	if err != nil {
		return "", err
	}
	if c == nil {
		return "", plataforma.NuevoProblema(http.StatusNotFound, "No encontramos la orden de corte.")
	}
	libre := PlanoDelCorte(c)
	if c.AcomodoManual != nil {
		c.AcomodoManual = nil
		libre = PlanoDelCorte(c)
	}
	c.AcomodoManual = guardado
	plano := PlanoDelCorte(c)
	if guardado != nil && !SeCobraElManual(plano, libre) {
		plano = libre
	}
	var numero string
	// El estado va en el mismo UPDATE: entre leerlo y escribir, el taller
	// puede haberlo pasado a la máquina.
	err = s.pool.QueryRow(ctx, `UPDATE cutting_orders SET acomodo_manual = $2, placas = $3, pasadas = $4, updated_at = now()
		WHERE id = $1 AND estado = 'en-cola' RETURNING numero`, id, guardado, len(plano.Placas), plano.PasadasCobrables).Scan(&numero)
	if errors.Is(err, pgx.ErrNoRows) {
		var hay bool
		if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM cutting_orders WHERE id = $1)`, id).Scan(&hay); err != nil {
			return "", err
		}
		if !hay {
			return "", plataforma.NuevoProblema(http.StatusNotFound, "No encontramos la orden de corte.")
		}
		return "", error422("Ese trabajo ya pasó por la máquina: su plano es el que se cortó.")
	}
	if err != nil {
		return "", err
	}
	desc := numero + ": el acomodo vuelve al automático"
	if guardado != nil {
		pieza := "piezas"
		if len(fijadas) == 1 {
			pieza = "pieza"
		}
		desc = fmt.Sprintf("%s: acomodo corregido a mano (%d %s)", numero, len(fijadas), pieza)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "corte", id, desc, nil)
	if guardado != nil {
		return "Acomodo guardado.", nil
	}
	return "El plano vuelve al automático.", nil
}

// CambiarSierra cambia el disco de un trabajo que todavía no se cortó y
// rehace el plano con el motor de hoy.
func (s *Servicio) CambiarSierra(ctx context.Context, ses *auth.Sesion, id, valor string) (string, error) {
	ancho := LeerAnchoDeSierra(valor)
	if ancho == nil {
		return "", error422("El disco tiene que medir entre 0,5 y 10 mm.")
	}
	c, err := s.Obtener(ctx, id)
	if err != nil {
		return "", err
	}
	if c == nil {
		return "", plataforma.NuevoProblema(http.StatusNotFound, "No encontramos la orden de corte.")
	}
	if c.Estado != "en-cola" {
		return "", error422("Ese trabajo ya pasó por la máquina: su plano es el que se cortó.")
	}
	anterior := c.AnchoSierraMm
	// Cambiar el disco rehace el plano con el motor de hoy, y el de hoy
	// descuenta el disco de la media placa: con otro ancho, otra mitad.
	c.AnchoSierraMm, c.MotorPlano = *ancho, MotorActual
	c.Medida = ResolverMedida(c.PropiaLargoMm, c.PropiaAnchoMm, c.VarianteLargoMm, c.VarianteAnchoMm, c.Mitad, c.AnchoSierraMm)
	if UnidadesDelCorte(c) > TopeDeUnidades {
		return "", error422(msgDemasiadasPiezas)
	}
	plano := PlanoDelCorte(c)
	if _, err := s.pool.Exec(ctx, `
		UPDATE cutting_orders SET ancho_sierra_mm = $2, motor_plano = $5, placas = $3, pasadas = $4, updated_at = now()
		WHERE id = $1`, id, jsmath.Num(*ancho), len(plano.Placas), plano.PasadasCobrables, int32(MotorActual)); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "corte", id,
		fmt.Sprintf("%s: disco de %s a %s mm", c.Numero, jsmath.Texto(anterior), jsmath.Texto(*ancho)), nil)
	if n := len(plano.NoEntran); n > 0 {
		return fmt.Sprintf("Disco cambiado. Ojo: con %s mm hay %d pieza(s) que no entran.", jsmath.Texto(*ancho), n), nil
	}
	return fmt.Sprintf("Disco cambiado: el plano se rehizo con %s mm.", jsmath.Texto(*ancho)), nil
}

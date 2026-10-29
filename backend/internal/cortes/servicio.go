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
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
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
func (s *Servicio) Listar(ctx context.Context, busqueda, estado string) ([]CorteListado, error) {
	var args []any
	var cond []string
	if estado != "" && estado != "todos" {
		args = append(args, estado)
		cond = append(cond, "co.estado::text = $1")
	}
	if c := condicionBusqueda(busqueda, []string{"co.numero", "co.contacto_nombre", "co.material_descripcion"}, &args); c != "" {
		cond = append(cond, c)
	}
	where := ""
	if len(cond) > 0 {
		where = "WHERE " + strings.Join(cond, " AND ")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT co.id::text, co.numero, co.contacto_nombre, co.material_descripcion, co.placas, co.pasadas,
		       co.estado::text, co.urgente, co.notas, b.name, co.created_at, r.piezas, r.superficie
		FROM cutting_orders co
		LEFT JOIN branches b ON b.id = co.branch_id
		LEFT JOIN (
			SELECT cutting_order_id, sum(cantidad)::int AS piezas,
			       sum(largo_mm * ancho_mm * cantidad / 1000000.0) AS superficie
			FROM cutting_items GROUP BY cutting_order_id
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
		if err := filas.Scan(&c.ID, &c.Numero, &c.Cliente, &c.Material, &c.Placas, &c.Pasadas, &c.Estado, &urgente,
			&c.Notas, &c.Sucursal, &c.CreatedAt, &piezas, &sup); err != nil {
			return nil, err
		}
		c.Urgente = urgente == 1
		if piezas != nil {
			c.Piezas = *piezas
		}
		if sup != nil {
			c.MetrosCuadrados = jsmath.Round(float64(sup.F()*100)) / 100
		}
		out = append(out, c)
	}
	return out, filas.Err()
}

// CorteDelPedido es un corte que salió de un pedido.
type CorteDelPedido struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Material  string    `json:"material"`
	Estado    string    `json:"estado"`
	Urgente   int32     `json:"urgente"`
	CreatedAt time.Time `json:"createdAt"`
}

// DelPedido son los cortes que salieron de un pedido, el más nuevo primero.
func (s *Servicio) DelPedido(ctx context.Context, orderID string) ([]CorteDelPedido, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id::text, numero, material_descripcion, estado::text, urgente, created_at
		FROM cutting_orders WHERE order_id = $1 ORDER BY created_at DESC`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (CorteDelPedido, error) {
		var c CorteDelPedido
		err := r.Scan(&c.ID, &c.Numero, &c.Material, &c.Estado, &c.Urgente, &c.CreatedAt)
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
		       co.ancho_sierra_mm, co.motor_plano, co.estado::text, co.urgente, co.notas, b.name, co.created_at
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
		&c.Notas, &c.Sucursal, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.VarianteLargoMm, c.VarianteAnchoMm, c.PropiaLargoMm, c.PropiaAnchoMm, c.PrecioMediaPct = i32f(vl), i32f(va), i32f(pl), i32f(pa), i32f(pct)
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
	c.Medida = ResolverMedida(c.PropiaLargoMm, c.PropiaAnchoMm, c.VarianteLargoMm, c.VarianteAnchoMm, c.Mitad)
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

// PlanoDelCorte rehace el plano de un trabajo con el disco, lo fijado a
// mano y el motor con que nació.
func PlanoDelCorte(c *Corte) Plano {
	piezas := make([]PiezaAcortar, len(c.Piezas))
	for i, p := range c.Piezas {
		piezas[i] = PiezaAcortar{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta, p.Etiqueta, p.CantoLargo, p.CantoAncho}
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

func piezasConCanto(c *Corte) []PiezaConCanto {
	out := make([]PiezaConCanto, len(c.Piezas))
	for i, p := range c.Piezas {
		out[i] = PiezaConCanto{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	return out
}

// Ficha es todo lo que muestra /admin/cortes/[id]: el trabajo, su plano, el
// presupuesto y lo que se cobra.
type Ficha struct {
	Corte       *Corte             `json:"corte"`
	Tarifa      *TarifaDeCorte     `json:"tarifa"`
	Cargo       float64            `json:"cargo"`
	MetrosCanto float64            `json:"metrosCanto"`
	CargoCanto  float64            `json:"cargoCanto"`
	Plano       Plano              `json:"plano"`
	Superficies []float64          `json:"superficies"`
	Cuenta      PresupuestoDeCorte `json:"cuenta"`
	// Fijadas es el acomodo a mano guardado, ya leído.
	Fijadas []PiezaFijada `json:"fijadas"`
}

// Ficha arma la ficha de un trabajo.
func (s *Servicio) Ficha(ctx context.Context, id string) (*Ficha, error) {
	c, err := s.Obtener(ctx, id)
	if err != nil || c == nil {
		return nil, err
	}
	tarifas, err := s.TarifasActivas(ctx)
	if err != nil {
		return nil, err
	}
	cat := ""
	if c.Categoria != nil {
		cat = *c.Categoria
	}
	tarifa := BuscarTarifa(tarifas, []string{cat, c.Material}, c.PriceListID)
	metros := MetrosDeTapacanto(piezasConCanto(c))
	plano := PlanoDelCorte(c)
	sup := make([]float64, len(plano.Placas))
	for i, p := range plano.Placas {
		sup[i] = SuperficieDeSierra(p.Cortes, plano.AnchoSierra)
	}
	pct := 50.0
	if c.PrecioMediaPct != nil {
		pct = *c.PrecioMediaPct
	}
	pres := make([]PiezaPresupuestada, len(c.Piezas))
	for i, p := range c.Piezas {
		pres[i] = PiezaPresupuestada{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	return &Ficha{
		Corte: c, Tarifa: tarifa, Cargo: CargoPorCorte(tarifa, float64(c.Pasadas)), MetrosCanto: metros,
		CargoCanto: CargoPorTapacanto(tarifa, metros), Plano: plano, Superficies: sup,
		Cuenta:  Presupuestar(plano, tarifa, c.PrecioPlaca, pres, FraccionDePlaca(c.Medida.Mitad, pct)),
		Fijadas: LeerAcomodoManual(texto(c.AcomodoManual)),
	}, nil
}

// --- las acciones de la cola ---

var ordenDeLaCola = []string{"en-cola", "en-proceso", "terminado", "retirado"}

// Avanzar pasa el corte al siguiente paso de la cola. Un cancelado no avanza.
func (s *Servicio) Avanzar(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	var estado, numero string
	if err := s.pool.QueryRow(ctx, `SELECT estado::text, numero FROM cutting_orders WHERE id = $1`, id).Scan(&estado, &numero); errors.Is(err, pgx.ErrNoRows) {
		return "", noEncontrado
	} else if err != nil {
		return "", err
	}
	pos := -1
	for i, e := range ordenDeLaCola {
		if e == estado {
			pos = i
		}
	}
	if pos == -1 {
		return "", error422("Ese corte está cancelado: la venta que lo pidió se anuló.")
	}
	if pos+1 >= len(ordenDeLaCola) {
		return "", error422("El corte ya está retirado.")
	}
	sig := ordenDeLaCola[pos+1]
	if _, err := s.pool.Exec(ctx, `UPDATE cutting_orders SET estado = $2::estado_corte, updated_at = now() WHERE id = $1`, id, sig); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "corte", id, numero+": "+estado+" → "+sig, nil)
	texto := map[string]string{"en-proceso": "en la máquina", "terminado": "terminado", "retirado": "retirado"}[sig]
	return numero + " quedó " + texto + ".", nil
}

// AlternarUrgente marca o desmarca el corte como urgente.
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
func (s *Servicio) CargarPasadas(ctx context.Context, ses *auth.Sesion, id string, pasadas float64) error {
	cantidad := 0.0
	if !math.IsNaN(pasadas) {
		cantidad = math.Max(0, math.Floor(pasadas))
	}
	if cantidad > math.MaxInt32 {
		return error422("Son demasiadas pasadas.")
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
// al automático (la columna en nulo).
func (s *Servicio) GuardarAcomodo(ctx context.Context, ses *auth.Sesion, id string, fijadas []PiezaFijada) (string, error) {
	var guardado *string
	if len(fijadas) > 0 {
		b, err := jsonSinEscapar(fijadas)
		if err != nil {
			return "", err
		}
		guardado = &b
	}
	var numero string
	err := s.pool.QueryRow(ctx, `UPDATE cutting_orders SET acomodo_manual = $2, updated_at = now() WHERE id = $1 RETURNING numero`, id, guardado).Scan(&numero)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(http.StatusNotFound, "No encontramos la orden de corte.")
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
	c.AnchoSierraMm, c.MotorPlano = *ancho, 2
	plano := PlanoDelCorte(c)
	if _, err := s.pool.Exec(ctx, `
		UPDATE cutting_orders SET ancho_sierra_mm = $2, motor_plano = 2, placas = $3, pasadas = $4, updated_at = now()
		WHERE id = $1`, id, jsmath.Num(*ancho), len(plano.Placas), plano.PasadasCobrables); err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "corte", id,
		fmt.Sprintf("%s: disco de %s a %s mm", c.Numero, jsmath.Texto(anterior), jsmath.Texto(*ancho)), nil)
	if n := len(plano.NoEntran); n > 0 {
		return fmt.Sprintf("Disco cambiado. Ojo: con %s mm hay %d pieza(s) que no entran.", jsmath.Texto(*ancho), n), nil
	}
	return fmt.Sprintf("Disco cambiado: el plano se rehizo con %s mm.", jsmath.Texto(*ancho)), nil
}

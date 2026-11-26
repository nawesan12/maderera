package cortes

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/reglas"
	"mjbj/internal/ventas"
)

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
	// Modo es de dónde sale la plata del trabajo (mes simulado, H052, H184,
	// H232): «suelto» (se cobra lo de Cuenta, al pasarlo a pedido),
	// «pedido» (el pedido vende las placas: Cuenta es lo que el pedido no
	// tiene), «vendido» (se cobró en la venta que lo creó: ver Pedido),
	// «sinCargo» (una reposición) y «anulado» (no cobra nada). La ficha decía a la vez «Total del
	// trabajo», «2 pasadas a cobrar» y «el corte todavía no se puede
	// cobrar».
	Modo string `json:"modo"`
	// PasadasACobrar es la única cifra de pasadas: las confirmadas en el
	// taller o, mientras no, las del plano.
	PasadasACobrar int `json:"pasadasACobrar"`
	// Pedido es lo que dice el pedido del trabajo, si tiene.
	Pedido *PedidoDelCorte `json:"pedido"`
	// RetalesDelCliente: el pedido vende todas las placas del plano, así que
	// lo que sobra es del cliente aunque la placa no pase la mitad.
	RetalesDelCliente bool `json:"retalesDelCliente"`
	// SinPlata: la ficha del aserradero, sin importes ni teléfono.
	SinPlata bool `json:"sinPlata"`
}

// PedidoDelCorte es el pedido del trabajo, con los renglones que son suyos.
type PedidoDelCorte struct {
	Numero     string `json:"numero"`
	Estado     string `json:"estado"`
	EstadoPago string `json:"estadoPago"`
	// Lineas son los renglones del corte (los que la venta ató al despiece)
	// o, si no hay, los de la placa del corte.
	Lineas []RenglonDelPedido `json:"lineas"`
	// Cobrado es lo que el pedido cobra por el corte, con el descuento de la
	// venta repartido: lo que se cobró de verdad.
	Cobrado float64 `json:"cobrado"`
	// PlacasDelPedido son las placas de la placa del corte que vende el
	// pedido, en placas enteras (una media es 0,5).
	PlacasDelPedido float64 `json:"placasDelPedido"`
	// PlacasDeOtrosCortes son las que usan los otros cortes vivos del pedido
	// sobre la misma placa (no sale en la API).
	PlacasDeOtrosCortes float64 `json:"-"`
}

// RenglonDelPedido es un renglón del pedido que es del corte.
type RenglonDelPedido struct {
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Cantidad    float64 `json:"cantidad"`
	Subtotal    float64 `json:"subtotal"`
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
	pedido, delCorte, err := s.pedidoDelCorte(ctx, c)
	if err != nil {
		return nil, err
	}
	modo := ModoDelCorte(c, delCorte)
	if modo == "pedido" {
		if pedido.PlacasDeOtrosCortes, err = s.placasDeOtrosCortes(ctx, c); err != nil {
			return nil, err
		}
	}
	// El pedido que vende todas las placas las vende enteras: el corte va
	// sin cargo y lo que sobra es del cliente. Contado sobre el plano, las
	// cifras decían «1 se vende entera · 3 pasadas a cobrar» con las dos
	// placas selladas «Se vende entera» (mes simulado, H052 y H184).
	delCliente := RetalesDelCliente(c, plano, pedido, modo) || (modo == "suelto" && MaterialSeCobra(ctx, s.pool))
	if delCliente {
		plano = TodasDelCliente(plano)
	}
	cuenta := CuentaDelCorte(c, plano, tarifa, pedido, modo)
	aCobrar := PasadasACobrar(c, plano)
	return &Ficha{
		Corte: c, Tarifa: tarifa, Cargo: CargoPorCorte(tarifa, float64(aCobrar)), MetrosCanto: metros,
		CargoCanto: CargoPorTapacanto(tarifa, metros), Plano: plano, Superficies: sup,
		Cuenta:  cuenta,
		Fijadas: LeerAcomodoManual(texto(c.AcomodoManual)),
		Modo:    modo, PasadasACobrar: aCobrar, Pedido: pedido, RetalesDelCliente: delCliente,
	}, nil
}

// RetalesDelCliente: lo que sobra del trabajo es del cliente porque el
// pedido vende todas las placas que usan sus cortes. Lo dicen igual la
// ficha, la hoja de corte y el plano: la ficha decía «del cliente» y la
// hoja del operario «los retales quedan en la maderera» (mes simulado,
// H184).
func RetalesDelCliente(c *Corte, plano Plano, pedido *PedidoDelCorte, modo string) bool {
	if modo != "pedido" || pedido == nil || pedido.PlacasDelPedido <= 0 {
		return false
	}
	return pedido.PlacasDelPedido+1e-6 >= placasUsadas(c, plano)+pedido.PlacasDeOtrosCortes
}

// RetalesDelClienteDe es RetalesDelCliente leyendo el pedido del trabajo.
func (s *Servicio) RetalesDelClienteDe(ctx context.Context, c *Corte, plano Plano) (bool, error) {
	pedido, delCorte, err := s.pedidoDelCorte(ctx, c)
	if err != nil {
		return false, err
	}
	modo := ModoDelCorte(c, delCorte)
	if modo == "suelto" {
		return MaterialSeCobra(ctx, s.pool), nil
	}
	if modo != "pedido" {
		return false, nil
	}
	if pedido.PlacasDeOtrosCortes, err = s.placasDeOtrosCortes(ctx, c); err != nil {
		return false, err
	}
	return RetalesDelCliente(c, plano, pedido, modo), nil
}

// MaterialSeCobra es la regla corte_chico_material (/admin/reglas, H019):
// con «cobrar», la placa del corte que no pasa la mitad también se vende, y
// el trabajo se cuenta como el de un pedido que vende todas sus placas
// (TodasDelCliente). Con «sin_cargo» (el de arranque), por debajo de la
// mitad se cobran las pasadas y el recorte queda en la maderera.
func MaterialSeCobra(ctx context.Context, c reglas.Consultador) bool {
	return reglas.Es(ctx, c, reglas.CorteChicoMaterial, "cobrar")
}

// TodasDelCliente marca todas las placas del plano como del cliente: el
// pedido las vende (la hoja y el plano rotulan de quién es lo que sobra con
// SeVendeEntera). Vendidas enteras, el corte va sin cargo: no quedan pasadas
// a cobrar. Copia las placas: el plano puede venir de un caché.
func TodasDelCliente(plano Plano) Plano {
	placas := make([]PlacaDelPlano, len(plano.Placas))
	for i, p := range plano.Placas {
		p.SeVendeEntera = true
		placas[i] = p
	}
	plano.Placas = placas
	plano.PlacasEnteras = len(placas)
	plano.PasadasCobrables = 0
	return plano
}

// PlanoParaCobrar es el plano del trabajo con las placas que vende su pedido
// ya marcadas: lo que muestran la ficha y la tarjeta del taller.
func (s *Servicio) PlanoParaCobrar(ctx context.Context, c *Corte) (Plano, error) {
	plano := PlanoDelCorte(c)
	delCliente, err := s.RetalesDelClienteDe(ctx, c, plano)
	if err != nil {
		return plano, err
	}
	if delCliente {
		plano = TodasDelCliente(plano)
	}
	return plano, nil
}

// placasDeOtrosCortes son las placas, en placas enteras, que usan los otros
// cortes vivos del mismo pedido sobre la misma placa: CRT-9 y CRT-12 salían
// de PED-1152 y cada ficha avisaba «el plano usa 1 placa y el pedido vende
// 3» (mes simulado, H184).
func (s *Servicio) placasDeOtrosCortes(ctx context.Context, c *Corte) (float64, error) {
	if c.OrderID == nil || c.VariantID == nil {
		return 0, nil
	}
	var n float64
	err := s.pool.QueryRow(ctx, `
		SELECT coalesce(sum(CASE WHEN mitad IS NULL THEN placas ELSE placas / 2.0 END), 0)::float8
		FROM cutting_orders
		WHERE order_id = $1 AND variant_id = $2 AND id <> $3 AND estado <> 'cancelado' AND NOT sin_cargo`,
		*c.OrderID, *c.VariantID, c.ID).Scan(&n)
	return n, err
}

// placasUsadas son las placas del plano en placas enteras (dos medias son
// una).
func placasUsadas(c *Corte, plano Plano) float64 {
	n := float64(len(plano.Placas))
	if c.Medida.Mitad != nil && *c.Medida.Mitad != "" {
		return n / 2
	}
	return n
}

// CuentaDelCorte es lo que cobra el trabajo según de dónde sale su plata:
// suelto, todo (placas que se venden enteras, pasadas y tapacanto); atado a
// un pedido que vende las placas, lo que el pedido no tiene (las pasadas y el
// tapacanto); vendido o sin cargo, nada (lo cobrado está en el pedido).
func CuentaDelCorte(c *Corte, plano Plano, tarifa *TarifaDeCorte, pedido *PedidoDelCorte, modo string) PresupuestoDeCorte {
	pct := 50.0
	if c.PrecioMediaPct != nil {
		pct = *c.PrecioMediaPct
	}
	pres := make([]PiezaPresupuestada, len(c.Piezas))
	for i, p := range c.Piezas {
		pres[i] = PiezaPresupuestada{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	// Lo que se presupuesta es el plano con las pasadas a cobrar: una sola
	// cifra en las cifras, la cuenta y el taller.
	contado := plano
	contado.PasadasCobrables = PasadasACobrar(c, plano)
	fraccion := FraccionDePlaca(c.Medida.Mitad, pct)
	switch modo {
	case "pedido":
		// Las placas las vende el pedido: no se cotizan otra vez (H184).
		contado.PlacasEnteras = 0
		cuenta := Presupuestar(contado, tarifa, c.PrecioPlaca, pres, fraccion)
		// La diferencia entre lo que vende el pedido y lo que usan todos sus
		// cortes sobre esa placa: con dos cortes de un pedido de 3 placas,
		// cada ficha avisaba «el plano usa 1 placa y el pedido vende 3»
		// (mes simulado, H184). El alta dice lo mismo.
		if pedido != nil && pedido.PlacasDelPedido > 0 {
			usadas := placasUsadas(c, plano)
			if total := usadas + pedido.PlacasDeOtrosCortes; math.Abs(total-pedido.PlacasDelPedido) > 1e-6 {
				if pedido.PlacasDeOtrosCortes > 0 {
					cuenta.Faltan = append(cuenta.Faltan, fmt.Sprintf("Los cortes de %s usan %s y el pedido vende %s.",
						pedido.Numero, placasEnTexto(total), placasEnTexto(pedido.PlacasDelPedido)))
				} else {
					cuenta.Faltan = append(cuenta.Faltan, fmt.Sprintf("El plano usa %s y el pedido %s vende %s.",
						placasEnTexto(usadas), pedido.Numero, placasEnTexto(pedido.PlacasDelPedido)))
				}
			}
		}
		return cuenta
	case "vendido", "sinCargo", "anulado":
		cuenta := PresupuestoDeCorte{PlacasEnteras: plano.PlacasEnteras, Fraccion: fraccion,
			PasadasCobrables: contado.PasadasCobrables, Faltan: []string{}}
		if n := len(plano.NoEntran); n > 0 {
			cuenta.Faltan = append(cuenta.Faltan, piezasQueNoEntran(n))
		}
		return cuenta
	}
	return Presupuestar(contado, tarifa, c.PrecioPlaca, pres, fraccion)
}

func placasEnTexto(n float64) string {
	switch n {
	case 0.5:
		return "media placa"
	case 1:
		return "1 placa"
	}
	return strings.Replace(jsmath.Texto(n), ".", ",", 1) + " placas"
}

func piezasQueNoEntran(n int) string {
	if n == 1 {
		return "Hay una pieza que no entra en la placa."
	}
	return "Hay " + strconv.Itoa(n) + " piezas que no entran en la placa."
}

// ModoDelCorte es de dónde sale la plata del trabajo (ver Ficha.Modo).
// delCorte: el pedido tiene renglones atados al despiece (lo vendió el
// mostrador).
func ModoDelCorte(c *Corte, delCorte bool) string {
	switch {
	// Anulado no cobra nada: la ficha de CRT-906 cancelado seguía diciendo
	// «3 pasadas a cobrar · Fuera del pedido $3.600» (mes simulado).
	case c.Estado == "cancelado":
		return "anulado"
	case c.SinCargo:
		return "sinCargo"
	case c.OrderID == nil:
		return "suelto"
	case delCorte:
		return "vendido"
	}
	return "pedido"
}

// PasadasACobrar son las pasadas del trabajo: las que confirmó el taller (o
// guardó el alta), y si no hay ninguna, las del plano. Con todas las placas
// vendidas enteras no hay ninguna: el corte va sin cargo (lo guardado por el
// alta contaba el plano sin el pedido que las vende, H184).
func PasadasACobrar(c *Corte, plano Plano) int {
	if n := len(plano.Placas); n > 0 && plano.PlacasEnteras >= n {
		return 0
	}
	if c.Pasadas > 0 {
		return int(c.Pasadas)
	}
	return plano.PasadasCobrables
}

// pedidoDelCorte lee el pedido del trabajo y si tiene renglones del corte.
func (s *Servicio) pedidoDelCorte(ctx context.Context, c *Corte) (*PedidoDelCorte, bool, error) {
	if c.OrderID == nil {
		return nil, false, nil
	}
	p := &PedidoDelCorte{Lineas: []RenglonDelPedido{}}
	err := s.pool.QueryRow(ctx, `
		SELECT numero, estado::text, estado_pago::text
		FROM orders WHERE id = $1`, *c.OrderID).Scan(&p.Numero, &p.Estado, &p.EstadoPago)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT descripcion, unidad, cantidad, subtotal, variant_id::text, presentacion, del_corte
		FROM order_items WHERE order_id = $1 ORDER BY orden, id`, *c.OrderID)
	if err != nil {
		return nil, false, err
	}
	defer filas.Close()
	var delCorte, deLaPlaca []RenglonDelPedido
	for filas.Next() {
		var r RenglonDelPedido
		var cantidad, sub jsmath.Num
		var variante, presentacion *string
		var esDelCorte bool
		if err := filas.Scan(&r.Descripcion, &r.Unidad, &cantidad, &sub, &variante, &presentacion, &esDelCorte); err != nil {
			return nil, false, err
		}
		r.Cantidad, r.Subtotal = cantidad.F(), sub.F()
		if esDelCorte {
			delCorte = append(delCorte, r)
		}
		if c.VariantID != nil && variante != nil && *variante == *c.VariantID {
			deLaPlaca = append(deLaPlaca, r)
			if presentacion != nil && strings.HasPrefix(*presentacion, "media") {
				p.PlacasDelPedido += r.Cantidad / 2
			} else {
				p.PlacasDelPedido += r.Cantidad
			}
		}
	}
	if err := filas.Err(); err != nil {
		return nil, false, err
	}
	if len(delCorte) > 0 {
		p.Lineas = delCorte
		suma := 0.0
		for _, r := range delCorte {
			suma += r.Subtotal
		}
		// Los renglones ya vienen netos: el mostrador reparte el descuento
		// de la venta (la escala por medio de pago, el que tipeó el
		// vendedor) en el precio de cada renglón (ventas.AplicarDescuento),
		// y orders.descuento queda solo como constancia. Volver a
		// descontarlo daba $1.944 de un corte cobrado $2.160 (mes simulado,
		// H114 y H232).
		p.Cobrado = ventas.ACentavos(suma)
	} else if deLaPlaca != nil {
		p.Lineas = deLaPlaca
	}
	return p, len(delCorte) > 0, nil
}

// SinPlataParaElTaller deja la ficha como la ve el aserradero: sin importes,
// sin tarifa y sin el teléfono del cliente (la guía lo promete, mes simulado
// H118). Se saca en Go y no solo en la pantalla.
func (f *Ficha) SinPlataParaElTaller() {
	f.SinPlata = true
	f.Tarifa = nil
	f.Cargo, f.CargoCanto = 0, 0
	f.Cuenta = PresupuestoDeCorte{PlacasEnteras: f.Cuenta.PlacasEnteras, Fraccion: f.Cuenta.Fraccion,
		PasadasCobrables: f.Cuenta.PasadasCobrables, MetrosCanto: f.Cuenta.MetrosCanto, Faltan: []string{}}
	if n := len(f.Plano.NoEntran); n > 0 {
		f.Cuenta.Faltan = append(f.Cuenta.Faltan, piezasQueNoEntran(n))
	}
	f.Corte.PrecioPlaca = nil
	f.Corte.Telefono = nil
	if f.Pedido != nil {
		f.Pedido = &PedidoDelCorte{Numero: f.Pedido.Numero, Estado: f.Pedido.Estado, Lineas: []RenglonDelPedido{}}
	}
}

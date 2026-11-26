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
	// tiene), «vendido» (se cobró en la venta que lo creó: ver Pedido) y
	// «sinCargo» (una reposición). La ficha decía a la vez «Total del
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
	cuenta := CuentaDelCorte(c, plano, tarifa, pedido, modo)
	aCobrar := PasadasACobrar(c, plano)
	retalesDelCliente := false
	if modo == "pedido" && pedido.PlacasDelPedido > 0 {
		retalesDelCliente = pedido.PlacasDelPedido+1e-6 >= placasUsadas(c, plano)
	}
	return &Ficha{
		Corte: c, Tarifa: tarifa, Cargo: CargoPorCorte(tarifa, float64(aCobrar)), MetrosCanto: metros,
		CargoCanto: CargoPorTapacanto(tarifa, metros), Plano: plano, Superficies: sup,
		Cuenta:  cuenta,
		Fijadas: LeerAcomodoManual(texto(c.AcomodoManual)),
		Modo:    modo, PasadasACobrar: aCobrar, Pedido: pedido, RetalesDelCliente: retalesDelCliente,
	}, nil
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
		if pedido != nil && pedido.PlacasDelPedido > 0 {
			if usadas := placasUsadas(c, plano); math.Abs(usadas-pedido.PlacasDelPedido) > 1e-6 {
				cuenta.Faltan = append(cuenta.Faltan, fmt.Sprintf("El plano usa %s y el pedido %s vende %s.",
					placasEnTexto(usadas), pedido.Numero, placasEnTexto(pedido.PlacasDelPedido)))
			}
		}
		return cuenta
	case "vendido", "sinCargo":
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
// guardó el alta), y si no hay ninguna, las del plano.
func PasadasACobrar(c *Corte, plano Plano) int {
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
	var subtotal, descuento jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT numero, estado::text, estado_pago::text, subtotal, coalesce(descuento, 0)
		FROM orders WHERE id = $1`, *c.OrderID).Scan(&p.Numero, &p.Estado, &p.EstadoPago, &subtotal, &descuento)
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
		// El descuento de la venta (la escala por medio de pago, el que
		// tipeó el vendedor) se reparte: CRT-8 se cobró $4.320 y la ficha
		// decía $4.800 (H114).
		if st := subtotal.F(); st > 0 && descuento.F() > 0 {
			suma = float64(suma - float64(descuento.F()*(suma/st)))
		}
		p.Cobrado = redondear(suma)
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

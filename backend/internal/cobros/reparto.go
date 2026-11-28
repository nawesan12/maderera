package cobros

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/reglas"
	"mjbj/internal/ventas/fragmentos"
)

// El reparto de los cobros entre los dos circuitos, para el CSV del estudio.
//
// En el CSV, Deudores se debita solo con las facturas que ARCA autorizó. Un
// recibo se asentaba contra Deudores por el total, y lo que pagaba una venta
// sin factura dejaba Deudores en negativo: un Deudores que nunca se debitó.
// Cada recibo se reparte en tres:
//
//   - **Deudores** (blanco): lo que cancela facturas con CAE que siguen
//     abiertas, por cliente y en orden de fecha. Las retenciones van siempre
//     acá: son un crédito fiscal con su certificado, nunca del circuito B.
//   - **Anticipo** (blanco, Anticipos de clientes): lo que sobra cuando el
//     cliente tiene algo por facturar —un pedido abierto, una factura que
//     espera el CAE—, y hasta lo que falta facturar de eso. Es la seña:
//     queda atada a esos pedidos y facturas (sus destinos), y cuando la
//     factura de uno sale con CAE se le aplica (Anticipos a Deudores) y
//     Deudores cierra. A otra factura no: la seña de un pedido que se
//     entregó sin factura cancelaba la próxima venta blanca del cliente y
//     mandaba al B el pago real de esa venta. La que queda sin destino vivo
//     la marca el cierre («Anticipos sin aplicar»).
//   - **B**: lo que sobra sin nada pendiente, es decir, lo que pagó una venta
//     sin factura ya cerrada, y las partes en cheques del circuito B.
//
// **El reparto se fija al emitir el recibo y no se recalcula** (columnas
// reparto_* de receipts): una baja, un CAE que llega tarde o una nota de
// crédito del mes siguiente no pueden cambiar lo que ya se le mandó al
// estudio. La anulación usa el mismo reparto, al revés. Las aplicaciones de
// anticipo se calculan en orden de fecha con los hechos hasta cada una, así
// que tampoco cambian hacia atrás.
//
// «Algo por facturar» se mira **a la fecha del recibo**, no con el estado de
// hoy: el pedido abierto ese día (order_status_history) y la factura que ese
// día no tenía CAE (su CAE llegó después, según arca_log). Con el estado de
// hoy, la seña de octubre de un pedido que se entregó y facturó en diciembre
// caía entera al B, y la factura dejaba Deudores abierto para siempre.
//
// Lo que no se sabe es qué venta es del circuito B: el pedido no lo guarda.
// La regla de arriba es la que se le propone al estudio
// (docs/CONTADOR-SIN-CAE.md): ante la duda, anticipo y no B.

// TipoDeEvento es qué pasó en la cuenta.
type TipoDeEvento int

// Los eventos, en el orden en que se aplican cuando caen en el mismo instante.
const (
	// EventoFactura es un comprobante con CAE (la nota de crédito, con el
	// monto en negativo).
	EventoFactura TipoDeEvento = iota
	// EventoCobro es un cobro que va directo contra Deudores sin recibo (o
	// un reintegro, en negativo).
	EventoCobro
	EventoRecibo
	EventoAnulacion
	// EventoTramo es un tramo de un reintegro parcial de un pago con recibo
	// (el ID es el del recibo): vuelve en la misma proporción que el recibo.
	// También lo que una devolución de la venta le devuelve al recibo
	// (receipt_refunds) cuando lo devuelto no se había facturado con CAE.
	EventoTramo
	// EventoReintegroFacturado es lo que una devolución de mercadería
	// facturada con CAE le devuelve a un recibo: vuelve entero a Deudores del
	// blanco, contra la nota de crédito que lo acreditó ahí
	// (ReintegroDeLoFacturado).
	EventoReintegroFacturado
	// EventoRechazo es un cheque de un cliente que rebota y le devuelve la
	// deuda (la nota de débito del cheque). Si el cheque entró con un recibo
	// cuyo cobro quedó en Anticipos sin aplicar, el rechazo sale de ahí y no de
	// Deudores (mes simulado, M3S1-004): Anticipos quedaba con el cheque que no
	// se cobró y Deudores con la misma deuda, dos veces.
	EventoRechazo
	// EventoPase es la primera factura de un pedido (con CAE o esperándolo),
	// el día que se emite: lo que los recibos de ese pedido mandaron al B pasa
	// a Anticipos de clientes, atado a esa factura, y se le aplica cuando sale
	// con CAE (mes simulado, M2S1-011 y M2S2-011). Antes el cobro quedaba en el
	// B como venta sin factura y la factura en el archivo del estudio: la misma
	// venta dos veces, y Deudores abierto para siempre.
	EventoPase
	// EventoVuelta es la entrega de un pedido sin factura: lo que su recibo
	// había dejado en Anticipos esperando la factura vuelve al B, como venta
	// sin factura (mes simulado, M3S3-003 y M2S1-059). Antes quedaba en
	// Anticipos para siempre y su costo en el B: costo sin venta en un
	// archivo y una seña que nunca se iba a aplicar en el otro.
	EventoVuelta
)

// orden de los eventos del mismo instante: el pase va antes que la factura
// que lo recibe (la factura que sale con CAE en el acto).
func orden(t TipoDeEvento) int {
	if t == EventoPase {
		return -1
	}
	return int(t)
}

// ReintegroDeLoFacturado dice, sobre la fila `t` de receipt_refunds, si la
// devolución que lo hizo devolvió mercadería de una factura con CAE.
//
// Entonces el reintegro va entero al blanco, y no en la proporción del
// recibo (revisión del carril E): un recibo de $1000 que canceló $600 de
// factura y $400 de deuda B, con una devolución de $200 de lo facturado,
// asentaba Deudores 120 en el blanco y 80 en el B. La nota de crédito ya
// había acreditado los 200 en el blanco: Deudores quedaba en −80 en el
// blanco y en +80 en el B, sin ninguna venta B que lo respaldara. Lo que no
// salió de una factura con CAE sigue con el reparto del recibo (decisión a
// confirmar con el contador).
const ReintegroDeLoFacturado = `EXISTS (SELECT 1 FROM devoluciones dvf JOIN invoices fdv ON fdv.id = dvf.invoice_id
	WHERE dvf.id = t.devolucion_id AND fdv.cae IS NOT NULL AND fdv.cae_ambiente IS DISTINCT FROM 'homologacion')`

// Reparto es en qué se reparte un recibo.
type Reparto struct {
	Deudores float64 `json:"deudores"`
	Anticipo float64 `json:"anticipo"`
	B        float64 `json:"b"`
}

// Blanco es lo del recibo que va al CSV del estudio.
func (r Reparto) Blanco() float64 { return jsmath.Redondear2(r.Deudores + r.Anticipo) }

// EventoDeCuenta es un hecho de la cuenta de un cliente (o, sin cliente, de
// un pedido o de una factura suelta: la clave es «c:<cliente>»,
// «p:<pedido>» o «f:<factura>»).
type EventoDeCuenta struct {
	Clave string
	Fecha time.Time
	Tipo  TipoDeEvento
	// ID de la factura, el cobro o el recibo.
	ID string
	// La factura con signo, el cobro, o el total del recibo.
	Monto float64
	// Del recibo: lo cobrado en retenciones y en cheques del circuito B.
	Retencion, Negro float64
	// Del recibo: si el cliente tenía algo por facturar o esperando el CAE,
	// qué era («o:<pedido>», «i:<factura>») y cuánto sumaba.
	Pendiente   bool
	Destinos    []string
	PorFacturar float64
	// Del recibo: el reparto ya fijado.
	Guardado *Reparto
	// De la factura, para el asiento de la aplicación.
	TipoComprobante    string
	PuntoVenta, Numero int64
	Cliente            string
	// De la factura: su pedido, para aplicarle la seña que lo esperaba. Del
	// recibo que mandó a Anticipos lo que no tenía destino (las reglas
	// «cobro_antes_de_facturar» y «excedente_cuenta_corriente» en
	// «anticipos»): su pedido, o «*» si no cobra ninguno (va a la próxima
	// factura del cliente).
	Pedido string
	// ExcedenteAAnticipo: del recibo que se está fijando, si lo que no tiene
	// destino va a Anticipos y no al B (FijarReparto lo lee de la regla).
	ExcedenteAAnticipo bool
	// Del recibo: sus partes (para saber qué cheque va a qué circuito), su
	// pedido (receipts.order_id) y lo que cobró de facturas que ese día
	// esperaban el CAE, con cuáles (Reservados).
	Partes          []ParteCobrada
	PedidoDelRecibo string
	Reservado       float64
	Reservados      []string
	// Del rechazo: el cheque y el recibo con el que entró.
	Cheque, Recibo string
	// Del pase: cuándo se creó el pedido y, si el pedido se debe en la cuenta
	// corriente, cuánto de él estaba pagado ese día según la cuenta (-1 si no
	// va a la cuenta).
	Desde    time.Time
	EnCuenta float64
}

// Pase es lo que un recibo había mandado al B y pasa a Anticipos de clientes
// porque el pedido se facturó (EventoPase).
type Pase struct {
	Fecha                          time.Time
	Clave, Recibo, Factura, Pedido string
	Importe                        float64
	// BlancoAntes es lo que el recibo llevaba al blanco antes de este pase:
	// las partes que pasan son las que siguen (BlancoDeCadaParte).
	BlancoAntes float64
	Partes      []ParteCobrada
	// AlB: es una vuelta (EventoVuelta): de Anticipos al B, con el pedido
	// (Nombre es su número).
	AlB    bool
	Nombre string
}

// Bolsa es el anticipo que dejó un recibo: lo que queda sin aplicar, lo
// aplicado y a qué se puede aplicar.
type Bolsa struct {
	Clave, Recibo   string
	Fecha           time.Time
	Monto, Aplicado float64
	Destinos        []string
	// PorRegla: lo dejó la regla de mandar a Anticipos lo que no tenía
	// destino. Sin pedido es un saldo a favor que espera la próxima factura,
	// no una seña varada.
	PorRegla bool
}

// sirve dice si la bolsa se le aplica a la factura.
func (b *Bolsa) sirve(e EventoDeCuenta) bool {
	// Los recibos fijados con la regla de antes pueden tener anticipo sin
	// destino: van contra cualquier factura, como antes.
	if len(b.Destinos) == 0 {
		return true
	}
	for _, d := range b.Destinos {
		if d == "i:"+e.ID || (e.Pedido != "" && d == "o:"+e.Pedido) {
			return true
		}
	}
	return false
}

// tocan dice si dos listas de destinos comparten alguno.
func tocan(a, b []string) bool {
	for _, x := range a {
		for _, y := range b {
			if x == y {
				return true
			}
		}
	}
	return false
}

// Aplicacion es un anticipo que pasa a cancelar Deudores (o, en negativo,
// que vuelve a Anticipos porque se anuló el recibo que lo había dejado).
type Aplicacion struct {
	Fecha   time.Time
	Clave   string
	Evento  EventoDeCuenta
	Importe float64
}

// ResultadoDelReparto es lo que sale de recorrer las cuentas.
type ResultadoDelReparto struct {
	// El reparto de cada recibo.
	Recibos map[string]Reparto
	// Los recibos cuya anulación entró en el reparto. El cierre asienta
	// solo esas: una anulación posterior a la foto de la base no movió
	// Deudores acá (reportes.asientosDeCobro).
	Anulados map[string]bool
	// Los recibos que no tenían el reparto fijado (los de antes): se fijan.
	Calculados []string
	// Las aplicaciones de anticipo, en orden.
	Aplicaciones []Aplicacion
	// Lo que queda en Deudores y en Anticipos de cada clave al final.
	Deudores, Anticipos map[string]float64
	// MovimientosDeDeudores son los cambios de Deudores de cada clave, en
	// orden y con su fecha: el mayor de 1.1.03 por cuenta, sin el circuito B.
	// De acá sale el listado de deudores del contador (CsvDeudores).
	MovimientosDeDeudores map[string][]Movimiento
	// Los anticipos que quedan sin aplicar al final, en orden.
	Bolsas []Bolsa
	// PorRegla son los recibos cuyo excedente sin destino fue a Anticipos
	// por la regla (receipts.anticipo_por_regla).
	PorRegla map[string]bool
	// ChequesBlanco es lo que cada cheque cobrado con un recibo lleva al
	// archivo del estudio (el resto es del B), con los pases incluidos.
	ChequesBlanco map[string]float64
	// Rechazos es, de cada cheque rechazado con nota de débito, de dónde sale
	// en el blanco (Deudores o Anticipos) y cuánto es del B.
	Rechazos map[string]Reparto
	// Pases son los cobros que pasaron del B a Anticipos, en orden; Pasado lo
	// que pasó de cada recibo (su anulación lo devuelve desde ahí).
	Pases  []Pase
	Pasado map[string]float64
}

// RepartoDeRecibo reparte un recibo con lo que hay abierto en Deudores. El
// anticipo llega hasta lo que falta facturar (porFacturar): un pago de
// cuenta con un acopio chico abierto no es todo seña.
//
// reservado es lo que el recibo cobró de facturas que esperan el CAE (la que
// eligió quien cobró, en Facturación): va entero a Anticipos, atado a esas
// facturas, y no a lo que esté abierto en Deudores (mes simulado, M2S4-002):
// el cobro de la A 0064 cancelaba la nota de débito de un cheque rechazado y
// la factura, que decía «saldo $ 300.000», en el libro quedaba con $ 400.000.
func RepartoDeRecibo(deudoresAbiertos, total, retencion, negro float64, pendiente bool, porFacturar, reservado float64) Reparto {
	libre := jsmath.Redondear2(total - negro)
	reservado = jsmath.Redondear2(min(max(reservado, 0), max(jsmath.Redondear2(libre-retencion), 0)))
	libre = jsmath.Redondear2(libre - reservado)
	blanco := jsmath.Redondear2(min(libre, max(deudoresAbiertos, 0)))
	resto := jsmath.Redondear2(libre - blanco)
	r := Reparto{Deudores: blanco, B: jsmath.Redondear2(negro), Anticipo: reservado}
	sena := 0.0
	if pendiente {
		sena = jsmath.Redondear2(min(resto, max(jsmath.Redondear2(porFacturar-reservado), 0)))
		r.Anticipo = jsmath.Redondear2(r.Anticipo + sena)
		resto = jsmath.Redondear2(resto - sena)
	}
	// La retención es siempre del archivo del estudio: lo que la seña no
	// cubre va a Deudores. Antes iba toda a Deudores aunque el cliente no
	// debiera nada con CAE: la retención sobre la deuda de una factura que
	// espera el CAE dejaba Deudores en negativo (M2S3-005).
	if falta := jsmath.Redondear2(retencion - blanco - sena); falta > 0 {
		extra := jsmath.Redondear2(min(falta, resto))
		r.Deudores, resto = jsmath.Redondear2(r.Deudores+extra), jsmath.Redondear2(resto-extra)
	}
	r.B = jsmath.Redondear2(r.B + resto)
	return r
}

// ExcedenteAAnticipos pasa a Anticipos lo que el reparto mandaba al B sin
// destino (todo el B menos los cheques del circuito B, que siguen ahí): las
// reglas «cobro_antes_de_facturar» y «excedente_cuenta_corriente» en
// «anticipos» (H374, H407). Lo cobrado de un pedido sin factura y lo que
// sobra de un cobro a cuenta quedan en el archivo del estudio, contra
// Anticipos de clientes, y se aplican a la factura cuando sale con CAE.
func ExcedenteAAnticipos(rep Reparto, negro float64) Reparto {
	libre := jsmath.Redondear2(rep.B - negro)
	if libre <= 0.005 {
		return rep
	}
	rep.Anticipo = jsmath.Redondear2(rep.Anticipo + libre)
	rep.B = jsmath.Redondear2(rep.B - libre)
	return rep
}

// TramoPorCircuito reparte lo devuelto de un recibo en la proporción de su
// reparto; B se lleva el redondeo.
func TramoPorCircuito(rep Reparto, tramo float64) Reparto {
	total := jsmath.Redondear2(rep.Deudores + rep.Anticipo + rep.B)
	if !(total > 0) {
		return Reparto{Deudores: tramo}
	}
	d := jsmath.Redondear2(float64(tramo*rep.Deudores) / total)
	a := jsmath.Redondear2(float64(tramo*rep.Anticipo) / total)
	return Reparto{Deudores: d, Anticipo: a, B: jsmath.Redondear2(tramo - d - a)}
}

// RepartirCobros recorre cada cuenta en orden de fecha. Pura: la usan la
// emisión del recibo (para fijar el suyo) y el cierre (para las
// aplicaciones de anticipo y los recibos de antes).
func RepartirCobros(eventos []EventoDeCuenta) ResultadoDelReparto {
	ev := append([]EventoDeCuenta(nil), eventos...)
	sort.SliceStable(ev, func(i, j int) bool {
		a, b := ev[i], ev[j]
		if a.Clave != b.Clave {
			return a.Clave < b.Clave
		}
		if !a.Fecha.Equal(b.Fecha) {
			return a.Fecha.Before(b.Fecha)
		}
		if a.Tipo != b.Tipo {
			return orden(a.Tipo) < orden(b.Tipo)
		}
		return a.ID < b.ID
	})
	res := ResultadoDelReparto{Recibos: map[string]Reparto{}, Anulados: map[string]bool{}, Deudores: map[string]float64{}, Anticipos: map[string]float64{},
		MovimientosDeDeudores: map[string][]Movimiento{}, PorRegla: map[string]bool{}, ChequesBlanco: map[string]float64{},
		Rechazos: map[string]Reparto{}, Pasado: map[string]float64{}}
	r2 := jsmath.Redondear2
	bolsas := map[string][]*Bolsa{}
	deRecibo := map[string][]*Bolsa{}
	// Los recibos de cada cuenta, en orden, para el pase al facturar.
	type reciboVisto struct {
		e   EventoDeCuenta
		rep Reparto
	}
	recibosDe := map[string][]*reciboVisto{}
	visto := map[string]*reciboVisto{}
	anulado := map[string]bool{}
	// libreEnB es lo que el recibo dejó en el B y puede pasar: su B sin los
	// cheques marcados del B y sin lo que ya pasó.
	libreEnB := func(x *reciboVisto) float64 {
		negro := 0.0
		for _, p := range x.e.Partes {
			if p.Negro {
				negro = r2(negro + p.Importe)
			}
		}
		return r2(x.rep.B - negro - res.Pasado[x.e.ID])
	}
	chequesDe := func(x *reciboVisto) {
		for id, bl := range chequesDelReparto(x.e.Partes, r2(x.rep.Blanco()+res.Pasado[x.e.ID])) {
			res.ChequesBlanco[id] = bl
		}
	}
	for _, e := range ev {
		deudores, anticipo := res.Deudores[e.Clave], res.Anticipos[e.Clave]
		switch e.Tipo {
		case EventoFactura:
			deudores = r2(deudores + e.Monto)
			aplicado := 0.0
			for _, b := range bolsas[e.Clave] {
				if e.Monto <= 0 || deudores <= 0.005 {
					break
				}
				if b.Monto <= 0.005 || !b.sirve(e) {
					continue
				}
				ap := min(b.Monto, deudores)
				b.Monto, b.Aplicado = r2(b.Monto-ap), r2(b.Aplicado+ap)
				deudores, anticipo, aplicado = r2(deudores-ap), r2(anticipo-ap), r2(aplicado+ap)
			}
			if aplicado > 0.005 {
				res.Aplicaciones = append(res.Aplicaciones, Aplicacion{Fecha: e.Fecha, Clave: e.Clave, Evento: e, Importe: aplicado})
			}
		case EventoCobro:
			deudores = r2(deudores - e.Monto)
		case EventoRecibo:
			// Lo que falta facturar de sus destinos, menos lo que ya se
			// adelantó para ellos.
			porFacturar := e.PorFacturar
			for _, b := range bolsas[e.Clave] {
				if tocan(b.Destinos, e.Destinos) {
					porFacturar = r2(porFacturar - b.Monto - b.Aplicado)
				}
			}
			rep := RepartoDeRecibo(deudores, e.Monto, e.Retencion, e.Negro, e.Pendiente, porFacturar, e.Reservado)
			if e.Guardado != nil {
				rep = *e.Guardado
			} else {
				if e.ExcedenteAAnticipo {
					if nuevo := ExcedenteAAnticipos(rep, e.Negro); nuevo != rep {
						rep = nuevo
						res.PorRegla[e.ID] = true
					}
				}
				res.Calculados = append(res.Calculados, e.ID)
			}
			destinos := e.Destinos
			for _, d := range e.Reservados {
				if !slices.Contains(destinos, d) {
					destinos = append(append([]string(nil), destinos...), d)
				}
			}
			if e.Pedido != "" {
				res.PorRegla[e.ID] = true
				if e.Pedido != "*" && !slices.Contains(destinos, "o:"+e.Pedido) {
					destinos = append(append([]string(nil), destinos...), "o:"+e.Pedido)
				}
			}
			res.Recibos[e.ID] = rep
			v := &reciboVisto{e: e, rep: rep}
			recibosDe[e.Clave] = append(recibosDe[e.Clave], v)
			visto[e.ID] = v
			chequesDe(v)
			deudores, anticipo = r2(deudores-rep.Deudores), r2(anticipo+rep.Anticipo)
			if rep.Anticipo > 0.005 {
				// Sin pedido, lo que la regla mandó a Anticipos por encima de la
				// seña es un saldo a favor: va a cualquier factura del cliente,
				// y la seña sigue atada a lo que esperaba.
				sena, libre := rep.Anticipo, 0.0
				if e.Pedido == "*" {
					sena = 0
					if e.Pendiente {
						sena = r2(min(rep.Anticipo, max(porFacturar, 0)))
					}
					libre = r2(rep.Anticipo - sena)
				}
				if sena > 0.005 {
					b := &Bolsa{Clave: e.Clave, Recibo: e.ID, Fecha: e.Fecha, Monto: sena, Destinos: destinos, PorRegla: e.Pedido != "" && e.Pedido != "*"}
					bolsas[e.Clave] = append(bolsas[e.Clave], b)
					deRecibo[e.ID] = append(deRecibo[e.ID], b)
				}
				if libre > 0.005 {
					b := &Bolsa{Clave: e.Clave, Recibo: e.ID, Fecha: e.Fecha, Monto: libre, PorRegla: true}
					bolsas[e.Clave] = append(bolsas[e.Clave], b)
					deRecibo[e.ID] = append(deRecibo[e.ID], b)
				}
			}
		case EventoReintegroFacturado:
			deudores = r2(deudores + e.Monto)
		case EventoTramo:
			if rep, ok := res.Recibos[e.ID]; ok {
				t := TramoPorCircuito(rep, e.Monto)
				deudores, anticipo = r2(deudores+t.Deudores), r2(anticipo-t.Anticipo)
				// Lo que vuelve sale primero del saldo a favor y después de la seña.
				falta := t.Anticipo
				for i := len(deRecibo[e.ID]) - 1; i >= 0 && falta > 0.005; i-- {
					b := deRecibo[e.ID][i]
					sale := falta
					if i > 0 {
						sale = min(falta, b.Monto)
					}
					b.Monto, falta = r2(b.Monto-sale), r2(falta-sale)
				}
			}
		case EventoRechazo:
			x := e.Monto
			if bl, ok := res.ChequesBlanco[e.Cheque]; ok && e.Recibo != "" {
				x = min(bl, e.Monto)
			}
			// Primero lo que el recibo dejó en Anticipos sin aplicar.
			sale := 0.0
			for _, b := range deRecibo[e.Recibo] {
				if sale >= x-0.005 {
					break
				}
				t := r2(min(b.Monto, r2(x-sale)))
				if t > 0.005 {
					b.Monto, sale = r2(b.Monto-t), r2(sale+t)
				}
			}
			anticipo, deudores = r2(anticipo-sale), r2(deudores+r2(x-sale))
			res.Rechazos[e.Cheque] = Reparto{Deudores: r2(x - sale), Anticipo: sale, B: r2(e.Monto - x)}
		case EventoPase:
			// Lo que falta para la factura: su total menos lo que ya espera en
			// Anticipos atado a ella o a su pedido.
			falta := e.Monto
			destinos := []string{"i:" + e.ID}
			if e.Pedido != "" {
				destinos = append(destinos, "o:"+e.Pedido)
			}
			for _, b := range bolsas[e.Clave] {
				if tocan(b.Destinos, destinos) {
					falta = r2(falta - b.Monto)
				}
			}
			enCuenta := e.EnCuenta
			pasar := func(x *reciboVisto, tope float64) float64 {
				t := r2(min(libreEnB(x), falta, tope))
				if t <= 0.005 {
					return 0
				}
				res.Pases = append(res.Pases, Pase{Fecha: e.Fecha, Clave: e.Clave, Recibo: x.e.ID, Factura: e.ID, Pedido: e.Pedido, Importe: t,
					BlancoAntes: r2(x.rep.Blanco() + res.Pasado[x.e.ID]), Partes: x.e.Partes})
				res.Pasado[x.e.ID] = r2(res.Pasado[x.e.ID] + t)
				b := &Bolsa{Clave: e.Clave, Recibo: x.e.ID, Fecha: e.Fecha, Monto: t, Destinos: destinos}
				bolsas[e.Clave] = append(bolsas[e.Clave], b)
				deRecibo[x.e.ID] = append(deRecibo[x.e.ID], b)
				anticipo = r2(anticipo + t)
				falta = r2(falta - t)
				chequesDe(x)
				return t
			}
			// Los recibos que cobraron este pedido, y después los de la cuenta
			// desde que se tomó el pedido hasta lo que la cuenta dice pagado.
			for _, x := range recibosDe[e.Clave] {
				if e.Pedido != "" && x.e.PedidoDelRecibo == e.Pedido && !anulado[x.e.ID] {
					pasar(x, falta)
				}
			}
			for _, x := range recibosDe[e.Clave] {
				if enCuenta <= 0.005 || falta <= 0.005 {
					break
				}
				if x.e.PedidoDelRecibo == "" && !x.e.Fecha.Before(e.Desde) && !anulado[x.e.ID] {
					enCuenta = r2(enCuenta - pasar(x, enCuenta))
				}
			}
		case EventoVuelta:
			for _, b := range bolsas[e.Clave] {
				x := visto[b.Recibo]
				if b.Monto <= 0.005 || b.PorRegla || x == nil || anulado[b.Recibo] {
					continue
				}
				if x.e.PedidoDelRecibo != e.Pedido && !(len(b.Destinos) == 1 && b.Destinos[0] == "o:"+e.Pedido) {
					continue
				}
				t := b.Monto
				res.Pases = append(res.Pases, Pase{Fecha: e.Fecha, Clave: e.Clave, Recibo: b.Recibo, Pedido: e.Pedido, Importe: t,
					BlancoAntes: r2(x.rep.Blanco() + res.Pasado[b.Recibo]), Partes: x.e.Partes, AlB: true, Nombre: e.Cliente})
				res.Pasado[b.Recibo] = r2(res.Pasado[b.Recibo] - t)
				b.Monto, anticipo = 0, r2(anticipo-t)
				chequesDe(x)
			}
		case EventoAnulacion:
			rep, ok := res.Recibos[e.ID]
			if !ok {
				continue
			}
			res.Anulados[e.ID] = true
			anulado[e.ID] = true
			deudores = r2(deudores + rep.Deudores)
			// Lo que su anticipo no llegó a aplicar sale de Anticipos; lo que
			// ya había cancelado de una factura vuelve a deberse.
			aplicado := 0.0
			for _, b := range deRecibo[e.ID] {
				anticipo = r2(anticipo - b.Monto)
				aplicado = r2(aplicado + b.Aplicado)
				b.Monto, b.Aplicado = 0, 0
			}
			if aplicado > 0.005 {
				deudores = r2(deudores + aplicado)
				res.Aplicaciones = append(res.Aplicaciones, Aplicacion{Fecha: e.Fecha, Clave: e.Clave, Evento: e, Importe: -aplicado})
			}
		}
		if d := r2(deudores - res.Deudores[e.Clave]); d > 0.005 || d < -0.005 {
			res.MovimientosDeDeudores[e.Clave] = append(res.MovimientosDeDeudores[e.Clave], Movimiento{Monto: d, Fecha: e.Fecha})
		}
		res.Deudores[e.Clave], res.Anticipos[e.Clave] = deudores, anticipo
	}
	for _, e := range ev {
		if e.Tipo != EventoRecibo {
			continue
		}
		for _, b := range deRecibo[e.ID] {
			if b.Monto > 0.005 {
				res.Bolsas = append(res.Bolsas, *b)
			}
		}
	}
	return res
}

// claveDeFactura es la cuenta de la factura `i`: su cliente, o, sin
// cliente, su pedido (todas las facturas y notas de un pedido sin cliente
// son la misma cuenta), o ella sola.
const claveDeFactura = `coalesce('c:' || i.customer_id::text, 'p:' || i.order_id::text, 'f:' || i.id::text)`

// claveDeRecibo: el cliente; sin cliente, la factura que cobra; y si cobra
// un pedido (cobros.CobrarPedido), la cuenta de la factura de ese pedido o,
// sin factura todavía, el pedido mismo.
//
// El recibo de un pedido sin cliente caía en «r:<recibo>» (comité final,
// A4): una cuenta sin facturas ni pedidos, así que todo su cobro iba al B
// —aunque fuera una transferencia— y la factura con CAE quedaba abierta en
// Deudores para siempre. Con «p:<pedido>» el recibo ve su factura (va a
// Deudores) o, antes de facturar, el pedido abierto (va como anticipo y se
// aplica cuando sale la factura, que está en la misma cuenta).
const claveDeRecibo = `coalesce('c:' || r.customer_id::text,
	(SELECT ` + claveDeFactura + ` FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
	 WHERE ip.receipt_id = r.id ORDER BY ip.created_at LIMIT 1),
	(SELECT ` + claveDeFactura + ` FROM invoices i WHERE i.order_id = r.order_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador'
	 ORDER BY i.created_at LIMIT 1),
	'p:' || r.order_id::text,
	'r:' || r.id::text)`

// columnasDelRecibo son las del recibo que agregó el mes simulado: sus
// partes, su pedido y lo que cobró de facturas que ese día esperaban el CAE
// (solo si no tiene el reparto guardado: {G}).
const columnasDelRecibo = `(SELECT coalesce(json_agg(json_build_object('medio', x.medio::text, 'importe', x.importe::float8,
      'negro', coalesce(ch.circuito = 'negro', false), 'cheque', coalesce(x.cheque_id::text, '')) ORDER BY x.orden, x.id), '[]'::json)
     FROM receipt_parts x LEFT JOIN cheques ch ON ch.id = x.cheque_id WHERE x.receipt_id = r.id),
    coalesce(r.order_id::text, ''),
    CASE WHEN {G} THEN (SELECT json_build_object('monto', coalesce(sum(ip.monto), 0)::float8,
        'destinos', coalesce(array_agg(DISTINCT 'i:' || i.id::text), '{}'))
      FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
      WHERE ip.receipt_id = r.id AND ip.medio <> 'cuenta_corriente' AND i.tipo::text NOT LIKE 'nota_credito%' AND i.estado <> 'borrador'
        AND CASE WHEN i.cae IS NULL THEN i.estado IN ('emitida', 'rechazada')
                 ELSE coalesce((SELECT max(l.created_at) FROM arca_log l WHERE l.invoice_id = i.id AND l.exito
                                 AND l.operacion IN ('FECAESolicitar', 'FECompConsultar')), i.fecha_emision) > r.created_at END) END,
    '', '', NULL::timestamptz, 0::float8`

// DeudaSinComprobante: el movimiento `m` de la cuenta de un cliente es deuda
// (o un crédito) cargada a mano, sin comprobante ni recibo ni cheque: el
// saldo inicial migrado, un ajuste, una nota de débito suelta.
const DeudaSinComprobante = `(m.tipo IN ('ajuste', 'nota_debito') AND m.receipt_id IS NULL AND m.cheque_id IS NULL AND m.monto <> 0)`

// ReciboDelCheque es, sobre la fila `c` de cheques, el recibo con el que
// entró (nulo si entró por el mostrador o se cargó suelto).
func ReciboDelCheque(c string) string {
	return strings.ReplaceAll(`coalesce(c.receipt_id::text, (SELECT x.receipt_id::text FROM receipt_parts x WHERE x.cheque_id = c.id ORDER BY x.receipt_id LIMIT 1))`, "c.", c+".")
}

// ramaDelRecibo es la de los recibos en eventosSQL. La columna «pendiente»
// trae {F} (recorteDelRecibo): si el recibo necesita sus pendientes, que
// después calcula pendientes.delRecibo con lo que lee pendientesSQL. Antes
// salían de un LATERAL por recibo que recorría todos los pedidos y las
// facturas del cliente con sus subconsultas: 65 ms por recibo en una cuenta
// de 5.000 pedidos, y una cuenta así con 400 señas tardaba más de 25 s en
// cada emisión, con el candado de recibos tomado.
const ramaDelRecibo = `SELECT ` + claveDeRecibo + `, r.created_at, 2, r.id::text, r.total::float8,
    CASE WHEN {G} THEN coalesce((SELECT sum(importe) FROM receipt_parts WHERE receipt_id = r.id AND medio = 'retencion'), 0) ELSE 0 END::float8,
    CASE WHEN {G} THEN coalesce((SELECT sum(x.importe) FROM receipt_parts x JOIN cheques ch ON ch.id = x.cheque_id
              WHERE x.receipt_id = r.id AND ch.circuito = 'negro'), 0) ELSE 0 END::float8,
    {F},
    r.reparto_deudores::float8, r.reparto_anticipo::float8, r.reparto_b::float8, '', 0, 0, r.recibido_de,
    '{}', 0, CASE WHEN r.anticipo_por_regla THEN coalesce(r.order_id::text, '*') ELSE '' END,
    ` + columnasDelRecibo + `
  FROM receipts r
  WHERE r.created_at <= $1 AND {R}`

// eventosSQL son todos los hechos que mueven Deudores, hasta $1. Los cobros
// sin recibo son los mismos que asienta el cierre (reportes.asientosDeCobro):
// los de una factura de antes de los recibos, la venta pagada sin recibo de
// un pedido facturado y la deuda pagada antes de los recibos; los
// reintegros, en negativo, con los tramos de un reintegro parcial en su
// fecha (corrida a la de la factura, como el cierre) y el resto al
// reintegrarse entero. Sin los tramos, el motor veía Deudores en cero donde
// el CSV tenía lo devuelto, y el próximo recibo de esa deuda iba al B.
//
// {I}, {P} y {R} son los filtros de cada rama: todo, o solo lo de una clave
// (eventosDeUnaClave). Con el filtro sobre la clave calculada no servía
// ningún índice, y cada recibo recorría la historia entera de cobros con el
// candado de recibos tomado. {F} y {G} recortan lo que un recibo ya fijado
// no usa (recorteDelRecibo y sinRepartoGuardado).
var eventosSQL = `
SELECT * FROM (
  SELECT ` + claveDeFactura + ` AS clave, i.fecha_emision AS fecha, 0 AS tipo, i.id::text AS id,
    (CASE WHEN i.tipo::text LIKE 'nota_credito%' THEN -1 ELSE 1 END * i.total)::float8 AS monto, 0::float8 AS retencion,
    0::float8 AS negro, false AS pendiente, NULL::float8 AS rd, NULL::float8 AS ra, NULL::float8 AS rb,
    i.tipo::text AS tipo_cbte, i.punto_venta::bigint AS pv, i.numero::bigint AS nro, i.receptor_nombre AS cliente,
    '{}'::text[] AS destinos, 0::float8 AS por_facturar, coalesce(i.order_id::text, '') AS pedido,
    NULL::json AS partes, ''::text AS pedido_recibo, NULL::json AS reservado, ''::text AS cheque, ''::text AS recibo_cheque,
    NULL::timestamptz AS desde, 0::float8 AS en_cuenta
  FROM invoices i WHERE i.cae IS NOT NULL AND i.cae_ambiente IS DISTINCT FROM 'homologacion' AND i.estado <> 'borrador' AND i.fecha_emision <= $1 AND {I}
  UNION ALL
  SELECT ` + claveDeFactura + `, p.fecha, 1, p.id::text, p.monto::float8, 0, 0, false, NULL, NULL, NULL,
    '', 0, 0, '', '{}', 0, '', NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8
  FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
  WHERE p.receipt_id IS NULL AND p.medio <> 'cuenta_corriente' AND p.fecha <= $1 AND {I}
  UNION ALL
  SELECT x.clave, x.fecha, 1, x.id, x.monto, 0, 0, false, NULL, NULL, NULL, '', 0, 0, '', '{}', 0, '', NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8 FROM (
    SELECT CASE WHEN p.tipo = 'deuda' THEN 'c:' || p.customer_id::text
                ELSE coalesce('c:' || f.customer_id::text, 'p:' || f.order_id::text, 'f:' || f.id::text) END AS clave,
      p.id::text AS id, p.monto::float8 AS monto, p.estado::text AS estado, p.updated_at, f.fecha_emision AS factura,
      greatest(coalesce(p.acreditado_at, CASE WHEN p.proveedor = 'mostrador' THEN coalesce(o.cobrada_at, o.created_at) END,
               p.conciliado_at, p.created_at), coalesce(f.fecha_emision, '-infinity')) AS fecha
    FROM payments p
    LEFT JOIN orders o ON o.id = p.order_id
    LEFT JOIN LATERAL (
      SELECT i.id, i.customer_id, i.order_id, i.fecha_emision FROM invoices i
      WHERE i.order_id = p.order_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND i.cae IS NOT NULL
        AND i.cae_ambiente IS DISTINCT FROM 'homologacion'
      ORDER BY (i.estado = 'anulada'), i.fecha_emision LIMIT 1) f ON true
    WHERE p.estado IN ('aprobado', 'reintegrado') AND {P}
      AND NOT EXISTS (SELECT 1 FROM receipt_parts x WHERE x.payment_id = p.id)
      AND ((p.tipo = 'pedido' AND f.id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoice_id = f.id AND ip.medio <> 'cuenta_corriente'
                              AND ip.receipt_id IS NULL))
        OR (p.tipo = 'deuda' AND p.customer_id IS NOT NULL))
  ) y CROSS JOIN LATERAL (
    SELECT y.clave, y.fecha, y.id, y.monto
    UNION ALL
    SELECT y.clave, greatest(` + FechaDelTramo("t") + `, coalesce(y.factura, '-infinity')), y.id || ':tramo:' || t.id::text, -t.importe::float8
    FROM payment_refunds t WHERE t.payment_id = y.id::uuid
    UNION ALL
    SELECT y.clave, greatest(y.updated_at, coalesce(y.factura, '-infinity')), y.id || ':reintegro',
      -(y.monto - coalesce((SELECT sum(t.importe) FROM payment_refunds t WHERE t.payment_id = y.id::uuid), 0))::float8
    WHERE y.estado = 'reintegrado'
  ) x WHERE x.fecha <= $1 AND abs(x.monto) > 0.005
  UNION ALL
  SELECT ` + claveDeRecibo + `, t.created_at, 4, r.id::text, t.importe::float8, 0, 0, false, NULL, NULL, NULL, '', 0, 0, '', '{}', 0, '', NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8
  FROM payment_refunds t JOIN receipt_parts x ON x.payment_id = t.payment_id JOIN receipts r ON r.id = x.receipt_id
  WHERE t.account_movement_id IS NOT NULL AND t.created_at <= $1 AND {R}
  UNION ALL
  SELECT ` + claveDeRecibo + `, t.created_at, CASE WHEN ` + ReintegroDeLoFacturado + ` THEN 5 ELSE 4 END, r.id::text, t.importe::float8,
    0, 0, false, NULL, NULL, NULL, '', 0, 0, '', '{}', 0, '', NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8
  FROM receipt_refunds t JOIN receipts r ON r.id = t.receipt_id
  WHERE t.created_at <= $1 AND {R}
  UNION ALL
  -- El cheque de un cliente que rebota y le devuelve la deuda (la nota de
  -- débito del cheque): el cierre lo asienta contra Deudores del blanco si
  -- el cheque es del blanco (AsientoDeCheque), así que acá también. Sin esto
  -- el listado de deudores, que sale de este reparto, dejaba afuera al
  -- cliente que debe un cheque rechazado, y el control contra el mayor de
  -- 1.1.03 quedaba encendido para siempre. Con la fecha del cierre
  -- (fragmentos.FechaDelCheque): el del mostrador rechazado antes de la
  -- factura cae con ella, igual que su cobro.
  --
  -- El del mostrador que rebota antes de la factura con CAE da vuelta el
  -- cobro que esperaba en Anticipos (reportes.AsientosDelCobroAntesDeLaFactura):
  -- no toca Deudores hasta el CAE, como ese cobro (M2S3-005). Por eso va
  -- con la fecha de la factura con CAE, y sin ella no está.
  SELECT * FROM (
  SELECT 'c:' || m.customer_id::text, CASE WHEN ` + ReciboDelCheque("c") + ` IS NULL AND c.order_payment_id IS NOT NULL AND e.desde <> 'entregado'
      THEN CASE WHEN fc.fecha IS NOT NULL THEN greatest(` + fragmentos.FechaDelCheque("c", "e.at") + `, fc.fecha) END ELSE ` + fragmentos.FechaDelCheque("c", "e.at") + ` END AS fecha,
    6, 'cheque:' || c.id::text, c.importe::float8, 0, 0, false, NULL::float8, NULL::float8, NULL::float8,
    '', 0, 0, '', '{}'::text[], 0, '', NULL::json, '', NULL::json, c.id::text, coalesce(` + ReciboDelCheque("c") + `, ''), NULL::timestamptz, 0::float8
  FROM cheque_estados e JOIN cheques c ON c.id = e.cheque_id
  CROSS JOIN LATERAL (SELECT am.customer_id FROM account_movements am WHERE am.cheque_id = c.id AND am.tipo = 'nota_debito'
                      ORDER BY am.created_at LIMIT 1) m
  LEFT JOIN LATERAL (SELECT i.fecha_emision AS fecha FROM order_payments op JOIN invoices i ON i.order_id = op.order_id
                     WHERE op.id = c.order_payment_id AND i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND i.cae IS NOT NULL
                       AND i.cae_ambiente IS DISTINCT FROM 'homologacion'
                     ORDER BY (i.estado = 'anulada'), i.fecha_emision LIMIT 1) fc ON true
  WHERE c.sentido = 'recibido' AND (` + ReciboDelCheque("c") + ` IS NOT NULL OR ` + fragmentos.CircuitoDelCheque("c") + ` <> 'negro') AND e.hacia = 'rechazado' AND e.desde IN ('cartera', 'depositado', 'entregado')
    AND {M}) rch
  WHERE rch.fecha <= $1
  UNION ALL
  -- La deuda cargada a mano en la cuenta (el saldo del sistema anterior, una
  -- nota de débito sin comprobante), con la regla «deuda_sin_comprobante» en
  -- «saldo_inicial»: el cierre la asienta en Deudores del blanco, así que acá
  -- también, y su cobro la cancela.
  SELECT 'c:' || m.customer_id::text, m.created_at, 1, 'saldo:' || m.id::text, (-m.monto)::float8, 0, 0, false, NULL, NULL, NULL,
    '', 0, 0, '', '{}', 0, '', NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8
  FROM account_movements m
  WHERE ` + DeudaSinComprobante + ` AND m.created_at <= $1 AND {M}
    AND EXISTS (SELECT 1 FROM site_settings dsc WHERE dsc.clave = 'deuda_sin_comprobante' AND dsc.valor = 'saldo_inicial')
  UNION ALL
  -- La primera factura de cada pedido, el día que se emite (EventoPase).
  SELECT ` + claveDeFactura + `, least(i.created_at, i.fecha_emision), 7, i.id::text, i.total::float8, 0, 0, false, NULL, NULL, NULL,
    '', 0, 0, i.receptor_nombre, '{}', 0, i.order_id::text, NULL::json, '', NULL::json, '', '', o.created_at,
    CASE WHEN o.customer_id IS NOT NULL AND (o.medio_pago IS NOT DISTINCT FROM 'cuenta_corriente' OR EXISTS (SELECT 1 FROM account_movements am
           WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra'))
         THEN greatest(o.total - greatest(coalesce((SELECT sum(am.monto) FROM account_movements am WHERE am.customer_id = o.customer_id
           AND am.created_at <= least(i.created_at, i.fecha_emision)), 0), 0), 0) ELSE -1 END::float8
  FROM invoices i JOIN orders o ON o.id = i.order_id
  WHERE i.tipo::text LIKE 'factura%' AND i.estado <> 'borrador' AND least(i.created_at, i.fecha_emision) <= $1 AND {I}
    AND NOT EXISTS (SELECT 1 FROM invoices j WHERE j.order_id = i.order_id AND j.tipo::text LIKE 'factura%' AND j.estado <> 'borrador'
                      AND (j.created_at, j.id) < (i.created_at, i.id))
  UNION ALL
  -- La entrega de un pedido sin factura que algún recibo cobró (EventoVuelta).
  SELECT coalesce('c:' || o.customer_id::text, 'p:' || o.id::text), h.at, 8, o.id::text, 0, 0, 0, false, NULL, NULL, NULL,
    '', 0, 0, o.numero, '{}', 0, o.id::text, NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8
  FROM orders o CROSS JOIN LATERAL (SELECT min(oh.created_at) AS at FROM order_status_history oh
                                    WHERE oh.order_id = o.id AND oh.estado = 'entregado') h
  WHERE h.at IS NOT NULL AND h.at <= $1 AND o.comprobante IS DISTINCT FROM 'fiscal' AND {O}
    AND (EXISTS (SELECT 1 FROM receipts rv WHERE rv.order_id = o.id)
         OR (o.customer_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts rv WHERE rv.customer_id = o.customer_id AND rv.reparto_anticipo > 0.005)))
    AND NOT EXISTS (SELECT 1 FROM invoices iv WHERE iv.order_id = o.id AND iv.tipo::text LIKE 'factura%' AND iv.estado <> 'borrador'
                      AND least(iv.created_at, iv.fecha_emision) <= h.at)
  UNION ALL
  ` + ramaDelRecibo + `
  UNION ALL
  SELECT ` + claveDeRecibo + `, r.anulado_at, 3, r.id::text, r.total::float8, 0, 0, false, NULL, NULL, NULL, 'recibo', 0, 0, r.numero,
    '{}', 0, '', NULL::json, '', NULL::json, '', '', NULL::timestamptz, 0::float8
  FROM receipts r WHERE r.anulado_at IS NOT NULL AND r.anulado_at <= $1 AND {R}
) e`

// FechaDelTramo es, sobre la fila `t` de payment_refunds, la fecha con la
// que se asienta el tramo (antes de correrlo a la de la factura): la de la
// nota de crédito de la devolución de la que sale, si es posterior. La nota
// que ARCA autoriza al día siguiente sale con la fecha de ese día (y el
// crédito a Deudores, en ese mes): con la del tramo, una devolución por
// afuera del 31 a la noche debitaba Deudores en un mes y la nota lo
// acreditaba en el otro, y el cierre del primero quedaba descuadrado por lo
// devuelto. El aviso de Mercado Pago no tiene devolución: va con la suya.
func FechaDelTramo(t string) string {
	return strings.ReplaceAll(`greatest(t.created_at, coalesce((SELECT dn.fecha_emision FROM devoluciones dd JOIN invoices dn ON dn.id = dd.nota_id
	  WHERE dd.id = t.devolucion_id), t.created_at))`, "t.", t+".")
}

// sinRepartoGuardado es la condición con la que CargarEventos deja un recibo
// sin Guardado (alguna de las tres columnas nula: la 00131 no obliga a que
// vayan juntas, y una carga a mano o una migración a medias puede dejar
// una). Tiene que ser la misma que la de Go: si el SQL diera por fijado un
// recibo que Go recalcula, Go lo recalcularía sin sus pendientes, sin su
// retención y sin su parte B, y el reparto cambiaría sin que nadie lo vea.
const sinRepartoGuardado = `(r.reparto_deudores IS NULL OR r.reparto_anticipo IS NULL OR r.reparto_b IS NULL)`

// recorteDelRecibo dice cuándo un recibo necesita sus pendientes
// (pendientes.delRecibo): si no tiene el reparto guardado, o si lo tiene con
// anticipo, porque los destinos de la seña son los de su bolsa
// (RepartirCobros). Al fijado sin anticipo RepartirCobros le descarta lo que
// calcula con ellos, y con el volumen de ISIS eran 2,3 millones de páginas
// leídas: con los repartos fijados, la consulta de todas las cuentas baja de
// 3,7 s a 0,6 s (sin JIT) y lee 200.000.
// 0,005 es el mismo umbral que el motor (rep.Anticipo > 0.005).
const recorteDelRecibo = `(` + sinRepartoGuardado + ` OR r.reparto_anticipo > 0.005)`

// filtroDeRecibosDeUnaClave es {R} para una clave: $3 el cliente, $4 la
// factura, $5 el recibo y $6 el pedido (los que no correspondan, nulos).
const filtroDeRecibosDeUnaClave = `(r.customer_id = $3::uuid OR r.id = $5::uuid OR r.order_id = $6::uuid OR (r.customer_id IS NULL AND (r.id IN (SELECT ip.receipt_id
			FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
			WHERE ip.receipt_id IS NOT NULL AND (i.customer_id = $3::uuid OR i.id = $4::uuid OR i.order_id = $6::uuid))
			OR r.order_id IN (SELECT i.order_id FROM invoices i WHERE i.customer_id = $3::uuid AND i.order_id IS NOT NULL))))`

// armarEventos arma eventosSQL sin filtro y con el de una clave: $2 la
// clave, $3 el cliente, $4 la factura, $5 el recibo y $6 el pedido (los que
// no correspondan, nulos). Los filtros de las ramas traen de más (todo lo
// del cliente o de la factura, con índice) y el de afuera deja la clave
// exacta. recorte y sinGuardar son {F} y {G}: las pruebas los arman con
// «true», y con el LATERAL de antes en la rama de los recibos, para
// comparar contra el SQL sin recortar.
func armarEventos(base, recorte, sinGuardar string) (todas, unaClave string) {
	todas = strings.NewReplacer("{I}", "true", "{P}", "true", "{R}", "true", "{M}", "true", "{O}", "true",
		"{F}", recorte, "{G}", sinGuardar).Replace(base)
	unaClave = strings.NewReplacer(
		"{F}", recorte, "{G}", sinGuardar,
		"{M}", `m.customer_id = $3::uuid`,
		"{O}", `(o.customer_id = $3::uuid OR o.id = $6::uuid)`,
		"{I}", `(i.customer_id = $3::uuid OR i.id = $4::uuid OR i.order_id = $6::uuid)`,
		"{P}", `(p.customer_id = $3::uuid OR p.order_id = $6::uuid OR p.order_id IN (SELECT i.order_id FROM invoices i
			WHERE (i.customer_id = $3::uuid OR i.id = $4::uuid) AND i.order_id IS NOT NULL))`,
		"{R}", filtroDeRecibosDeUnaClave,
	).Replace(base) + ` WHERE e.clave = $2`
	return todas, unaClave
}

// armarPendientes arma pendientesSQL para todas las cuentas y para una, con
// los mismos parámetros que eventosSQL: lee los recibos que eventosSQL marca
// con {F}, ni uno más.
//
// En una clave, los recibos son los de esa clave, y claveDeRecibo le da
// «c:<cliente>» a todo recibo con cliente: en la de un cliente todos son de
// $3, y en las demás ninguno tiene cliente. {C} («el cliente de alguno de
// esos recibos») va entonces por el índice del cliente, y {S} apaga lo de
// los recibos sin cliente donde no puede haber: con el OR contra las
// subconsultas, Postgres recorría pedidos y facturas enteros.
func armarPendientes(recorte string) (todas, deUnCliente, sinCliente string) {
	r := func(filtro, c, sinCli string) string {
		return strings.NewReplacer("{R}", filtro, "{F}", recorte, "{C}", c, "{S}", sinCli).Replace(pendientesSQL)
	}
	unaClave := filtroDeRecibosDeUnaClave + ` AND ` + claveDeRecibo + ` = $2`
	return r("true", `IN (SELECT customer_id FROM rec)`, "true"),
		r(unaClave, `= $3::uuid AND EXISTS (SELECT 1 FROM rec)`, "false"),
		r(unaClave, `IN (SELECT customer_id FROM rec)`, "true")
}

var (
	eventosDeTodas, eventosDeUnaClave                              = armarEventos(eventosSQL, recorteDelRecibo, sinRepartoGuardado)
	pendientesDeTodas, pendientesDeUnCliente, pendientesSinCliente = armarPendientes(recorteDelRecibo)
)

// PlanDelReparto apaga el JIT de Postgres y fuerza el plan a medida hasta el
// final de la transacción, y devuelve con qué volver a los de antes. Va
// antes de CargarEventos.
//
// El JIT: las subconsultas correlacionadas de eventosSQL hacen que el
// planificador estime un costo de 24 millones para todas las cuentas, y de
// 125.000 para un cliente con 8 recibos: las dos por encima de
// jit_above_cost (100.000), y Postgres compila la consulta. Con el volumen
// de ISIS eran 4,9 s de JIT sobre 3,7 s de trabajo en cada vista del cierre,
// y 0,4–0,6 s de JIT sobre 15–40 ms en cada recibo que se emite.
//
// El plan a medida: FijarReparto corre eventosDeUnaClave por el pool
// principal, donde pgx deja la sentencia preparada, y después de cinco
// ejecuciones en la misma conexión Postgres puede pasar al plan genérico.
// Los filtros de una clave son del tipo «i.customer_id = $3 OR i.id = $4»,
// con la mitad de los parámetros nulos según la clave: el genérico no sabe
// cuáles, y es el mismo problema que ya tuvieron las búsquedas
// (mostrador/buscar.go).
//
// Se ajusta solo acá, con alcance de transacción, y no en el pool: ninguna
// otra consulta cambia de plan. Leer y cambiar los dos va en una sola ida a
// la base: esto corre con el candado de recibos tomado.
func PlanDelReparto(ctx context.Context, tx pgx.Tx) (volver func(context.Context) error, err error) {
	var jit, plan string
	if err := tx.QueryRow(ctx, `SELECT current_setting('jit'), current_setting('plan_cache_mode'),
		set_config('jit', 'off', true), set_config('plan_cache_mode', 'force_custom_plan', true)`).Scan(&jit, &plan, nil, nil); err != nil {
		return nil, err
	}
	return func(ctx context.Context) error {
		_, err := tx.Exec(ctx, `SELECT set_config('jit', $1, true), set_config('plan_cache_mode', $2, true)`, jit, plan)
		return err
	}, nil
}

// CargarEventos lee los hechos de las cuentas hasta `hasta` (de una clave,
// o de todas con "").
//
// Son dos consultas en un mismo viaje a la base: los eventos y lo que hace
// falta para los pendientes de los recibos (pendientes.go). En una
// transacción READ COMMITTED cada una ve su propia foto; el cierre las lee
// en una REPEATABLE READ (reportes.cargarReparto). La emisión del recibo y
// «mjbj repartos» corren en la suya, con el candado de recibos tomado: ningún
// recibo cambia entre las dos, y lo que pasa en el medio con un pedido o una
// factura (un cambio de estado, un CAE) queda con fecha posterior a todos
// los recibos, que lo miran a su fecha.
func CargarEventos(ctx context.Context, db consultor, hasta time.Time, clave string) ([]EventoDeCuenta, error) {
	args := argumentosDeEventos(hasta, clave)
	eventos, pendientes := eventosDeTodas, pendientesDeTodas
	switch {
	case strings.HasPrefix(clave, "c:"):
		eventos, pendientes = eventosDeUnaClave, pendientesDeUnCliente
	case clave != "":
		eventos, pendientes = eventosDeUnaClave, pendientesSinCliente
	}
	lote := &pgx.Batch{}
	lote.Queue(eventos, args...)
	lote.Queue(pendientes, args...)
	br := db.SendBatch(ctx, lote)
	defer br.Close()
	rs, err := br.Query()
	if err != nil {
		return nil, err
	}
	out, err := leerEventos(rs)
	if err != nil {
		return nil, err
	}
	rs, err = br.Query()
	if err != nil {
		return nil, err
	}
	p, err := leerPendientes(rs)
	if err != nil {
		return nil, err
	}
	if err := br.Close(); err != nil {
		return nil, err
	}
	for k := range out {
		e := &out[k]
		if e.Tipo != EventoRecibo {
			continue
		}
		// La columna trae {F}: si necesita sus pendientes.
		necesita := e.Pendiente
		e.Pendiente = false
		if !necesita {
			continue
		}
		r, ok := p.recibos[e.ID]
		if !ok {
			return nil, fmt.Errorf("cobros: el recibo %s no vino con sus pendientes", e.ID)
		}
		e.Destinos, e.PorFacturar = p.delRecibo(r)
		e.Pendiente = len(e.Destinos) > 0
	}
	return out, nil
}

type consultor interface {
	SendBatch(ctx context.Context, b *pgx.Batch) pgx.BatchResults
}

func argumentosDeEventos(hasta time.Time, clave string) []any {
	if clave == "" {
		return []any{hasta}
	}
	var cliente, factura, recibo, pedido *string
	id := clave[2:]
	switch clave[:2] {
	case "c:":
		cliente = &id
	case "f:":
		factura = &id
	case "p:":
		pedido = &id
	default:
		recibo = &id
	}
	return []any{hasta, clave, cliente, factura, recibo, pedido}
}

func leerEventos(rs pgx.Rows) ([]EventoDeCuenta, error) {
	var out []EventoDeCuenta
	var e EventoDeCuenta
	var tipo int
	var rd, ra, rb *float64
	var partes []ParteCobrada
	var reservado *struct {
		Monto    float64  `json:"monto"`
		Destinos []string `json:"destinos"`
	}
	var desde *time.Time
	_, err := pgx.ForEachRow(rs, []any{&e.Clave, &e.Fecha, &tipo, &e.ID, &e.Monto, &e.Retencion, &e.Negro, &e.Pendiente, &rd, &ra, &rb,
		&e.TipoComprobante, &e.PuntoVenta, &e.Numero, &e.Cliente, &e.Destinos, &e.PorFacturar, &e.Pedido,
		&partes, &e.PedidoDelRecibo, &reservado, &e.Cheque, &e.Recibo, &desde, &e.EnCuenta}, func() error {
		x := e
		x.Tipo = TipoDeEvento(tipo)
		x.Destinos = append([]string(nil), e.Destinos...)
		x.Partes = append([]ParteCobrada(nil), partes...)
		x.Guardado = nil
		if rd != nil && ra != nil && rb != nil {
			x.Guardado = &Reparto{Deudores: *rd, Anticipo: *ra, B: *rb}
		}
		x.Reservado, x.Reservados = 0, nil
		if reservado != nil && reservado.Monto > 0.005 {
			x.Reservado, x.Reservados = reservado.Monto, append([]string(nil), reservado.Destinos...)
		}
		x.Desde = time.Time{}
		if desde != nil {
			x.Desde = *desde
		}
		partes, reservado, desde = nil, nil, nil
		out = append(out, x)
		return nil
	})
	return out, err
}

// FijarReparto calcula y guarda el reparto de un recibo recién emitido, en
// la transacción que lo emite. Va después de que el recibo tiene sus partes
// y, si no tiene cliente, después de atarlo a la factura que cobra (la clave
// sale de ahí).
func FijarReparto(ctx context.Context, tx pgx.Tx, recibo string) (Reparto, error) {
	// Se puede volver a fijar en la misma emisión (después de atar el recibo a
	// las facturas que cobra): sin lo de la vez anterior, que si no el motor lo
	// toma como guardado.
	var clave string
	if err := tx.QueryRow(ctx, `UPDATE receipts r SET reparto_deudores = NULL, reparto_anticipo = NULL, reparto_b = NULL
		WHERE r.id = $1 RETURNING `+claveDeRecibo, recibo).Scan(&clave); err != nil {
		return Reparto{}, err
	}
	// Sin JIT y con el plan a medida también acá: la cuenta de un solo
	// cliente ya pasa el umbral del JIT (PlanDelReparto), y esto corre con el
	// candado de recibos tomado. Después vuelve a los de antes: el resto de
	// la emisión no cambia.
	volver, err := PlanDelReparto(ctx, tx)
	if err != nil {
		return Reparto{}, err
	}
	ev, err := CargarEventos(ctx, tx, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), clave)
	if err != nil {
		return Reparto{}, err
	}
	if err := volver(ctx); err != nil {
		return Reparto{}, err
	}
	aAnticipo, err := excedenteAAnticipo(ctx, tx, recibo)
	if err != nil {
		return Reparto{}, err
	}
	if aAnticipo {
		for i := range ev {
			if ev[i].Tipo == EventoRecibo && ev[i].ID == recibo {
				ev[i].ExcedenteAAnticipo = true
			}
		}
	}
	res := RepartirCobros(ev)
	rep := res.Recibos[recibo]
	// Si la regla movió algo, el recibo queda marcado: su anticipo va a su
	// pedido (o a la próxima factura) aunque no hubiera nada pendiente.
	porRegla := res.PorRegla[recibo]
	if _, err = tx.Exec(ctx, `UPDATE receipts SET reparto_deudores = $2::numeric, reparto_anticipo = $3::numeric, reparto_b = $4::numeric,
		anticipo_por_regla = $5 WHERE id = $1`, recibo, jsmath.Fijo2(rep.Deudores), jsmath.Fijo2(rep.Anticipo), jsmath.Fijo2(rep.B), porRegla); err != nil {
		return rep, err
	}
	return rep, marcarCheques(ctx, tx, recibo, rep.Blanco())
}

// excedenteAAnticipo lee la regla que le toca al recibo: la del cobro antes
// de facturar si cobra un pedido, la del excedente de cuenta corriente si
// no. Las dos arrancan en «circuito_b» (el reparto de siempre).
func excedenteAAnticipo(ctx context.Context, tx pgx.Tx, recibo string) (bool, error) {
	var conPedido bool
	if err := tx.QueryRow(ctx, `SELECT order_id IS NOT NULL FROM receipts WHERE id = $1`, recibo).Scan(&conPedido); err != nil {
		return false, err
	}
	clave := reglas.ExcedenteCuentaCorriente
	if conPedido {
		clave = reglas.CobroAntesDeFacturar
	}
	v, err := reglas.Valor(ctx, tx, clave)
	return v == "anticipos", err
}

// FijarRepartosDeAntes fija, una sola vez, el reparto de los recibos de antes
// de que existiera (los que lo tienen nulo), con los hechos a la fecha de
// cada uno. Antes lo hacía la primera lectura del cierre: abrir la pantalla
// escribía en receipts, y el resultado dependía del día en que alguien la
// abría. Ahora es un paso explícito (mjbj repartos), que se corre antes de
// cargar el certificado; mientras no se corra, el cierre los calcula igual,
// con la misma regla, sin guardarlos.
func FijarRepartosDeAntes(ctx context.Context, tx pgx.Tx) ([]string, error) {
	volver, err := PlanDelReparto(ctx, tx)
	if err != nil {
		return nil, err
	}
	ev, err := CargarEventos(ctx, tx, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC), "")
	if err != nil {
		return nil, err
	}
	if err := volver(ctx); err != nil {
		return nil, err
	}
	res := RepartirCobros(ev)
	lote := &pgx.Batch{}
	for _, id := range res.Calculados {
		r := res.Recibos[id]
		lote.Queue(`UPDATE receipts SET reparto_deudores = $2::numeric, reparto_anticipo = $3::numeric, reparto_b = $4::numeric
			WHERE id = $1 AND reparto_deudores IS NULL`, id, jsmath.Fijo2(r.Deudores), jsmath.Fijo2(r.Anticipo), jsmath.Fijo2(r.B))
	}
	if lote.Len() > 0 {
		if err := tx.SendBatch(ctx, lote).Close(); err != nil {
			return nil, err
		}
	}
	return res.Calculados, nil
}

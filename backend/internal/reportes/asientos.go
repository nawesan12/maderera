package reportes

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"mjbj/internal/cobros"
	"mjbj/internal/csvexcel"
	"mjbj/internal/jsmath"
)

// Los asientos para el estudio contable (lib/contable/asientos.ts). No es
// contabilidad registrada: es la traducción de cada operación a renglones de
// debe y haber, para que el estudio la importe. La invariante es una sola:
// debe igual a haber.

// Cuentas es CUENTAS, el plan mínimo (los códigos son una sugerencia).
//
// Las retenciones y percepciones van cada una a la cuenta de su impuesto
// (revisión del comité, T6): todas juntas en 1.1.06 no se podían conciliar
// con lo que se compensa en cada declaración. Los códigos son nuevos y no
// reusan los de antes: 1.1.06 y 2.1.05 quedan solo para lo que no dice de qué
// impuesto es (las de antes de saberlo), así lo que el estudio ya importó con
// esos códigos no cambia de sentido.
var Cuentas = struct {
	Caja, Banco, Deudores, IvaCredito, RetencionesSufridas, Mercaderias         string
	Proveedores, IvaDebito, PercepcionesIibb, RetencionesAPagar, Ventas, Gastos string
	ValoresADepositar                                                           string
	// AnticiposDeClientes: lo cobrado antes de la factura (cobros.Reparto).
	AnticiposDeClientes string
	// VentasSinFactura: solo en el CSV del circuito B, contra lo que cobra.
	VentasSinFactura string
	// Lo que nos retuvieron o percibieron, por impuesto (créditos).
	RetSufridaIva, RetSufridaGanancias, RetSufridaIibb, RetSufridaSuss string
	PercSufridaIva, PercSufridaIibb                                    string
	// ChequesDiferidos: el cheque propio con fecha posterior al pago, hasta
	// que el banco lo debita.
	ChequesDiferidos string
	// Lo que retuvimos como agentes, por impuesto (deudas con el fisco).
	RetADepositarIva, RetADepositarGanancias, RetADepositarIibb, RetADepositarSuss string
	// Comisiones: lo que Mercado Pago se queda de un cobro (payments.comision).
	Comisiones string
	// CostoDeVentas: el costo de lo vendido, contra Mercaderías (H160).
	CostoDeVentas string
	// CobrosAImputar: la cuenta transitoria del cobro de una factura que
	// espera el CAE (regla «asiento_sin_cae» en «transitoria»).
	CobrosAImputar string
	// DiferenciasDeCaja: el faltante o sobrante del arqueo. La cuenta la
	// tiene que definir el contador; mientras tanto va acá, a la vista.
	DiferenciasDeCaja string
	// MovimientosAImputar: la plata que entra o sale sin que el sistema sepa
	// contra qué (el retiro de caja «otro», la devolución «por otro medio»,
	// el cheque cargado sin cobro). Transitoria, a la vista del estudio hasta
	// que diga a qué cuenta va (mes simulado, M2S3-003, M3S1-052, M3S2-004).
	MovimientosAImputar string
	// SaldosIniciales: la contrapartida de lo que entra a una cuenta sin
	// comprobante (el saldo inicial que vino del sistema anterior, un ajuste
	// a mano del libro de un proveedor), a definir por el estudio
	// (M3S1-019, M3S4-006).
	SaldosIniciales string
	// TarjetasAAcreditar: lo cobrado con tarjeta hasta que la tarjeta
	// liquida (liquidaciones_tarjeta, M2S1-058).
	TarjetasAAcreditar string
	// AjustesConProveedores: un ajuste anotado a mano en la cuenta de un
	// proveedor (una bonificación, un redondeo). No tenía asiento y
	// Proveedores del archivo no coincidía con la ficha (M3S2-028). Como las
	// diferencias de caja, la cuenta la define el contador.
	AjustesConProveedores string
	// DiferenciasDeInventario: la baja (o el alta) de mercadería sin venta
	// —rotura, faltante, conteo, consumo del taller—, contra Mercaderías
	// (M3S3-013). La cuenta la define el contador; mientras tanto va acá.
	DiferenciasDeInventario string
}{"1.1.01", "1.1.02", "1.1.03", "1.1.05", "1.1.06", "1.2.01", "2.1.01", "2.1.03", "2.1.04", "2.1.05", "4.1.01", "5.1.01", "1.1.04",
	"2.1.06", "4.1.02",
	"1.1.07", "1.1.08", "1.1.09", "1.1.10", "1.1.11", "1.1.12",
	"2.1.07",
	"2.1.08", "2.1.09", "2.1.10", "2.1.11",
	"5.1.11",
	"5.2.01", "2.1.12", "5.1.12", "2.1.13", "3.1.01", "1.1.13",
	"5.1.13",
	"5.1.14"}

// AsientoDeAjusteDeProveedor es el de un ajuste a mano en la cuenta de un
// proveedor: el que baja la deuda, Proveedores contra Ajustes; el que la
// sube, al revés.
func AsientoDeAjusteDeProveedor(fecha time.Time, proveedor, detalle string, monto float64) Asiento {
	concepto := "Ajuste con " + proveedor
	if detalle != "" {
		concepto += ": " + detalle
	}
	m := redondear(math.Abs(monto))
	if monto < 0 {
		return asiento(fecha, concepto, []RenglonDeAsiento{renglon(Cuentas.Proveedores, m, 0), renglon(Cuentas.AjustesConProveedores, 0, m)})
	}
	return asiento(fecha, concepto, []RenglonDeAsiento{renglon(Cuentas.AjustesConProveedores, m, 0), renglon(Cuentas.Proveedores, 0, m)})
}

// CuentaDeRetencionSufrida es la cuenta del crédito por una retención que
// nos practicaron, según el impuesto ("" o desconocido: 1.1.06).
func CuentaDeRetencionSufrida(impuesto string) string {
	switch impuesto {
	case "iva":
		return Cuentas.RetSufridaIva
	case "ganancias":
		return Cuentas.RetSufridaGanancias
	case "iibb":
		return Cuentas.RetSufridaIibb
	case "suss":
		return Cuentas.RetSufridaSuss
	}
	return Cuentas.RetencionesSufridas
}

// CuentaDeRetencionADepositar es la de lo que retuvimos, según el impuesto
// ("" o desconocido: 2.1.05).
func CuentaDeRetencionADepositar(impuesto string) string {
	switch impuesto {
	case "iva":
		return Cuentas.RetADepositarIva
	case "ganancias":
		return Cuentas.RetADepositarGanancias
	case "iibb":
		return Cuentas.RetADepositarIibb
	case "suss":
		return Cuentas.RetADepositarSuss
	}
	return Cuentas.RetencionesAPagar
}

// CuentaPorCategoria es CUENTA_POR_CATEGORIA.
var CuentaPorCategoria = map[string]string{
	"flete": "5.1.02", "combustible": "5.1.03", "servicios": "5.1.04", "alquiler": "5.1.05", "sueldos": "5.1.06",
	"mantenimiento": "5.1.07", "impuestos": "5.1.08", "librería": "5.1.09", "publicidad": "5.1.10",
}

var nombresDeCuenta = map[string]string{
	"1.1.01": "Caja", "1.1.02": "Banco", "1.1.03": "Deudores por ventas", "1.1.04": "Valores a depositar", "1.1.05": "IVA crédito fiscal",
	"1.1.06": "Retenciones sufridas", "1.2.01": "Mercaderías", "2.1.01": "Proveedores", "2.1.03": "IVA débito fiscal",
	"2.1.04": "Percepciones IIBB a depositar", "2.1.05": "Retenciones a depositar", "2.1.06": "Anticipos de clientes", "4.1.01": "Ventas",
	"4.1.02": "Ventas sin factura",
	"1.1.07": "Retenciones sufridas IVA", "1.1.08": "Retenciones sufridas Ganancias", "1.1.09": "Retenciones sufridas IIBB",
	"1.1.10": "Retenciones sufridas SUSS", "1.1.11": "Percepciones sufridas IVA", "1.1.12": "Percepciones sufridas IIBB",
	"2.1.07": "Cheques diferidos a pagar", "2.1.08": "Retenciones IVA a depositar", "2.1.09": "Retenciones Ganancias a depositar",
	"2.1.10": "Retenciones IIBB a depositar", "2.1.11": "Retenciones SUSS a depositar",
	"5.1.01": "Gastos varios", "5.1.02": "Fletes", "5.1.03": "Combustible", "5.1.04": "Servicios", "5.1.05": "Alquileres",
	"5.1.06": "Sueldos y cargas", "5.1.07": "Mantenimiento", "5.1.08": "Impuestos y tasas", "5.1.09": "Librería y oficina",
	"5.1.10": "Publicidad", "5.1.11": "Comisiones y gastos bancarios",
	"5.2.01": "Costo de mercaderías vendidas", "2.1.12": "Cobros a imputar (facturas sin CAE)",
	"5.1.12": "Diferencias de caja (a definir)", "2.1.13": "Movimientos de fondos a imputar (a definir)",
	"3.1.01": "Saldos iniciales y ajustes (a definir)", "1.1.13": "Tarjetas a acreditar",
	"5.1.13": "Ajustes con proveedores (a definir)",
	"5.1.14": "Diferencias de inventario (a definir)",
}

// RenglonDeAsiento es RenglonDeAsiento.
type RenglonDeAsiento struct {
	Cuenta string  `json:"cuenta"`
	Nombre string  `json:"nombre"`
	Debe   float64 `json:"debe"`
	Haber  float64 `json:"haber"`
}

// Asiento es Asiento, con si balancea (el TS lo preguntaba aparte).
type Asiento struct {
	Fecha     time.Time          `json:"fecha"`
	Concepto  string             `json:"concepto"`
	Renglones []RenglonDeAsiento `json:"renglones"`
	Balancea  bool               `json:"balancea"`
	// Circuito: "" o "blanco" va al CSV del estudio; "negro" solo al del
	// circuito B (los gastos y pagos marcados así, y la parte B de los
	// recibos).
	Circuito string `json:"circuito,omitempty"`
	// Instante: la fecha es un momento (una venta, un cobro, un pago, el
	// cambio de estado de un cheque) y el CSV la fecha en hora argentina. Si
	// no, es un día guardado a las 0 UTC (un gasto, una factura de compra).
	Instante bool `json:"-"`
}

// CircuitoNegro es el circuito B.
const CircuitoNegro = "negro"

func (a Asiento) circuito() string {
	if a.Circuito == "" {
		return "blanco"
	}
	return a.Circuito
}

func redondear(v float64) float64 { return jsmath.Round(float64(v*100)) / 100 }

func renglon(cuenta string, debe, haber float64) RenglonDeAsiento {
	nombre, ok := nombresDeCuenta[cuenta]
	if !ok {
		nombre = cuenta
	}
	return RenglonDeAsiento{Cuenta: cuenta, Nombre: nombre, Debe: redondear(debe), Haber: redondear(haber)}
}

// toleranciaAsiento: medio centavo.
const toleranciaAsiento = 0.005

// Balancea es balancea: debe igual a haber, con medio centavo de tolerancia.
func Balancea(r []RenglonDeAsiento) bool {
	var debe, haber float64
	for _, x := range r {
		debe = float64(debe + x.Debe)
	}
	for _, x := range r {
		haber = float64(haber + x.Haber)
	}
	return math.Abs(debe-haber) <= toleranciaAsiento
}

func invertir(r []RenglonDeAsiento) []RenglonDeAsiento {
	out := make([]RenglonDeAsiento, len(r))
	for i, x := range r {
		out[i] = RenglonDeAsiento{Cuenta: x.Cuenta, Nombre: x.Nombre, Debe: x.Haber, Haber: x.Debe}
	}
	return out
}

func asiento(fecha time.Time, concepto string, r []RenglonDeAsiento) Asiento {
	return Asiento{Fecha: fecha, Concepto: concepto, Renglones: r, Balancea: Balancea(r)}
}

// VentaAAsentar es VentaAAsentar.
type VentaAAsentar struct {
	Fecha                      time.Time
	Comprobante, Cliente       string
	Neto, Iva, Tributos, Total float64
	EsNotaDeCredito            bool
	// Exento: lo exento y no gravado va a Ventas sin IVA.
	Exento float64
}

// AsientoDeVenta es asientoDeVenta.
func AsientoDeVenta(v VentaAAsentar) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.Deudores, v.Total, 0), renglon(Cuentas.Ventas, 0, v.Neto+v.Exento)}
	if v.Iva != 0 {
		r = append(r, renglon(Cuentas.IvaDebito, 0, v.Iva))
	}
	if v.Tributos != 0 {
		r = append(r, renglon(Cuentas.PercepcionesIibb, 0, v.Tributos))
	}
	if v.EsNotaDeCredito {
		r = invertir(r)
	}
	return asiento(v.Fecha, v.Comprobante+" · "+v.Cliente, r)
}

// CobroAAsentar es CobroAAsentar.
type CobroAAsentar struct {
	Fecha                       time.Time
	Comprobante, Cliente, Medio string
	Importe                     float64
	// Comision: lo que Mercado Pago se quedó del cobro. Banco recibe el
	// neto y la comisión va a su cuenta (renglonesDeEntrada).
	Comision float64
}

func cuentaDeMedio(medio string) string {
	if medio == "efectivo" {
		return Cuentas.Caja
	}
	return Cuentas.Banco
}

// cuentaDeCobro: el cheque cobrado no es plata en el banco hasta que se
// deposita y se acredita; la retención que el cliente practicó no es plata
// sino un crédito contra el impuesto.
func cuentaDeCobro(medio string) string {
	switch medio {
	case "cheque", "echeq":
		return Cuentas.ValoresADepositar
	case "retencion":
		return Cuentas.RetencionesSufridas
	case MedioAImputar:
		return Cuentas.MovimientosAImputar
	case "tarjeta", "tarjeta_debito", "tarjeta_credito", "debito", "credito":
		return Cuentas.TarjetasAAcreditar
	}
	return cuentaDeMedio(medio)
}

// MedioAImputar es el de la plata que salió por un medio que el sistema no
// conoce (la devolución «por otro medio»): va a Movimientos a imputar.
const MedioAImputar = "a_imputar"

// AsientoDeCobro es asientoDeCobro. Pasar una factura a cuenta corriente no
// es un cobro (no entra plata: la deuda sigue en Deudores), así que no se
// asienta: AsientosDelPeriodo la saltea.
func AsientoDeCobro(c CobroAAsentar) Asiento {
	return asiento(c.Fecha, "Cobro "+c.Comprobante+" · "+c.Cliente, append(
		renglonesDeEntrada(cuentaDeCobro(c.Medio), c.Importe, c.Comision), renglon(Cuentas.Deudores, 0, c.Importe)))
}

// renglonesDeEntrada es el debe de lo que entró en `cuenta`: un renglón por
// el importe o, si es plata que pasó por Mercado Pago y se quedó una
// comisión, Banco por el neto y la comisión a Comisiones y gastos
// bancarios. Sin comisión (todo lo de antes, el efectivo, el cheque) es el
// renglón de siempre, byte a byte.
func renglonesDeEntrada(cuenta string, importe, comision float64) []RenglonDeAsiento {
	if comision <= toleranciaAsiento || cuenta != Cuentas.Banco || comision > importe {
		return []RenglonDeAsiento{renglon(cuenta, importe, 0)}
	}
	return []RenglonDeAsiento{renglon(cuenta, float64(importe-comision), 0), renglon(Cuentas.Comisiones, comision, 0)}
}

// AsientoDeReintegro es el cobro al revés: la plata vuelve al cliente (o
// el cheque se anula con la venta) y la deuda vuelve a Deudores.
//
// Con Comision (el reintegro entero de un cobro de Mercado Pago), es el
// cobro exactamente al revés: la comisión vuelve con el pago.
func AsientoDeReintegro(c CobroAAsentar) Asiento {
	return asiento(c.Fecha, "Reintegro "+c.Comprobante+" · "+c.Cliente, append([]RenglonDeAsiento{
		renglon(Cuentas.Deudores, c.Importe, 0)}, invertir(renglonesDeEntrada(cuentaDeCobro(c.Medio), c.Importe, c.Comision))...))
}

// ParteDeRecibo es con qué se pagó una parte del recibo.
type ParteDeRecibo struct {
	Medio   string
	Importe float64
	// Negro: un cheque marcado del circuito B. Va entero al B.
	Negro bool
	// Impuesto de una parte «retencion» (retenciones_sufridas del recibo):
	// va a la cuenta de ese impuesto. Vacío: a Retenciones sufridas.
	Impuesto string
	// Comision: lo que Mercado Pago se quedó de esta parte (el pago que
	// nombra, payments.comision).
	Comision float64
}

// cuentaDeParte es cuentaDeCobro con el impuesto de la retención.
func cuentaDeParte(p ParteDeRecibo) string {
	if p.Medio == "retencion" && p.Impuesto != "" {
		return CuentaDeRetencionSufrida(p.Impuesto)
	}
	return cuentaDeCobro(p.Medio)
}

// Bancarizado dice si el medio deja rastro en un banco o en ARCA: la
// transferencia y el depósito en el extracto, Mercado Pago y las tarjetas en
// lo que informan a ARCA, y el cheque blanco porque se deposita en la cuenta.
func (p ParteDeRecibo) Bancarizado() bool {
	return p.Medio != "efectivo" && p.Medio != "retencion" && !p.Negro
}

// ReciboAAsentar es un recibo emitido o su anulación.
type ReciboAAsentar struct {
	Fecha           time.Time
	Numero, Cliente string
	Partes          []ParteDeRecibo
	Anulacion       bool
	// Reparto entre los circuitos (cobros.Reparto). Nil: todo a Deudores.
	Reparto *cobros.Reparto
}

// PartesPorCircuito separa las partes de un recibo en lo blanco y lo B, por
// prioridad de medio y no en proporción: las retenciones son siempre blancas
// (crédito fiscal con certificado) y los cheques del B, siempre B; lo blanco
// que falta sale primero de lo bancarizado y después del efectivo, y lo B,
// del efectivo. En proporción, una transferencia de 600 en un recibo con 400
// de B mandaba 177,78 al archivo B: el extracto mostraba 600 y los libros
// del estudio 422,22, una diferencia de conciliación por mes. Si lo B no
// alcanza a salir del efectivo, lo bancarizado que queda en el B lo marca el
// cierre (BancarizadoEnB).
func PartesPorCircuito(partes []ParteDeRecibo, rep cobros.Reparto) (blanco, b []ParteDeRecibo) {
	falta := rep.Blanco()
	asignado := make([]float64, len(partes))
	tomar := func(i int) {
		x := min(partes[i].Importe, max(falta, 0))
		asignado[i] = redondear(x)
		falta = redondear(falta - asignado[i])
	}
	// Retenciones, después lo bancarizado, después el efectivo. Un cheque del
	// B nunca completa lo blanco (comité final, M8): es plata del otro
	// circuito, y su depósito, su endoso o su rechazo van al archivo B. El
	// reparto nunca pide de lo blanco más que lo que no es cheque B
	// (cobros.RepartoDeRecibo); si un reparto viejo lo pidiera, el asiento
	// sale «NO CIERRA» en vez de esconderlo.
	for _, orden := range []func(ParteDeRecibo) bool{
		func(p ParteDeRecibo) bool { return p.Medio == "retencion" },
		func(p ParteDeRecibo) bool { return p.Bancarizado() },
		func(p ParteDeRecibo) bool { return p.Medio == "efectivo" && !p.Negro },
	} {
		for i, p := range partes {
			if orden(p) && asignado[i] == 0 {
				tomar(i)
			}
		}
	}
	for i, p := range partes {
		// La comisión se reparte como la parte: cada circuito asienta la
		// suya, Banco por su neto.
		comisionBlanca := 0.0
		if p.Comision > 0 && p.Importe > 0 {
			comisionBlanca = redondear(float64(p.Comision*asignado[i]) / p.Importe)
		}
		if bl := asignado[i]; bl > toleranciaAsiento {
			blanco = append(blanco, ParteDeRecibo{Medio: p.Medio, Importe: bl, Negro: p.Negro, Impuesto: p.Impuesto, Comision: comisionBlanca})
		}
		if resto := redondear(p.Importe - asignado[i]); resto > toleranciaAsiento {
			b = append(b, ParteDeRecibo{Medio: p.Medio, Importe: resto, Negro: p.Negro, Impuesto: p.Impuesto,
				Comision: redondear(p.Comision - comisionBlanca)})
		}
	}
	return blanco, b
}

// BancarizadoEnB es lo bancarizado que el reparto deja en el circuito B.
func BancarizadoEnB(partes []ParteDeRecibo, rep cobros.Reparto) float64 {
	_, b := PartesPorCircuito(partes, rep)
	total := 0.0
	for _, p := range b {
		if p.Bancarizado() {
			total = float64(total + p.Importe)
		}
	}
	return redondear(total)
}

// AsientosDeRecibo son los del recibo con su reparto: el blanco (las partes
// contra Deudores y Anticipos de clientes) y el B (contra Ventas sin
// factura), cada uno solo si tiene algo.
func AsientosDeRecibo(r ReciboAAsentar) []Asiento {
	if r.Reparto == nil {
		return []Asiento{AsientoDeRecibo(r)}
	}
	rep := *r.Reparto
	blanco, b := PartesPorCircuito(r.Partes, rep)
	concepto := "Recibo " + r.Numero + " · " + r.Cliente
	if r.Anulacion {
		concepto = "Anulación del recibo " + r.Numero + " · " + r.Cliente
	}
	var out []Asiento
	if rep.Blanco() > toleranciaAsiento {
		renglones := []RenglonDeAsiento{}
		for _, p := range blanco {
			renglones = append(renglones, renglonesDeEntrada(cuentaDeParte(p), p.Importe, p.Comision)...)
		}
		if rep.Deudores > toleranciaAsiento {
			renglones = append(renglones, renglon(Cuentas.Deudores, 0, rep.Deudores))
		}
		if rep.Anticipo > toleranciaAsiento {
			renglones = append(renglones, renglon(Cuentas.AnticiposDeClientes, 0, rep.Anticipo))
		}
		if r.Anulacion {
			renglones = invertir(renglones)
		}
		out = append(out, asiento(r.Fecha, concepto, renglones))
	}
	if rep.B > toleranciaAsiento {
		renglones := []RenglonDeAsiento{}
		for _, p := range b {
			renglones = append(renglones, renglonesDeEntrada(cuentaDeParte(p), p.Importe, p.Comision)...)
		}
		renglones = append(renglones, renglon(Cuentas.VentasSinFactura, 0, rep.B))
		if r.Anulacion {
			renglones = invertir(renglones)
		}
		a := asiento(r.Fecha, concepto, renglones)
		a.Circuito = CircuitoNegro
		out = append(out, a)
	}
	return out
}

// AsientosDeTramo es el reintegro parcial de un recibo repartido: lo que
// vuelve a Deudores y a Anticipos en el blanco, y lo del B en el suyo.
func AsientosDeTramo(c CobroAAsentar, t cobros.Reparto) []Asiento {
	var out []Asiento
	concepto := "Reintegro " + c.Comprobante + " · " + c.Cliente
	if blanco := t.Blanco(); blanco > toleranciaAsiento {
		r := []RenglonDeAsiento{}
		if t.Deudores > toleranciaAsiento {
			r = append(r, renglon(Cuentas.Deudores, t.Deudores, 0))
		}
		if t.Anticipo > toleranciaAsiento {
			r = append(r, renglon(Cuentas.AnticiposDeClientes, t.Anticipo, 0))
		}
		out = append(out, asiento(c.Fecha, concepto, append(r, renglon(cuentaDeCobro(c.Medio), 0, blanco))))
	}
	if t.B > toleranciaAsiento {
		a := asiento(c.Fecha, concepto, []RenglonDeAsiento{renglon(Cuentas.VentasSinFactura, t.B, 0), renglon(cuentaDeCobro(c.Medio), 0, t.B)})
		a.Circuito = CircuitoNegro
		out = append(out, a)
	}
	return out
}

// AsientoDeAplicacion pasa un anticipo a cancelar la factura que salió con
// CAE (o lo devuelve a Anticipos, en negativo, si se anuló el recibo que lo
// había dejado).
func AsientoDeAplicacion(fecha time.Time, concepto string, importe float64) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.AnticiposDeClientes, importe, 0), renglon(Cuentas.Deudores, 0, importe)}
	if importe < 0 {
		r = []RenglonDeAsiento{renglon(Cuentas.Deudores, -importe, 0), renglon(Cuentas.AnticiposDeClientes, 0, -importe)}
	}
	return asiento(fecha, concepto, r)
}

// AsientoDeRecibo es el cobro de un recibo: un renglón por parte, cada medio
// a su cuenta (efectivo a Caja, cheques a Valores a depositar, la retención a
// Retenciones sufridas, lo demás a Banco), contra Deudores por el total. La
// anulación es el mismo asiento al revés, en su fecha: el del recibo no se
// toca, porque el mes en que se emitió puede estar cerrado.
func AsientoDeRecibo(r ReciboAAsentar) Asiento {
	renglones := []RenglonDeAsiento{}
	total := 0.0
	for _, p := range r.Partes {
		renglones = append(renglones, renglonesDeEntrada(cuentaDeParte(p), p.Importe, p.Comision)...)
		total = float64(total + p.Importe)
	}
	renglones = append(renglones, renglon(Cuentas.Deudores, 0, total))
	concepto := "Recibo " + r.Numero + " · " + r.Cliente
	if r.Anulacion {
		renglones = invertir(renglones)
		concepto = "Anulación del recibo " + r.Numero + " · " + r.Cliente
	}
	return asiento(r.Fecha, concepto, renglones)
}

// CompraAAsentar es CompraAAsentar.
type CompraAAsentar struct {
	Fecha                            time.Time
	Comprobante, Proveedor           string
	Neto, Iva, Percepciones, Total   float64
	DaCreditoFiscal, EsNotaDeCredito bool
	// Exento: lo exento y no gravado de la factura, al costo sin IVA. Antes
	// no se asentaba y el asiento no cerraba (Proveedores lleva el total).
	Exento float64
	// PercepcionIva y PercepcionIibb son la parte de Percepciones de cada
	// impuesto; lo que quede sin impuesto va a Retenciones sufridas.
	PercepcionIva, PercepcionIibb float64
}

// AsientoDeCompra es asientoDeCompra.
func AsientoDeCompra(c CompraAAsentar) Asiento {
	r := []RenglonDeAsiento{}
	if c.DaCreditoFiscal {
		r = append(r, renglon(Cuentas.Mercaderias, c.Neto+c.Exento, 0))
		if c.Iva != 0 {
			r = append(r, renglon(Cuentas.IvaCredito, c.Iva, 0))
		}
	} else {
		r = append(r, renglon(Cuentas.Mercaderias, float64(c.Neto+c.Iva)+c.Exento, 0))
	}
	if c.Percepciones != 0 {
		otras := redondear(float64(c.Percepciones-c.PercepcionIva) - c.PercepcionIibb)
		if c.PercepcionIva != 0 {
			r = append(r, renglon(Cuentas.PercSufridaIva, c.PercepcionIva, 0))
		}
		if c.PercepcionIibb != 0 {
			r = append(r, renglon(Cuentas.PercSufridaIibb, c.PercepcionIibb, 0))
		}
		if otras != 0 {
			r = append(r, renglon(Cuentas.RetencionesSufridas, otras, 0))
		}
	}
	r = append(r, renglon(Cuentas.Proveedores, 0, c.Total))
	if c.EsNotaDeCredito {
		r = invertir(r)
	}
	return asiento(c.Fecha, c.Comprobante+" · "+c.Proveedor, r)
}

// PagoAAsentar es PagoAAsentar.
type PagoAAsentar struct {
	Fecha            time.Time
	Proveedor, Medio string
	Referencia       *string
	Total, Retenido  float64
	// Salidas son con qué salió la plata, parte por parte (cada una con su
	// cuenta: SalidaDePago). Sin partes, todo por el medio del pago.
	Salidas []SalidaDePago
	// RetenidoPorImpuesto es lo retenido de cada impuesto; lo que falte
	// para Retenido va a Retenciones a depositar.
	RetenidoPorImpuesto map[string]float64
}

// SalidaDePago es una parte de un pago a un proveedor con su cuenta.
type SalidaDePago struct {
	Cuenta  string
	Importe float64
}

// CuentaDeSalida es adónde va una parte del pago: el efectivo a Caja, el
// cheque de la cartera que se endosa a Valores a depositar (sale de ahí, no
// del banco), el cheque propio con fecha posterior al pago a Cheques
// diferidos (el banco lo debita después) y lo demás a Banco.
func CuentaDeSalida(medio string, sentidoCheque *string, diferido bool) string {
	switch {
	case medio == "efectivo":
		return Cuentas.Caja
	case sentidoCheque != nil && *sentidoCheque == "recibido":
		return Cuentas.ValoresADepositar
	case sentidoCheque != nil && *sentidoCheque == "entregado" && diferido:
		return Cuentas.ChequesDiferidos
	}
	return Cuentas.Banco
}

// ChequeDiferido dice si el cheque propio vence después del día del pago,
// los dos en fecha argentina: el del mismo día es como una transferencia.
func ChequeDiferido(fechaDelCheque, fechaDelPago time.Time) bool {
	return fechaDelCheque.In(Argentina).Format("2006-01-02") > fechaDelPago.In(Argentina).Format("2006-01-02")
}

// AsientoDePagoAProveedor es asientoDePagoAProveedor.
func AsientoDePagoAProveedor(p PagoAAsentar) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.Proveedores, p.Total, 0)}
	if len(p.Salidas) > 0 {
		for _, x := range p.Salidas {
			r = append(r, renglon(x.Cuenta, 0, x.Importe))
		}
	} else {
		r = append(r, renglon(cuentaDeMedio(p.Medio), 0, p.Total-p.Retenido))
	}
	if p.Retenido > 0 {
		resto := p.Retenido
		for _, imp := range []string{"ganancias", "iva", "iibb", "suss"} {
			if x := p.RetenidoPorImpuesto[imp]; x > 0 {
				r = append(r, renglon(CuentaDeRetencionADepositar(imp), 0, x))
				resto = redondear(resto - x)
			}
		}
		if resto > toleranciaAsiento {
			r = append(r, renglon(Cuentas.RetencionesAPagar, 0, resto))
		}
	}
	concepto := "Pago a " + p.Proveedor
	if p.Referencia != nil && *p.Referencia != "" {
		concepto += " · " + *p.Referencia
	}
	return asiento(p.Fecha, concepto, r)
}

// AsientosDePagoAProveedor son los del pago en su circuito. El pago del
// circuito B con retenciones se parte (comité final, M9): la retención emite
// un certificado con el CUIT de la empresa y es una deuda con el fisco que
// se declara y se deposita, así que va siempre al archivo del estudio
// (Proveedores contra Retenciones a depositar); lo que salió de verdad, al
// del B. Entero en el B, el estudio no veía el pasivo que tenía que
// depositar.
func AsientosDePagoAProveedor(p PagoAAsentar, circuito string) []Asiento {
	if circuito != CircuitoNegro {
		return []Asiento{AsientoDePagoAProveedor(p)}
	}
	if !(p.Retenido > toleranciaAsiento) {
		a := AsientoDePagoAProveedor(p)
		a.Circuito = CircuitoNegro
		return []Asiento{a}
	}
	salio := p
	salio.Total, salio.Retenido, salio.RetenidoPorImpuesto = redondear(p.Total-p.Retenido), 0, nil
	b := AsientoDePagoAProveedor(salio)
	b.Circuito = CircuitoNegro
	r := []RenglonDeAsiento{renglon(Cuentas.Proveedores, p.Retenido, 0)}
	resto := p.Retenido
	for _, imp := range []string{"ganancias", "iva", "iibb", "suss"} {
		if x := p.RetenidoPorImpuesto[imp]; x > 0 {
			r = append(r, renglon(CuentaDeRetencionADepositar(imp), 0, x))
			resto = redondear(resto - x)
		}
	}
	if resto > toleranciaAsiento {
		r = append(r, renglon(Cuentas.RetencionesAPagar, 0, resto))
	}
	blanco := asiento(p.Fecha, "Retención del pago a "+p.Proveedor, r)
	if p.Referencia != nil && *p.Referencia != "" {
		blanco.Concepto += " · " + *p.Referencia
	}
	return []Asiento{b, blanco}
}

// ChequeAAsentar es un cambio de estado de un cheque (cheque_estados).
type ChequeAAsentar struct {
	Fecha                 time.Time
	Numero, Banco         string
	Sentido, Desde, Hacia string
	Importe               float64
	// Diferido: el cheque propio se asentó en Cheques diferidos al pagar.
	Diferido bool
	// ADeudores: el rechazo le devolvió la deuda al cliente (la nota de
	// débito del cheque), así que vuelve a Deudores.
	ADeudores bool
	Circuito  string
	// DelMostradorEnB: el cheque cobró una venta del mostrador que quedó en
	// el circuito B (sin factura con CAE). Esa venta no tiene asiento de
	// cobro en ningún archivo, así que su rechazo no tiene contra qué ir: en
	// el B dejaba Deudores contra Valores a depositar sin ingreso previo, y
	// el reemplazo iba al archivo del estudio (simulación del mes, H419).
	// La deuda nueva vive en la cuenta corriente (la nota de débito) y su
	// cobro se reparte como cualquier recibo.
	DelMostradorEnB bool
}

// LeyendaDelCheque es lo que el asiento dice que le pasó al cheque: el
// recibido que vuelve de la cartera se le devolvió al cliente (el banco nunca
// lo tuvo), y el asiento decía «rechazado» (mes 23).
func LeyendaDelCheque(c ChequeAAsentar) string {
	if c.Sentido == "recibido" && c.Hacia == "rechazado" && c.Desde == "cartera" {
		return "devuelto al cliente"
	}
	return c.Hacia
}

// AsientoDeCheque es el asiento de un cambio de estado de un cheque, cada uno
// en su circuito, y false si ese cambio no mueve cuentas:
//
//   - recibido y acreditado: del depósito al banco (Banco / Valores a
//     depositar);
//   - recibido y rechazado: vuelve a Deudores, si la deuda volvió a la
//     cuenta, contra Valores a depositar o, si estaba endosado, contra
//     Proveedores (le volvemos a deber: la deuda se reabre en su libro);
//   - propio y acreditado: si estaba diferido, el banco lo debita (Cheques
//     diferidos / Banco);
//   - propio y rechazado: le volvemos a deber al proveedor, contra donde se
//     asentó al pagar (Cheques diferidos o Banco).
//
// Lo anulado no se asienta: la anulación del recibo, de la venta o del pago
// ya revierte su asiento entero.
func AsientoDeCheque(c ChequeAAsentar) (Asiento, bool) {
	nombre := "Cheque N° " + c.Numero
	if c.Banco != "" {
		nombre += " · " + c.Banco
	}
	var r []RenglonDeAsiento
	switch {
	case c.Sentido == "recibido" && c.Hacia == "acreditado" && c.Desde == "depositado":
		r = []RenglonDeAsiento{renglon(Cuentas.Banco, c.Importe, 0), renglon(Cuentas.ValoresADepositar, 0, c.Importe)}
	case c.Sentido == "recibido" && c.Hacia == "rechazado" && c.Desde == "entregado":
		debe := Cuentas.ValoresADepositar
		if c.ADeudores {
			debe = Cuentas.Deudores
		}
		r = []RenglonDeAsiento{renglon(debe, c.Importe, 0), renglon(Cuentas.Proveedores, 0, c.Importe)}
	case c.Sentido == "recibido" && c.Hacia == "rechazado" && (c.Desde == "cartera" || c.Desde == "depositado") && c.ADeudores:
		// El de una venta B del mostrador da vuelta su cobro en el B (Valores a
		// depositar contra Ventas sin factura): la deuda vuelve a la cuenta
		// con la nota de débito y su cobro se reparte como cualquier recibo.
		debe := Cuentas.Deudores
		if c.DelMostradorEnB && c.Circuito == CircuitoNegro {
			debe = Cuentas.VentasSinFactura
		}
		r = []RenglonDeAsiento{renglon(debe, c.Importe, 0), renglon(Cuentas.ValoresADepositar, 0, c.Importe)}
	case c.Sentido == "entregado" && c.Hacia == "acreditado" && c.Diferido:
		r = []RenglonDeAsiento{renglon(Cuentas.ChequesDiferidos, c.Importe, 0), renglon(Cuentas.Banco, 0, c.Importe)}
	case c.Sentido == "entregado" && c.Hacia == "rechazado":
		debe := Cuentas.Banco
		if c.Diferido {
			debe = Cuentas.ChequesDiferidos
		}
		r = []RenglonDeAsiento{renglon(debe, c.Importe, 0), renglon(Cuentas.Proveedores, 0, c.Importe)}
	default:
		return Asiento{}, false
	}
	a := asiento(c.Fecha, nombre+" "+LeyendaDelCheque(c), r)
	a.Instante = true
	if c.Circuito == CircuitoNegro {
		a.Circuito = CircuitoNegro
	}
	return a, true
}

// GastoAAsentar es GastoAAsentar.
type GastoAAsentar struct {
	Fecha                         time.Time
	Descripcion, Categoria, Medio string
	Importe                       float64
	// Iva y Percepciones, del gasto con factura que da crédito fiscal (mes
	// simulado, H200): el gasto va por el neto y el IVA al crédito fiscal.
	Iva, Percepciones float64
}

// AsientoDeGasto es asientoDeGasto: cada categoría a su cuenta, lo demás a
// gastos varios.
func AsientoDeGasto(g GastoAAsentar) Asiento {
	cuenta, ok := CuentaPorCategoria[g.Categoria]
	if !ok {
		cuenta = Cuentas.Gastos
	}
	concepto := ConceptoDeGasto(g.Categoria, g.Descripcion)
	if g.Iva == 0 && g.Percepciones == 0 {
		return asiento(g.Fecha, concepto, []RenglonDeAsiento{
			renglon(cuenta, g.Importe, 0), renglon(cuentaDeMedio(g.Medio), 0, g.Importe)})
	}
	r := []RenglonDeAsiento{renglon(cuenta, redondear(float64(g.Importe-g.Iva)-g.Percepciones), 0)}
	if g.Iva != 0 {
		r = append(r, renglon(Cuentas.IvaCredito, g.Iva, 0))
	}
	if g.Percepciones != 0 {
		r = append(r, renglon(Cuentas.RetencionesSufridas, g.Percepciones, 0))
	}
	return asiento(g.Fecha, concepto, append(r, renglon(cuentaDeMedio(g.Medio), 0, g.Importe)))
}

// ConceptoDeGasto es «Fletes · Flete a Mar del Plata»: la categoría con el
// nombre de su cuenta, no la clave («flete · …»; mes simulado, M2S1-126).
func ConceptoDeGasto(categoria, descripcion string) string {
	nombre := categoria
	if c, ok := CuentaPorCategoria[categoria]; ok {
		nombre = nombresDeCuenta[c]
	} else if categoria == "" || categoria == "otros" || categoria == "varios" {
		nombre = nombresDeCuenta[Cuentas.Gastos]
	} else if categoria != "" {
		nombre = strings.ToUpper(categoria[:1]) + categoria[1:]
	}
	return nombre + " · " + descripcion
}

// NombreComprobante es nombreComprobante de lib/fiscal/comprobantes.ts.
func NombreComprobante(tipo string) string {
	letra := ""
	if tipo != "" {
		letra = strings.ToUpper(tipo[len(tipo)-1:])
	}
	switch {
	case strings.HasPrefix(tipo, "nota_credito"):
		return "Nota de crédito " + letra
	case strings.HasPrefix(tipo, "nota_debito"):
		return "Nota de débito " + letra
	}
	return "Factura " + letra
}

// NumeroFormateado es numeroFormateado: «0003-00000127».
func NumeroFormateado(puntoVenta, numero int64) string {
	return fmt.Sprintf("%04d-%08d", puntoVenta, numero)
}

// fechaCsv es la fecha del asiento en el CSV: un instante en hora argentina
// (una factura del 31 a las 22 es del 31, y ARCA la autorizó con esa fecha),
// un día tal como se guardó (a las 0 UTC).
func fechaCsv(a Asiento) string {
	t := diaDelAsiento(a)
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
}

// diaDelAsiento es el día con el que el asiento va al CSV (fechaCsv).
func diaDelAsiento(a Asiento) time.Time {
	if a.Instante {
		return a.Fecha.In(Argentina)
	}
	return a.Fecha.UTC()
}

// OrdenarAsientos los deja en el orden del libro diario: por el día con el
// que salen en el CSV y, dentro del día, por el momento. Ordenados por el
// instante, la factura de compra del 27 (a las 0 UTC, el 26 a las 21 en hora
// argentina) quedaba entre los asientos del 26 y el diario salía 26, 27, 26,
// 27 (mes simulado, M3S1-009). Los días sin hora van primero en su día.
func OrdenarAsientos(asientos []Asiento) {
	sort.SliceStable(asientos, func(i, j int) bool {
		di, dj := diaDelAsiento(asientos[i]), diaDelAsiento(asientos[j])
		ki, kj := di.Year()*10000+int(di.Month())*100+di.Day(), dj.Year()*10000+int(dj.Month())*100+dj.Day()
		if ki != kj {
			return ki < kj
		}
		if asientos[i].Instante != asientos[j].Instante {
			return !asientos[i].Instante
		}
		return asientos[i].Fecha.Before(asientos[j].Fecha)
	})
}

// CsvAsientos es app/admin/cierre/exportar: un renglón por línea con el
// número de asiento repetido, y los totales.
//
// La fecha de los días (los gastos y las facturas de compra, a las 0 UTC) va
// en UTC: en hora argentina saldrían un día antes. La de los instantes (las
// ventas, los cobros, los pagos), en hora argentina: en UTC, una factura del
// 31 a las 22 salía del 1 (ver fechaCsv).
//
// Uno por circuito: el del estudio lleva solo el blanco, y el del circuito B
// (`circuito` = "negro") es otro archivo, con su propia numeración.
func CsvAsientos(todos []Asiento, circuito string) string {
	asientos := DelCircuito(todos, circuito)
	filas := [][]string{}
	var totalDebe, totalHaber float64
	for i, a := range asientos {
		numero := fmt.Sprintf("%05d", i+1)
		obs := ""
		if !Balancea(a.Renglones) {
			obs = "NO CIERRA"
		}
		for _, r := range a.Renglones {
			totalDebe = float64(totalDebe + r.Debe)
			totalHaber = float64(totalHaber + r.Haber)
			debe, haber := "", ""
			if r.Debe != 0 {
				debe = csvexcel.NumeroCsv(r.Debe, 2)
			}
			if r.Haber != 0 {
				haber = csvexcel.NumeroCsv(r.Haber, 2)
			}
			filas = append(filas, []string{csvexcel.Texto(numero), fechaCsv(a), csvexcel.Texto(a.Concepto),
				csvexcel.Texto(r.Cuenta), csvexcel.Texto(r.Nombre), debe, haber, csvexcel.Texto(obs)})
		}
	}
	cierra := ""
	if !(math.Abs(totalDebe-totalHaber) < 0.01) {
		cierra = "EL PERÍODO NO CIERRA"
	}
	return csvexcel.ArmarCsv([]string{"Asiento", "Fecha", "Concepto", "Cuenta", "Nombre de cuenta", "Debe", "Haber", "Observación"},
		filas, []string{csvexcel.Texto("Totales"), "", "", "", "", csvexcel.NumeroCsv(totalDebe, 2), csvexcel.NumeroCsv(totalHaber, 2), csvexcel.Texto(cierra)})
}

// SaldoDeCuenta es debe menos haber de la cuenta en los asientos.
func SaldoDeCuenta(asientos []Asiento, cuenta string) float64 {
	neto := 0.0
	for _, a := range asientos {
		for _, r := range a.Renglones {
			if r.Cuenta == cuenta {
				neto = float64(neto + float64(r.Debe-r.Haber))
			}
		}
	}
	return redondear(neto)
}

// DelCircuito son los asientos de un circuito ("" es el blanco).
func DelCircuito(asientos []Asiento, circuito string) []Asiento {
	if circuito == "" {
		circuito = "blanco"
	}
	out := []Asiento{}
	for _, a := range asientos {
		if a.circuito() == circuito {
			out = append(out, a)
		}
	}
	return out
}

// AsientoDeCosto es el costo de lo vendido de un hecho de venta: Costo de
// mercaderías vendidas contra Mercaderías (H160). La devolución y la
// cancelación de una venta ya contada, con el costo en negativo, lo
// devuelven al stock.
func AsientoDeCosto(fecha time.Time, concepto string, costo float64) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.CostoDeVentas, costo, 0), renglon(Cuentas.Mercaderias, 0, costo)}
	if costo < 0 {
		r = []RenglonDeAsiento{renglon(Cuentas.Mercaderias, -costo, 0), renglon(Cuentas.CostoDeVentas, 0, -costo)}
	}
	return asiento(fecha, "Costo de lo vendido · "+concepto, r)
}

// AsientoDeInventario es una baja (importe negativo) o un alta de
// mercadería sin venta, al costo congelado en el movimiento: la baja va al
// debe de `cuenta` y sale de Mercaderías; el alta, al revés (M3S3-013).
func AsientoDeInventario(fecha time.Time, concepto, cuenta string, importe float64) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.Mercaderias, importe, 0), renglon(cuenta, 0, importe)}
	if importe < 0 {
		r = []RenglonDeAsiento{renglon(cuenta, -importe, 0), renglon(Cuentas.Mercaderias, 0, -importe)}
	}
	return asiento(fecha, concepto, r)
}

// AsientoDeDiferenciaDeCaja es el faltante (negativo) o el sobrante del
// arqueo de un turno contra Diferencias de caja.
func AsientoDeDiferenciaDeCaja(fecha time.Time, concepto string, diferencia float64) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.Caja, diferencia, 0), renglon(Cuentas.DiferenciasDeCaja, 0, diferencia)}
	if diferencia < 0 {
		r = []RenglonDeAsiento{renglon(Cuentas.DiferenciasDeCaja, -diferencia, 0), renglon(Cuentas.Caja, 0, -diferencia)}
	}
	return asiento(fecha, concepto, r)
}

// TramoDeCobro es una devolución de un cobro sin recibo: un tramo, o lo que
// quedaba al reintegrarse entero.
type TramoDeCobro struct {
	Fecha   time.Time
	Importe float64
	// Devolucion: lo devolvió una devolución de la venta (lo del cheque vuelve
	// por el banco); Entero: el reintegro de todo lo que quedaba, que lleva la
	// comisión si no hubo tramos antes.
	Devolucion, Entero bool
	// Rechazo: el cheque del cobro rebotó (y la deuda volvió a la cuenta con
	// la nota de débito). Sale de Valores a depositar, no del banco.
	Rechazo bool
}

// CobroAntesDeLaFactura es el cobro sin recibo de un pedido que, el día que
// se cobró, no tenía factura con CAE, y que no espera el CAE para asentarse:
// va contra `Contra` (Ventas sin factura en el circuito B, Anticipos de
// clientes o Cobros a imputar) y, si después sale la factura con CAE, se le
// imputa ese día por lo que no se devolvió antes.
//
// Pase: el cobro que quedó en el B y cuyo pedido se facturó después pasa al
// archivo del estudio el día que se emite la factura, contra ContraDelPase
// (Anticipos de clientes, o Cobros a imputar con «asiento_sin_cae» en
// «transitoria»), y de ahí se imputa a Deudores cuando llega el CAE (mes
// simulado, M2S2-006): antes quedaba en el B como venta sin factura hasta el
// CAE, con la factura ya emitida, y el cobro de la conciliación y el del
// recibo iban por dos caminos distintos.
type CobroAntesDeLaFactura struct {
	CobroAAsentar
	Contra, Circuito string
	// Factura: la fecha de la factura con CAE del pedido, si ya salió, y su
	// nombre («Factura B 0003-00000201 (pedido M-0001)») para la imputación.
	Factura       *time.Time
	DeLaFactura   string
	Tramos        []TramoDeCobro
	Pase          *time.Time
	ContraDelPase string
}

// AsientosDelCobroAntesDeLaFactura son los del cobro, sus devoluciones, el
// pase al archivo del estudio y la imputación a la factura, cada uno en su
// fecha (H160): ninguno cambia un mes ya cerrado cuando la factura sale más
// tarde.
func AsientosDelCobroAntesDeLaFactura(c CobroAntesDeLaFactura) []Asiento {
	var out []Asiento
	enCircuito := func(a Asiento, circuito string) Asiento {
		a.Circuito, a.Instante = circuito, true
		return a
	}
	out = append(out, enCircuito(asiento(c.Fecha, "Cobro "+c.Comprobante+" · "+c.Cliente,
		append(renglonesDeEntrada(cuentaDeCobro(c.Medio), c.Importe, c.Comision), renglon(c.Contra, 0, c.Importe))), c.Circuito))
	pase := c.Pase
	// La factura que sale con CAE en el acto no pasa por Anticipos: el cobro
	// entra directo contra Deudores, como siempre.
	if pase != nil && (c.Circuito != CircuitoNegro || c.ContraDelPase == "" || (c.Factura != nil && !pase.Before(*c.Factura))) {
		pase = nil
	}
	// Dónde está el cobro en cada momento: contra qué cuenta y en qué archivo.
	contraEn := func(t time.Time) (string, string) {
		if pase != nil && !t.Before(*pase) {
			return c.ContraDelPase, ""
		}
		return c.Contra, c.Circuito
	}
	devueltoAntes, devueltoAntesDelPase := 0.0, 0.0
	huboTramos := false
	for _, t := range c.Tramos {
		medio := c.Medio
		if t.Devolucion && (medio == "cheque" || medio == "echeq") {
			medio = "transferencia"
		}
		comision := 0.0
		if t.Entero && !huboTramos {
			comision = c.Comision
		}
		huboTramos = huboTramos || !t.Entero
		concepto := "Reintegro "
		if !t.Entero {
			concepto = "Reintegro parcial "
		}
		if t.Rechazo {
			medio, concepto = c.Medio, "Cheque rechazado · cobro "
		}
		concepto += c.Comprobante + " · " + c.Cliente
		if c.Factura == nil || t.Fecha.Before(*c.Factura) {
			devueltoAntes = float64(devueltoAntes + t.Importe)
			if pase == nil || t.Fecha.Before(*pase) {
				devueltoAntesDelPase = float64(devueltoAntesDelPase + t.Importe)
			}
			contra, circuito := contraEn(t.Fecha)
			out = append(out, enCircuito(asiento(t.Fecha, concepto, append([]RenglonDeAsiento{renglon(contra, t.Importe, 0)},
				invertir(renglonesDeEntrada(cuentaDeCobro(medio), t.Importe, comision))...)), circuito))
			continue
		}
		// Después de la factura es el reintegro de siempre, contra Deudores y
		// con el nombre de la factura.
		r := c.CobroAAsentar
		r.Fecha, r.Importe, r.Medio, r.Comision, r.Comprobante = t.Fecha, t.Importe, medio, comision, c.DeLaFactura
		if !t.Entero {
			r.Comprobante = "parcial " + c.DeLaFactura
		}
		a := AsientoDeReintegro(r)
		a.Instante = true
		out = append(out, a)
	}
	if pase != nil {
		neto := jsmath.Redondear2(c.Importe - devueltoAntesDelPase)
		if neto > toleranciaAsiento {
			comision := 0.0
			if devueltoAntesDelPase == 0 {
				comision = c.Comision
			}
			donde := c.DeLaFactura
			if donde == "" {
				donde = "la factura del pedido"
			}
			out = append(out,
				enCircuito(asiento(*pase, "Pasa al archivo del estudio · "+c.Comprobante+" · "+c.Cliente,
					append([]RenglonDeAsiento{renglon(c.Contra, neto, 0)}, invertir(renglonesDeEntrada(cuentaDeCobro(c.Medio), neto, comision))...)), CircuitoNegro),
				enCircuito(asiento(*pase, "Cobro "+c.Comprobante+" · "+c.Cliente+" · facturado",
					append(renglonesDeEntrada(cuentaDeCobro(c.Medio), neto, comision), renglon(c.ContraDelPase, 0, neto))), ""))
		}
	}
	if c.Factura == nil {
		return out
	}
	neto := jsmath.Redondear2(c.Importe - devueltoAntes)
	if neto <= toleranciaAsiento {
		return out
	}
	concepto := "Imputa cobro " + c.DeLaFactura + " · " + c.Cliente
	if contra, circuito := contraEn(*c.Factura); circuito != CircuitoNegro {
		return append(out, enCircuito(asiento(*c.Factura, concepto,
			[]RenglonDeAsiento{renglon(contra, neto, 0), renglon(Cuentas.Deudores, 0, neto)}), ""))
	}
	// Del B al archivo del estudio: sale del B como se había asentado y entra
	// al blanco contra la factura.
	comision := 0.0
	if devueltoAntes == 0 {
		comision = c.Comision
	}
	out = append(out, enCircuito(asiento(*c.Factura, "Pasa al archivo del estudio · "+c.DeLaFactura+" · "+c.Cliente,
		append([]RenglonDeAsiento{renglon(c.Contra, neto, 0)}, invertir(renglonesDeEntrada(cuentaDeCobro(c.Medio), neto, comision))...)), CircuitoNegro))
	// En el archivo del estudio es el cobro de la factura de siempre.
	return append(out, enCircuito(asiento(*c.Factura, "Cobro "+c.DeLaFactura+" · "+c.Cliente,
		append(renglonesDeEntrada(cuentaDeCobro(c.Medio), neto, comision), renglon(Cuentas.Deudores, 0, neto))), ""))
}

// AsientosDePase son los de lo que un recibo había mandado al B y pasa a
// Anticipos de clientes el día que se factura su pedido (cobros.Pase): sale
// del B como se había asentado, por las partes que siguen en el orden del
// reparto (BlancoDeCadaParte), y entra al archivo del estudio contra
// Anticipos, de donde se aplica a la factura cuando llega el CAE.
func AsientosDePase(p cobros.Pase, numero, cliente, factura string) []Asiento {
	despues := redondear(p.BlancoAntes + p.Importe)
	if p.AlB {
		despues = redondear(p.BlancoAntes - p.Importe)
	}
	antes := cobros.BlancoDeCadaParte(p.Partes, p.BlancoAntes)
	luego := cobros.BlancoDeCadaParte(p.Partes, despues)
	var mueve []RenglonDeAsiento
	for i, x := range p.Partes {
		if pasa := redondear(luego[i] - antes[i]); pasa > toleranciaAsiento || pasa < -toleranciaAsiento {
			mueve = append(mueve, renglon(cuentaDeCobro(x.Medio), math.Abs(pasa), 0))
		}
	}
	if len(mueve) == 0 {
		return nil
	}
	if p.AlB {
		// La vuelta: sale de Anticipos del estudio y entra al B como venta sin
		// factura del pedido entregado.
		a := asiento(p.Fecha, "Recibo "+numero+" · "+p.Nombre+" entregado sin factura · "+cliente,
			append([]RenglonDeAsiento{renglon(Cuentas.AnticiposDeClientes, p.Importe, 0)}, invertir(mueve)...))
		a.Instante = true
		b := asiento(p.Fecha, "Recibo "+numero+" · "+p.Nombre+" entregado sin factura · "+cliente,
			append(mueve, renglon(Cuentas.VentasSinFactura, 0, p.Importe)))
		b.Circuito, b.Instante = CircuitoNegro, true
		return []Asiento{a, b}
	}
	b := asiento(p.Fecha, "Pasa al archivo del estudio · recibo "+numero+" · "+factura+" · "+cliente,
		append([]RenglonDeAsiento{renglon(Cuentas.VentasSinFactura, p.Importe, 0)}, invertir(mueve)...))
	b.Circuito, b.Instante = CircuitoNegro, true
	a := asiento(p.Fecha, "Recibo "+numero+" · "+factura+" · "+cliente, append(mueve, renglon(Cuentas.AnticiposDeClientes, 0, p.Importe)))
	a.Instante = true
	return []Asiento{b, a}
}

// AsientosDeChequeDeRecibo son la acreditación o el rechazo de un cheque
// cobrado con un recibo, en cada archivo por lo que entró en cada uno:
// `blanco` al del estudio (y del rechazo, `rechazo` dice cuánto sale de
// Anticipos y cuánto de Deudores) y el resto al B, donde el rechazo da
// vuelta la venta sin factura que había cobrado.
func AsientosDeChequeDeRecibo(c ChequeAAsentar, blanco float64, rechazo cobros.Reparto) []Asiento {
	nombre := "Cheque N° " + c.Numero
	if c.Banco != "" {
		nombre += " · " + c.Banco
	}
	blanco = redondear(min(max(blanco, 0), c.Importe))
	enB := redondear(c.Importe - blanco)
	var out []Asiento
	agregar := func(r []RenglonDeAsiento, circuito string) {
		a := asiento(c.Fecha, nombre+" "+LeyendaDelCheque(c), r)
		a.Instante, a.Circuito = true, circuito
		out = append(out, a)
	}
	if c.Hacia == "acreditado" {
		if blanco > toleranciaAsiento {
			agregar([]RenglonDeAsiento{renglon(Cuentas.Banco, blanco, 0), renglon(Cuentas.ValoresADepositar, 0, blanco)}, "")
		}
		if enB > toleranciaAsiento {
			agregar([]RenglonDeAsiento{renglon(Cuentas.Banco, enB, 0), renglon(Cuentas.ValoresADepositar, 0, enB)}, CircuitoNegro)
		}
		return out
	}
	if !c.ADeudores {
		return nil
	}
	if blanco > toleranciaAsiento {
		var r []RenglonDeAsiento
		anticipo := redondear(min(rechazo.Anticipo, blanco))
		if anticipo > toleranciaAsiento {
			r = append(r, renglon(Cuentas.AnticiposDeClientes, anticipo, 0))
		}
		if d := redondear(blanco - anticipo); d > toleranciaAsiento {
			r = append(r, renglon(Cuentas.Deudores, d, 0))
		}
		agregar(append(r, renglon(Cuentas.ValoresADepositar, 0, blanco)), "")
	}
	if enB > toleranciaAsiento {
		agregar([]RenglonDeAsiento{renglon(Cuentas.VentasSinFactura, enB, 0), renglon(Cuentas.ValoresADepositar, 0, enB)}, CircuitoNegro)
	}
	return out
}

// ConPase es el reparto de un recibo con lo que pasó del B al archivo del
// estudio (o volvió, en negativo) desde que se emitió (cobros.Pase): lo que
// pasó está en Anticipos.
func ConPase(rep cobros.Reparto, pasado float64) cobros.Reparto {
	if pasado > toleranciaAsiento || pasado < -toleranciaAsiento {
		rep.Anticipo, rep.B = redondear(rep.Anticipo+pasado), redondear(rep.B-pasado)
	}
	return rep
}

// AsientoDeLiquidacion es lo que liquida la tarjeta: entra al Banco el neto,
// la comisión a su cuenta, contra Tarjetas a acreditar por el bruto.
func AsientoDeLiquidacion(fecha time.Time, referencia string, bruto, comision float64) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.Banco, redondear(bruto-comision), 0)}
	if comision > toleranciaAsiento {
		r = append(r, renglon(Cuentas.Comisiones, comision, 0))
	}
	concepto := "Liquidación de tarjetas"
	if referencia != "" {
		concepto += " · " + referencia
	}
	a := asiento(fecha, concepto, append(r, renglon(Cuentas.TarjetasAAcreditar, 0, bruto)))
	a.Instante = true
	return a
}

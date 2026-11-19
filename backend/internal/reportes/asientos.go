package reportes

import (
	"fmt"
	"math"
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
var Cuentas = struct {
	Caja, Banco, Deudores, IvaCredito, RetencionesSufridas, Mercaderias         string
	Proveedores, IvaDebito, PercepcionesIibb, RetencionesAPagar, Ventas, Gastos string
	ValoresADepositar                                                           string
	// AnticiposDeClientes: lo cobrado antes de la factura (cobros.Reparto).
	AnticiposDeClientes string
	// VentasSinFactura: solo en el CSV del circuito B, contra lo que cobra.
	VentasSinFactura string
}{"1.1.01", "1.1.02", "1.1.03", "1.1.05", "1.1.06", "1.2.01", "2.1.01", "2.1.03", "2.1.04", "2.1.05", "4.1.01", "5.1.01", "1.1.04",
	"2.1.06", "4.1.02"}

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
	"5.1.01": "Gastos varios", "5.1.02": "Fletes", "5.1.03": "Combustible", "5.1.04": "Servicios", "5.1.05": "Alquileres",
	"5.1.06": "Sueldos y cargas", "5.1.07": "Mantenimiento", "5.1.08": "Impuestos y tasas", "5.1.09": "Librería y oficina",
	"5.1.10": "Publicidad",
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
	}
	return cuentaDeMedio(medio)
}

// AsientoDeCobro es asientoDeCobro. Pasar una factura a cuenta corriente no
// es un cobro (no entra plata: la deuda sigue en Deudores), así que no se
// asienta: AsientosDelPeriodo la saltea.
func AsientoDeCobro(c CobroAAsentar) Asiento {
	return asiento(c.Fecha, "Cobro "+c.Comprobante+" · "+c.Cliente, []RenglonDeAsiento{
		renglon(cuentaDeCobro(c.Medio), c.Importe, 0), renglon(Cuentas.Deudores, 0, c.Importe)})
}

// AsientoDeReintegro es el cobro al revés: la plata vuelve al cliente (o
// el cheque se anula con la venta) y la deuda vuelve a Deudores.
func AsientoDeReintegro(c CobroAAsentar) Asiento {
	return asiento(c.Fecha, "Reintegro "+c.Comprobante+" · "+c.Cliente, []RenglonDeAsiento{
		renglon(Cuentas.Deudores, c.Importe, 0), renglon(cuentaDeCobro(c.Medio), 0, c.Importe)})
}

// ParteDeRecibo es con qué se pagó una parte del recibo.
type ParteDeRecibo struct {
	Medio   string
	Importe float64
	// Negro: un cheque marcado del circuito B. Va entero al B.
	Negro bool
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
	// Retenciones, después lo bancarizado, después el efectivo, y los
	// cheques del B solo si lo blanco no se completó de otra forma.
	for _, orden := range []func(ParteDeRecibo) bool{
		func(p ParteDeRecibo) bool { return p.Medio == "retencion" },
		func(p ParteDeRecibo) bool { return p.Bancarizado() },
		func(p ParteDeRecibo) bool { return p.Medio == "efectivo" && !p.Negro },
		func(p ParteDeRecibo) bool { return p.Negro },
	} {
		for i, p := range partes {
			if orden(p) && asignado[i] == 0 {
				tomar(i)
			}
		}
	}
	for i, p := range partes {
		if bl := asignado[i]; bl > toleranciaAsiento {
			blanco = append(blanco, ParteDeRecibo{Medio: p.Medio, Importe: bl, Negro: p.Negro})
		}
		if resto := redondear(p.Importe - asignado[i]); resto > toleranciaAsiento {
			b = append(b, ParteDeRecibo{Medio: p.Medio, Importe: resto, Negro: p.Negro})
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
			renglones = append(renglones, renglon(cuentaDeCobro(p.Medio), p.Importe, 0))
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
			renglones = append(renglones, renglon(cuentaDeCobro(p.Medio), p.Importe, 0))
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
		renglones = append(renglones, renglon(cuentaDeCobro(p.Medio), p.Importe, 0))
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
		r = append(r, renglon(Cuentas.RetencionesSufridas, c.Percepciones, 0))
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
}

// AsientoDePagoAProveedor es asientoDePagoAProveedor.
func AsientoDePagoAProveedor(p PagoAAsentar) Asiento {
	r := []RenglonDeAsiento{renglon(Cuentas.Proveedores, p.Total, 0), renglon(cuentaDeMedio(p.Medio), 0, p.Total-p.Retenido)}
	if p.Retenido > 0 {
		r = append(r, renglon(Cuentas.RetencionesAPagar, 0, p.Retenido))
	}
	concepto := "Pago a " + p.Proveedor
	if p.Referencia != nil && *p.Referencia != "" {
		concepto += " · " + *p.Referencia
	}
	return asiento(p.Fecha, concepto, r)
}

// GastoAAsentar es GastoAAsentar.
type GastoAAsentar struct {
	Fecha                         time.Time
	Descripcion, Categoria, Medio string
	Importe                       float64
}

// AsientoDeGasto es asientoDeGasto: cada categoría a su cuenta, lo demás a
// gastos varios.
func AsientoDeGasto(g GastoAAsentar) Asiento {
	cuenta, ok := CuentaPorCategoria[g.Categoria]
	if !ok {
		cuenta = Cuentas.Gastos
	}
	return asiento(g.Fecha, g.Categoria+" · "+g.Descripcion, []RenglonDeAsiento{
		renglon(cuenta, g.Importe, 0), renglon(cuentaDeMedio(g.Medio), 0, g.Importe)})
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
	t := a.Fecha.UTC()
	if a.Instante {
		t = a.Fecha.In(Argentina)
	}
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
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

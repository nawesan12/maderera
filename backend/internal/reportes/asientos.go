package reportes

import (
	"fmt"
	"math"
	"strings"
	"time"

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
}{"1.1.01", "1.1.02", "1.1.03", "1.1.05", "1.1.06", "1.2.01", "2.1.01", "2.1.03", "2.1.04", "2.1.05", "4.1.01", "5.1.01", "1.1.04"}

// CuentaPorCategoria es CUENTA_POR_CATEGORIA.
var CuentaPorCategoria = map[string]string{
	"flete": "5.1.02", "combustible": "5.1.03", "servicios": "5.1.04", "alquiler": "5.1.05", "sueldos": "5.1.06",
	"mantenimiento": "5.1.07", "impuestos": "5.1.08", "librería": "5.1.09", "publicidad": "5.1.10",
}

var nombresDeCuenta = map[string]string{
	"1.1.01": "Caja", "1.1.02": "Banco", "1.1.03": "Deudores por ventas", "1.1.04": "Valores a depositar", "1.1.05": "IVA crédito fiscal",
	"1.1.06": "Retenciones sufridas", "1.2.01": "Mercaderías", "2.1.01": "Proveedores", "2.1.03": "IVA débito fiscal",
	"2.1.04": "Percepciones IIBB a depositar", "2.1.05": "Retenciones a depositar", "4.1.01": "Ventas",
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
}

// ReciboAAsentar es un recibo emitido o su anulación.
type ReciboAAsentar struct {
	Fecha           time.Time
	Numero, Cliente string
	Partes          []ParteDeRecibo
	Anulacion       bool
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

// fechaCsvUTC es fechaCsv en la zona de Next (UTC): ver CsvAsientos.
func fechaCsvUTC(t time.Time) string {
	t = t.UTC()
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
}

// CsvAsientos es app/admin/cierre/exportar: un renglón por línea con el
// número de asiento repetido, y los totales.
//
// La fecha va en UTC, como el mes del cierre (ver CierreDelMes): los gastos y
// las facturas de compra guardan el día a las 0 UTC, y en hora argentina
// saldrían un día antes.
func CsvAsientos(asientos []Asiento) string {
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
			filas = append(filas, []string{csvexcel.Texto(numero), fechaCsvUTC(a.Fecha), csvexcel.Texto(a.Concepto),
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

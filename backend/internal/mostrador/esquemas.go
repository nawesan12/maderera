package mostrador

import (
	"regexp"
	"time"

	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// Lo que validaban los esquemas de zod de cada puerta del mostrador, leído
// con internal/zodjs para dar el mismo primer error (golden en
// testdata/golden/mostrador/esquemas.json).

// PiezaDeCorte es una pieza del despiece vendido.
type PiezaDeCorte struct {
	LargoMm     int     `json:"largoMm"`
	AnchoMm     int     `json:"anchoMm"`
	Cantidad    int     `json:"cantidad"`
	RespetaVeta int     `json:"respetaVeta"`
	CantoLargo  int     `json:"cantoLargo"`
	CantoAncho  int     `json:"cantoAncho"`
	Etiqueta    *string `json:"etiqueta"`
	Aclaracion  *string `json:"aclaracion"`
}

// CorteDeMostrador es el despiece que se cargó en el mostrador: nace con la
// venta, en la misma transacción.
type CorteDeMostrador struct {
	VariantID           *string        `json:"variantId"`
	MaterialDescripcion string         `json:"materialDescripcion"`
	CantoDescripcion    *string        `json:"cantoDescripcion"`
	PlacaLargoMm        *int           `json:"placaLargoMm"`
	PlacaAnchoMm        *int           `json:"placaAnchoMm"`
	Mitad               *string        `json:"mitad"`
	Placas              int            `json:"placas"`
	Pasadas             int            `json:"pasadas"`
	AcomodoManual       *string        `json:"acomodoManual"`
	AnchoSierraMm       *float64       `json:"anchoSierraMm"`
	Piezas              []PiezaDeCorte `json:"piezas"`
}

// VentaPedida es lo que llega para cobrar: por la acción en línea o por la
// cola sin conexión (con número provisorio y hora del mostrador).
type VentaPedida struct {
	Clave            string
	BranchID         string
	Lineas           []ventas.LineaDeVenta
	CustomerID       *string
	ContactoNombre   string
	ContactoTelefono *string
	MedioPago        string
	Pagos            []ventas.PagoDeVenta
	Acopio           bool
	Comprobante      string
	Cuit             *string
	Descuento        *float64
	DescuentoMotivo  *string
	Notas            *string
	Autorizado       bool
	Corte            *CorteDeMostrador

	NumeroProvisorio *string
	CobradaAt        *time.Time
	UsuarioID        *string
}

var reFechaCheque = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func entero(p *float64) int {
	if p == nil {
		return 0
	}
	return int(*p)
}

func enteroONulo(p *float64) *int {
	if p == nil {
		return nil
	}
	n := int(*p)
	return &n
}

func numero(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// leerLinea es lineaSchema (cola: la unidad tiene default "unidad"; acción:
// tiene que venir).
func leerLinea(e *zodjs.Lector, cola bool) ventas.LineaDeVenta {
	var l ventas.LineaDeVenta
	l.VariantID = e.Cadena("variantId", zodjs.Texto{Nulo: true, UUID: true})
	l.Descripcion = e.Requerido("descripcion", zodjs.Texto{Min: 1})
	if cola {
		l.Unidad = e.Requerido("unidad", zodjs.Texto{Defecto: zodjs.S("unidad")})
	} else {
		l.Unidad = e.Requerido("unidad", zodjs.Texto{Min: 1})
	}
	l.Cantidad = numero(e.Numero("cantidad", zodjs.Num{}, zodjs.Positivo()))
	l.PrecioUnitario = numero(e.Numero("precioUnitario", zodjs.Num{}, zodjs.Min(0)))
	l.Presentacion = e.Opcion("presentacion", zodjs.Opciones{Opcional: true, Nulo: true}, "media_largo", "media_ancho")
	return l
}

// leerPago es pagoDeMostradorSchema (lib/mostrador/esquemas.ts).
func leerPago(e *zodjs.Lector) ventas.PagoDeVenta {
	var p ventas.PagoDeVenta
	if m := e.Opcion("medio", zodjs.Opciones{}, ventas.MediosDeMostrador...); m != nil {
		p.Medio = *m
	}
	p.Importe = numero(e.Numero("importe", zodjs.Num{}, zodjs.Positivo()))
	p.NroLote = e.Cadena("nroLote", zodjs.Texto{Opcional: true, Nulo: true, Max: 20})
	p.NroCupon = e.Cadena("nroCupon", zodjs.Texto{Opcional: true, Nulo: true, Max: 20})
	p.Cuotas = e.Numero("cuotas", zodjs.Num{Coerce: true, Opcional: true, Nulo: true}, zodjs.Entero(), zodjs.Min(1), zodjs.Max(24))
	p.Tarjeta = e.Cadena("tarjeta", zodjs.Texto{Opcional: true, Nulo: true, Max: 40})
	if c := e.Objeto("cheque", true, true); c != nil {
		var ch ventas.ChequeDePago
		if t := c.Opcion("tipo", zodjs.Opciones{Defecto: "fisico"}, "fisico", "echeq"); t != nil {
			ch.Tipo = *t
		}
		ch.Numero = c.Requerido("numero", zodjs.Texto{Recortar: true, Max: 40})
		ch.Banco = c.Requerido("banco", zodjs.Texto{Recortar: true, Max: 80})
		ch.FechaPago = c.Requerido("fechaPago", zodjs.Texto{Patron: reFechaCheque, MsjPatron: "Poné la fecha de pago del cheque."})
		ch.Librador = c.Cadena("librador", zodjs.Texto{Recortar: true, Max: 120, Nulo: true, Opcional: true})
		p.Cheque = &ch
	}
	return p
}

func leerPagos(l *zodjs.Lector) []ventas.PagoDeVenta {
	var pagos []ventas.PagoDeVenta
	l.Objetos("pagos", zodjs.Lista{Opcional: true, Max: 4}, func(_ int, e *zodjs.Lector) {
		pagos = append(pagos, leerPago(e))
	})
	return pagos
}

func leerLineas(l *zodjs.Lector, cola bool) []ventas.LineaDeVenta {
	var lineas []ventas.LineaDeVenta
	l.Objetos("lineas", zodjs.Lista{Min: 1}, func(_ int, e *zodjs.Lector) {
		lineas = append(lineas, leerLinea(e, cola))
	})
	return lineas
}

func leerCorte(c *zodjs.Lector) *CorteDeMostrador {
	var k CorteDeMostrador
	k.VariantID = c.Cadena("variantId", zodjs.Texto{Nulo: true, UUID: true})
	k.MaterialDescripcion = c.Requerido("materialDescripcion", zodjs.Texto{Recortar: true, Min: 2, Max: 200})
	k.CantoDescripcion = c.Cadena("cantoDescripcion", zodjs.Texto{Recortar: true, Max: 120, Nulo: true})
	k.PlacaLargoMm = enteroONulo(c.Numero("placaLargoMm", zodjs.Num{Coerce: true, Nulo: true}, zodjs.Entero(), zodjs.Positivo(), zodjs.Max(6000)))
	k.PlacaAnchoMm = enteroONulo(c.Numero("placaAnchoMm", zodjs.Num{Coerce: true, Nulo: true}, zodjs.Entero(), zodjs.Positivo(), zodjs.Max(6000)))
	k.Mitad = c.Opcion("mitad", zodjs.Opciones{Nulo: true}, "largo", "ancho")
	k.Placas = entero(c.Numero("placas", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Min(1), zodjs.Max(999)))
	k.Pasadas = entero(c.Numero("pasadas", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Min(0), zodjs.Max(9999)))
	k.AcomodoManual = c.Cadena("acomodoManual", zodjs.Texto{Max: 20_000, Nulo: true})
	k.AnchoSierraMm = c.Numero("anchoSierraMm", zodjs.Num{Nulo: true, Opcional: true}, zodjs.Min(0.5), zodjs.Max(10))
	c.Objetos("piezas", zodjs.Lista{Min: 1, Max: 500}, func(_ int, e *zodjs.Lector) {
		var p PiezaDeCorte
		p.LargoMm = entero(e.Numero("largoMm", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Positivo(), zodjs.Max(10_000)))
		p.AnchoMm = entero(e.Numero("anchoMm", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Positivo(), zodjs.Max(10_000)))
		p.Cantidad = entero(e.Numero("cantidad", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Positivo(), zodjs.Max(999)))
		p.RespetaVeta = entero(e.Numero("respetaVeta", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Min(0), zodjs.Max(1)))
		p.CantoLargo = entero(e.Numero("cantoLargo", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Min(0), zodjs.Max(2)))
		p.CantoAncho = entero(e.Numero("cantoAncho", zodjs.Num{Coerce: true}, zodjs.Entero(), zodjs.Min(0), zodjs.Max(2)))
		p.Etiqueta = e.Cadena("etiqueta", zodjs.Texto{Recortar: true, Max: 120, Nulo: true})
		p.Aclaracion = e.Cadena("aclaracion", zodjs.Texto{Recortar: true, Max: 200, Nulo: true})
		k.Piezas = append(k.Piezas, p)
	})
	return &k
}

func booleano(p *bool) bool { return p != nil && *p }

// leerComun es lo que comparten la venta en línea y la de la cola, hasta
// `notas` (en el orden del esquema).
func leerComun(l *zodjs.Lector, cola bool) VentaPedida {
	var v VentaPedida
	v.Clave = l.Requerido("clave", zodjs.Texto{UUID: true})
	v.BranchID = l.Requerido("branchId", zodjs.Texto{UUID: true})
	v.Lineas = leerLineas(l, cola)
	v.CustomerID = l.Cadena("customerId", zodjs.Texto{Nulo: true, UUID: true})
	v.ContactoNombre = l.Requerido("contactoNombre", zodjs.Texto{Min: 1})
	v.ContactoTelefono = l.Cadena("contactoTelefono", zodjs.Texto{Nulo: true, Opcional: true})
	if m := l.Opcion("medioPago", zodjs.Opciones{}, ventas.MediosDeMostrador...); m != nil {
		v.MedioPago = *m
	}
	v.Pagos = leerPagos(l)
	v.Acopio = booleano(l.Booleano("acopio", true))
	if c := l.Opcion("comprobante", zodjs.Opciones{Defecto: "interno"}, "interno", "fiscal"); c != nil {
		v.Comprobante = *c
	}
	v.Cuit = l.Cadena("cuit", zodjs.Texto{Nulo: true, Opcional: true})
	v.Descuento = l.Numero("descuento", zodjs.Num{Opcional: true}, zodjs.Min(0))
	v.DescuentoMotivo = l.Cadena("descuentoMotivo", zodjs.Texto{Nulo: true, Opcional: true})
	v.Notas = l.Cadena("notas", zodjs.Texto{Nulo: true, Opcional: true})
	return v
}

// LeerVentaDeAccion es el ventaSchema de app/mostrador/actions.ts.
func LeerVentaDeAccion(crudo any) (VentaPedida, *zodjs.Lector) {
	l := zodjs.Raiz(crudo)
	v := leerComun(l, false)
	v.Autorizado = booleano(l.Booleano("autorizado", true))
	if c := l.Objeto("corte", true, false); c != nil {
		v.Corte = leerCorte(c)
	}
	return v, l
}

// LeerLoteDeLaCola es el cuerpo de POST /api/mostrador/ventas: hasta 25
// ventas hechas sin conexión.
func LeerLoteDeLaCola(crudo any) ([]VentaPedida, *zodjs.Lector) {
	l := zodjs.Raiz(crudo)
	var lote []VentaPedida
	l.Objetos("ventas", zodjs.Lista{Min: 1, Max: 25}, func(_ int, e *zodjs.Lector) {
		v := leerComun(e, true)
		v.NumeroProvisorio = e.Cadena("numeroProvisorio", zodjs.Texto{Min: 1, Max: 40})
		if s := e.Cadena("cobradaAt", zodjs.Texto{FechaHora: true}); s != nil && e.Ok() {
			if t, err := time.Parse(time.RFC3339Nano, *s); err == nil {
				v.CobradaAt = &t
			}
		}
		v.UsuarioID = e.Cadena("usuarioId", zodjs.Texto{Opcional: true})
		lote = append(lote, v)
	})
	return lote, l
}

// MovimientoDiferido es un ingreso o retiro que pudo esperar en la cola.
type MovimientoDiferido struct {
	Clave    string
	BranchID string
	Tipo     string
	Monto    float64
	Motivo   string
	HechoAt  time.Time
}

// LeerMovimientoDiferido es el esquema de POST /api/mostrador/caja/movimientos.
func LeerMovimientoDiferido(crudo any) (MovimientoDiferido, *zodjs.Lector) {
	l := zodjs.Raiz(crudo)
	var m MovimientoDiferido
	m.Clave = l.Requerido("clave", zodjs.Texto{UUID: true})
	m.BranchID = l.Requerido("branchId", zodjs.Texto{UUID: true})
	if t := l.Opcion("tipo", zodjs.Opciones{}, "ingreso", "retiro"); t != nil {
		m.Tipo = *t
	}
	m.Monto = numero(l.Numero("monto", zodjs.Num{}, zodjs.Positivo()))
	m.Motivo = l.Requerido("motivo", zodjs.Texto{Min: 1})
	if s := l.Cadena("hechoAt", zodjs.Texto{FechaHora: true}); s != nil && l.Ok() {
		m.HechoAt, _ = time.Parse(time.RFC3339Nano, *s)
	}
	return m, l
}

// PresupuestoPedido es el presupuesto que se arma en el mostrador.
type PresupuestoPedido struct {
	BranchID         string
	Lineas           []ventas.LineaDeVenta
	CustomerID       *string
	ContactoNombre   string
	ContactoTelefono *string
	Notas            *string
}

// LeerPresupuesto es presupuestoMostradorSchema.
func LeerPresupuesto(crudo any) (PresupuestoPedido, *zodjs.Lector) {
	l := zodjs.Raiz(crudo)
	var p PresupuestoPedido
	p.BranchID = l.Requerido("branchId", zodjs.Texto{UUID: true})
	p.Lineas = leerLineas(l, false)
	p.CustomerID = l.Cadena("customerId", zodjs.Texto{Nulo: true, UUID: true})
	p.ContactoNombre = l.Requerido("contactoNombre", zodjs.Texto{Min: 1})
	p.ContactoTelefono = l.Cadena("contactoTelefono", zodjs.Texto{Nulo: true, Opcional: true})
	p.Notas = l.Cadena("notas", zodjs.Texto{Nulo: true, Opcional: true, Max: 1000})
	return p, l
}

// AltaRapida es el cliente que se da de alta sin salir de la venta.
type AltaRapida struct {
	Nombre       string
	Documento    string
	CondicionIva string
	Telefono     *string
	Rubro        *string
}

// LeerAltaRapida es el esquema de crearClienteEnMostrador.
func LeerAltaRapida(crudo any) (AltaRapida, *zodjs.Lector) {
	l := zodjs.Raiz(crudo)
	var a AltaRapida
	a.Nombre = l.Requerido("nombre", zodjs.Texto{Recortar: true, Min: 2, MsjMin: "Poné el nombre o la razón social.", Max: 160})
	a.Documento = l.Requerido("documento", zodjs.Texto{Recortar: true, Max: 20})
	if c := l.Opcion("condicionIva", zodjs.Opciones{}, "responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"); c != nil {
		a.CondicionIva = *c
	}
	a.Telefono = l.Cadena("telefono", zodjs.Texto{Recortar: true, Max: 40, Opcional: true})
	a.Rubro = l.Cadena("rubro", zodjs.Texto{Recortar: true, Max: 40, Opcional: true})
	return a, l
}

package compras

import (
	"strings"
	"time"

	"mjbj/internal/plataforma"
)

// Los formularios de compras, leídos y validados como los esquemas de zod de
// las acciones (copiados en scripts/golden/compras.ts, que los corre).

var condicionesIva = []string{"responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"}

// FichaProveedor es fichaSchema.
type FichaProveedor struct {
	ID           *string `json:"id,omitempty"`
	Nombre       string  `json:"nombre"`
	RazonSocial  *string `json:"razonSocial"`
	Cuit         *string `json:"cuit"`
	CondicionIva string  `json:"condicionIva"`
	Contacto     *string `json:"contacto"`
	Telefono     *string `json:"telefono"`
	Email        *string `json:"email"`
	Direccion    *string `json:"direccion"`
	Rubro        *string `json:"rubro"`
	Cbu          *string `json:"cbu"`
	AliasCbu     *string `json:"aliasCbu"`
	DiasPago     float64 `json:"diasPago"`
	Notas        *string `json:"notas"`
}

func leerFicha(m map[string]any) (FichaProveedor, error) {
	l := leer(m)
	var f FichaProveedor
	f.ID, _ = l.texto("id", opcionesTexto{opcional: true, uuid: true})
	f.Nombre = l.requerido("nombre", opcionesTexto{recortar: true, min: 2, msjMin: "Poné el nombre del proveedor.", max: 160})
	f.RazonSocial = l.opcionalONulo("razonSocial", 200)
	f.Cuit = l.opcionalONulo("cuit", 200)
	f.CondicionIva = l.opcion("condicionIva", "", condicionesIva...)
	f.Contacto = l.opcionalONulo("contacto", 200)
	f.Telefono = l.opcionalONulo("telefono", 200)
	f.Email = l.opcionalONulo("email", 200)
	f.Direccion = l.opcionalONulo("direccion", 200)
	f.Rubro = l.opcionalONulo("rubro", 200)
	f.Cbu = l.opcionalONulo("cbu", 200)
	f.AliasCbu = l.opcionalONulo("aliasCbu", 200)
	f.DiasPago = l.numero("diasPago", nil, entero(), minimo(0), maximo(365))
	f.Notas = l.opcionalONulo("notas", 2000)
	return f, l.Problema()
}

// MovimientoProveedor es movimientoSchema.
type MovimientoProveedor struct {
	SupplierID string  `json:"supplierId"`
	Tipo       string  `json:"tipo"`
	Monto      float64 `json:"monto"`
	Detalle    *string `json:"detalle"`
	Referencia *string `json:"referencia"`
}

func leerMovimiento(m map[string]any) (MovimientoProveedor, error) {
	l := leer(m)
	var x MovimientoProveedor
	x.SupplierID = l.uuid("supplierId", "")
	x.Tipo = l.opcion("tipo", "", "factura", "pago", "nota_credito", "nota_debito", "ajuste")
	x.Monto = l.numero("monto", nil, positivo("El monto tiene que ser mayor a cero."))
	x.Detalle = l.opcionalONulo("detalle", 300)
	x.Referencia = l.opcionalONulo("referencia", 200)
	return x, l.Problema()
}

// Condicion es una condición de pago (el esquema de guardarCondicion).
type Condicion struct {
	ID              *string `json:"id,omitempty"`
	SupplierID      string  `json:"supplierId"`
	Modalidad       string  `json:"modalidad"`
	PlazoDias       float64 `json:"plazoDias"`
	BonificacionPct float64 `json:"bonificacionPct"`
	Detalle         *string `json:"detalle,omitempty"`
}

// leerCondicion recibe el FormData como texto (nil: no vino) y lo arma como
// la acción antes de validarlo.
func leerCondicion(form map[string]*string) (Condicion, error) {
	o := map[string]any{}
	s := func(k string) string {
		if v := form[k]; v != nil {
			return *v
		}
		return ""
	}
	if s("id") != "" {
		o["id"] = s("id")
	}
	if v := form["supplierId"]; v != nil {
		o["supplierId"] = *v
	} else {
		o["supplierId"] = nil
	}
	if v := form["modalidad"]; v != nil {
		o["modalidad"] = *v
	} else {
		o["modalidad"] = "transferencia"
	}
	if s("plazoDias") != "" {
		o["plazoDias"] = s("plazoDias")
	} else {
		o["plazoDias"] = 0.0
	}
	if b := strings.Replace(s("bonificacionPct"), ",", ".", 1); b != "" {
		o["bonificacionPct"] = b
	} else {
		o["bonificacionPct"] = 0.0
	}
	if s("detalle") != "" {
		o["detalle"] = s("detalle")
	}
	l := leer(o)
	var c Condicion
	c.ID, _ = l.texto("id", opcionesTexto{opcional: true, uuid: true})
	c.SupplierID = l.uuid("supplierId", "")
	c.Modalidad = l.opcion("modalidad", "", "transferencia", "cheque", "echeq", "efectivo", "otro")
	c.PlazoDias = l.numero("plazoDias", f(0), entero(), minimo(0), maximo(365))
	c.BonificacionPct = l.numero("bonificacionPct", f(0), minimo(0), maximo(90))
	c.Detalle, _ = l.texto("detalle", opcionesTexto{opcional: true, recortar: true, max: 300})
	return c, l.Problema()
}

// LineaOrden es un renglón de la orden de compra.
type LineaOrden struct {
	VariantID     string  `json:"variantId"`
	Descripcion   string  `json:"descripcion,omitempty"`
	Cantidad      float64 `json:"cantidad"`
	CostoUnitario float64 `json:"costoUnitario"`
	AlicuotaIva   float64 `json:"alicuotaIva"`
}

// FormOrden es ordenSchema.
type FormOrden struct {
	SupplierID     string       `json:"supplierId"`
	BranchID       string       `json:"branchId"`
	FechaPrometida *string      `json:"fechaPrometida,omitempty"`
	Notas          *string      `json:"notas"`
	Lineas         []LineaOrden `json:"lineas"`
}

func leerLineas(l *lector, conDescripcion bool) []LineaOrden {
	var out []LineaOrden
	l.lista("lineas", false, 1, "Cargá al menos un renglón.", 0, func(_ int, e *lector) {
		var x LineaOrden
		x.VariantID = e.uuid("variantId", "")
		if conDescripcion {
			x.Descripcion = e.requerido("descripcion", opcionesTexto{min: 1})
		}
		x.Cantidad = e.numero("cantidad", nil, positivo(""))
		x.CostoUnitario = e.numero("costoUnitario", nil, minimo(0))
		x.AlicuotaIva = e.numero("alicuotaIva", nil, minimo(0), maximo(30))
		out = append(out, x)
	})
	return out
}

func leerOrden(m map[string]any) (FormOrden, error) {
	l := leer(m)
	var o FormOrden
	o.SupplierID = l.uuid("supplierId", "Elegí el proveedor.")
	o.BranchID = l.uuid("branchId", "Elegí la sucursal.")
	o.FechaPrometida, _ = l.texto("fechaPrometida", opcionesTexto{opcional: true})
	o.Notas = l.opcionalONulo("notas", 1000)
	o.Lineas = leerLineas(l, true)
	return o, l.Problema()
}

// FormRecepcion es recepcionSchema.
type FormRecepcion struct {
	SupplierID   string       `json:"supplierId"`
	BranchID     string       `json:"branchId"`
	NumeroRemito *string      `json:"numeroRemito"`
	Fecha        *string      `json:"fecha,omitempty"`
	Gastos       float64      `json:"gastos"`
	Notas        *string      `json:"notas"`
	Lineas       []LineaOrden `json:"lineas"`
}

func leerRecepcion(m map[string]any) (FormRecepcion, error) {
	l := leer(m)
	var r FormRecepcion
	r.SupplierID = l.uuid("supplierId", "Elegí el proveedor.")
	r.BranchID = l.uuid("branchId", "Elegí la sucursal.")
	r.NumeroRemito = l.opcionalONulo("numeroRemito", 40)
	r.Fecha, _ = l.texto("fecha", opcionesTexto{opcional: true})
	r.Gastos = l.numero("gastos", f(0), minimo(0))
	r.Notas = l.opcionalONulo("notas", 1000)
	r.Lineas = leerLineas(l, false)
	return r, l.Problema()
}

var tiposComprobanteCompra = []string{"factura_a", "factura_b", "factura_c", "factura_m", "nota_credito_a", "nota_credito_b",
	"nota_credito_c", "nota_debito_a", "nota_debito_b", "nota_debito_c", "ticket", "otro"}

// FormFactura es el esquema de cargarFacturaDeCompra.
type FormFactura struct {
	SupplierID    string  `json:"supplierId"`
	Tipo          string  `json:"tipo"`
	PuntoVenta    float64 `json:"puntoVenta"`
	Numero        float64 `json:"numero"`
	FechaEmision  string  `json:"fechaEmision"`
	Cae           *string `json:"cae"`
	Neto          float64 `json:"neto"`
	Iva21         float64 `json:"iva21"`
	Iva105        float64 `json:"iva105"`
	Iva27         float64 `json:"iva27"`
	Exento        float64 `json:"exento"`
	Percepciones  float64 `json:"percepciones"`
	Observaciones *string `json:"observaciones"`
	// ReceiptID es la recepción que cubre la factura, si la hay (ver
	// CargarFactura). Es opcional: hay facturas sin remito.
	ReceiptID *string `json:"receiptId,omitempty"`
}

func leerFactura(m map[string]any) (FormFactura, error) {
	l := leer(m)
	var x FormFactura
	x.SupplierID = l.uuid("supplierId", "Elegí el proveedor.")
	x.Tipo = l.opcion("tipo", "", tiposComprobanteCompra...)
	x.PuntoVenta = l.numero("puntoVenta", nil, entero(), minimo(0), maximo(99999))
	x.Numero = l.numero("numero", nil, entero(), minimo(0))
	x.FechaEmision = l.requerido("fechaEmision", opcionesTexto{})
	x.Cae = l.opcionalONulo("cae", 20)
	x.Neto = l.numero("neto", nil, minimo(0))
	x.Iva21 = l.numero("iva21", nil, minimo(0))
	x.Iva105 = l.numero("iva105", nil, minimo(0))
	x.Iva27 = l.numero("iva27", nil, minimo(0))
	x.Exento = l.numero("exento", nil, minimo(0))
	x.Percepciones = l.numero("percepciones", nil, minimo(0))
	x.Observaciones = l.opcionalONulo("observaciones", 500)
	if v, esta := m["receiptId"]; esta && v != nil && v != "" {
		r := l.uuid("receiptId", "Esa recepción no existe.")
		x.ReceiptID = &r
	}
	return x, l.Problema()
}

var categoriasGasto = []string{"flete", "combustible", "servicios", "alquiler", "sueldos", "mantenimiento", "impuestos", "librería", "publicidad", "otros"}

// FormGasto es el esquema de cargarGasto.
type FormGasto struct {
	Fecha       string  `json:"fecha"`
	Categoria   string  `json:"categoria"`
	Descripcion string  `json:"descripcion"`
	Importe     float64 `json:"importe"`
	Medio       string  `json:"medio"`
	Circuito    string  `json:"circuito"`
	BranchID    *string `json:"branchId"`
	SupplierID  *string `json:"supplierId"`
	Notas       *string `json:"notas"`
}

func leerGasto(m map[string]any) (FormGasto, error) {
	l := leer(m)
	var g FormGasto
	g.Fecha = l.requerido("fecha", opcionesTexto{})
	g.Categoria = l.opcion("categoria", "", categoriasGasto...)
	g.Descripcion = l.requerido("descripcion", opcionesTexto{recortar: true, min: 2, msjMin: "Poné en qué se gastó.", max: 200})
	g.Importe = l.numero("importe", nil, positivo("El importe tiene que ser mayor a cero."))
	g.Medio = l.opcion("medio", "", "efectivo", "transferencia", "debito", "credito", "cheque")
	g.Circuito = l.opcion("circuito", "blanco", "blanco", "negro")
	vacio := func(campo string) *string {
		s, _ := l.texto(campo, opcionesTexto{opcional: true})
		if s == nil || *s == "" {
			return nil
		}
		return s
	}
	g.BranchID = vacio("branchId")
	g.SupplierID = vacio("supplierId")
	g.Notas = l.opcionalONulo("notas", 500)
	return g, l.Problema()
}

// ChequeNuevo es el cheque que sale con una parte del pago.
type ChequeNuevo struct {
	Tipo      string    `json:"tipo"`
	Numero    string    `json:"numero"`
	Banco     *string   `json:"banco,omitempty"`
	FechaPago time.Time `json:"fechaPago"`
}

// ParteDePago es un renglón de con qué se paga.
type ParteDePago struct {
	Medio      string       `json:"medio"`
	Importe    float64      `json:"importe"`
	Referencia *string      `json:"referencia,omitempty"`
	Cheque     *ChequeNuevo `json:"cheque,omitempty"`
	ChequeID   *string      `json:"chequeId,omitempty"`
}

// RetencionPedida es un régimen con su base.
type RetencionPedida struct {
	RegimenID string  `json:"regimenId"`
	Base      float64 `json:"base"`
}

// Imputacion es una factura que cubre el pago.
type Imputacion struct {
	PurchaseInvoiceID string  `json:"purchaseInvoiceId"`
	Importe           float64 `json:"importe"`
}

// FormPago es el esquema de pagarAProveedor.
type FormPago struct {
	SupplierID   string            `json:"supplierId"`
	Total        float64           `json:"total"`
	Medio        string            `json:"medio"`
	Circuito     string            `json:"circuito"`
	Referencia   *string           `json:"referencia"`
	Notas        *string           `json:"notas"`
	Retenciones  []RetencionPedida `json:"retenciones"`
	Imputaciones []Imputacion      `json:"imputaciones,omitempty"`
	Partes       []ParteDePago     `json:"partes,omitempty"`
	hayImput     bool
	hayPartes    bool
}

var mediosDePago = []string{"transferencia", "efectivo", "cheque", "echeq"}

func leerPago(m map[string]any) (FormPago, error) {
	l := leer(m)
	var p FormPago
	p.SupplierID = l.uuid("supplierId", "Elegí el proveedor.")
	p.Total = l.numero("total", nil, positivo("El pago tiene que ser mayor a cero."))
	p.Medio = l.opcion("medio", "", mediosDePago...)
	p.Circuito = l.opcion("circuito", "blanco", "blanco", "negro")
	p.Referencia = l.opcionalONulo("referencia", 80)
	p.Notas = l.opcionalONulo("notas", 500)
	p.Retenciones = []RetencionPedida{}
	l.lista("retenciones", false, 0, "", 0, func(_ int, e *lector) {
		p.Retenciones = append(p.Retenciones, RetencionPedida{e.uuid("regimenId", ""), e.numero("base", nil, minimo(0))})
	})
	p.Imputaciones = []Imputacion{}
	_, p.hayImput = l.lista("imputaciones", true, 0, "", 30, func(_ int, e *lector) {
		p.Imputaciones = append(p.Imputaciones, Imputacion{e.uuid("purchaseInvoiceId", ""), e.numero("importe", nil, minimo(0))})
	})
	p.Partes = []ParteDePago{}
	_, p.hayPartes = l.lista("partes", true, 0, "", 6, func(_ int, e *lector) {
		var x ParteDePago
		x.Medio = e.opcion("medio", "", mediosDePago...)
		x.Importe = e.numero("importe", nil, positivo(""))
		x.Referencia, _ = e.texto("referencia", opcionesTexto{opcional: true, nulo: true, recortar: true, max: 80})
		if c, ok := e.objeto("cheque"); ok {
			var ch ChequeNuevo
			ch.Tipo = c.opcion("tipo", "", "fisico", "echeq")
			ch.Numero = c.requerido("numero", opcionesTexto{recortar: true, min: 1, msjMin: "Poné el número del cheque.", max: 40})
			ch.Banco, _ = c.texto("banco", opcionesTexto{opcional: true, nulo: true, recortar: true, max: 60})
			ch.FechaPago = c.fecha("fechaPago")
			x.Cheque = &ch
		}
		x.ChequeID, _ = e.texto("chequeId", opcionesTexto{opcional: true, nulo: true, uuid: true})
		p.Partes = append(p.Partes, x)
	})
	return p, l.Problema()
}

// FormPerfil es el perfil de la lista del proveedor (perfilSchema).
type FormPerfil struct {
	SupplierID string `json:"supplierId"`
	PerfilDeProveedor
}

// leerPerfil arma el perfil del FormData como leerPerfilDelFormulario.
func leerPerfil(form map[string]*string) (FormPerfil, error) {
	o := map[string]any{}
	pon := func(k string) {
		if v := form[k]; v != nil {
			o[k] = *v
		} else {
			o[k] = nil
		}
	}
	pon("supplierId")
	pon("columnaCodigo")
	pon("columnaPrecio")
	if v := form["columnaDescripcion"]; v != nil && *v != "" {
		o["columnaDescripcion"] = *v
	}
	if v := form["margenPorcentaje"]; v != nil && *v != "" {
		o["margenPorcentaje"] = *v
	} else {
		o["margenPorcentaje"] = 0.0
	}
	l := leer(o)
	var p FormPerfil
	p.SupplierID = l.uuid("supplierId", "")
	p.ColumnaCodigo = l.requerido("columnaCodigo", opcionesTexto{recortar: true, min: 1, msjMin: "Elegí la columna del código."})
	p.ColumnaPrecio = l.requerido("columnaPrecio", opcionesTexto{recortar: true, min: 1, msjMin: "Elegí la columna del precio."})
	p.ColumnaDescripcion, _ = l.texto("columnaDescripcion", opcionesTexto{opcional: true, recortar: true})
	p.PrecioEsNeto = form["precioEsNeto"] != nil && *form["precioEsNeto"] == "on"
	p.MargenPorcentaje = l.numero("margenPorcentaje", nil, minimo(0), maximo(500))
	return p, l.Problema()
}

// FormRegimen es el de guardarRegimen.
type FormRegimen struct {
	ID                  string
	Alicuota            float64
	AlicuotaNoInscripto float64
	Activo              bool
}

func leerRegimen(form map[string]*string) (FormRegimen, bool) {
	o := map[string]any{}
	// Number(null) es 0 en JS: un campo numérico que no vino vale cero.
	for _, k := range []string{"id", "alicuota", "alicuotaNoInscripto"} {
		if v := form[k]; v != nil {
			o[k] = *v
		} else if k == "id" {
			o[k] = nil
		} else {
			o[k] = 0.0
		}
	}
	l := leer(o)
	var r FormRegimen
	r.ID = l.uuid("id", "")
	r.Alicuota = l.numero("alicuota", nil, minimo(0), maximo(100))
	r.AlicuotaNoInscripto = l.numero("alicuotaNoInscripto", nil, minimo(0), maximo(100))
	r.Activo = form["activo"] != nil && *form["activo"] == "on"
	return r, l.ok()
}

// FilaAplicar es una fila de la vista previa que se aplica.
type FilaAplicar struct {
	Codigo         string  `json:"codigo"`
	VariantID      string  `json:"variantId"`
	Costo          float64 `json:"costo"`
	PrecioSugerido float64 `json:"precioSugerido"`
}

// leerFilasAplicar es el z.array(...) de aplicarLista, sin coerción: los
// números tienen que ser números. Vacía también es un error.
func leerFilasAplicar(v any) ([]FilaAplicar, bool) {
	xs, es := v.([]any)
	if !es || len(xs) == 0 {
		return nil, false
	}
	out := make([]FilaAplicar, 0, len(xs))
	for _, x := range xs {
		m, es := x.(map[string]any)
		if !es {
			return nil, false
		}
		codigo, ok1 := m["codigo"].(string)
		variante, ok2 := m["variantId"].(string)
		costo, ok3 := m["costo"].(float64)
		precio, ok4 := m["precioSugerido"].(float64)
		if !ok1 || !ok2 || !ok3 || !ok4 || !plataforma.UUIDValido(variante) || !(precio > 0) {
			return nil, false
		}
		out = append(out, FilaAplicar{codigo, variante, costo, precio})
	}
	return out, true
}

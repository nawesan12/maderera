package compras

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/caja"
	"mjbj/internal/fiscal"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/pdf"
	"mjbj/internal/plataforma"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// SeriePagosAProveedores es la clave del candado de los pagos a proveedores.
//
// El TS no tomaba ninguno, y eso dejaba tres carreras entre dos pagos
// simultáneos: los dos leían el mismo acumulado del mes (y retenían de
// menos), los dos sacaban el mismo número de certificado (el índice único
// abortaba el segundo con un error crudo) y los dos imputaban el mismo saldo
// de una factura (que quedaba pagada de más). Con el candado, el segundo
// espera. Va por encima de las series de lib/dal/numeracion-ventas.ts
// (1_000_000_000_001 a …005) y lejos de las que se sumen ahí.
const SeriePagosAProveedores int64 = 1_000_000_000_801

// PagoListado es una fila de los pagos hechos.
type PagoListado struct {
	ID                 string           `json:"id"`
	Fecha              time.Time        `json:"fecha"`
	Total              float64          `json:"total"`
	Neto               float64          `json:"neto"`
	Medio              string           `json:"medio"`
	Circuito           string           `json:"circuito"`
	Referencia         *string          `json:"referencia"`
	Proveedor          string           `json:"proveedor"`
	SupplierID         string           `json:"supplierId"`
	Retenido           float64          `json:"retenido"`
	Certificados       int              `json:"certificados"`
	NumerosCertificado []string         `json:"numerosCertificado"`
	Facturas           []FacturaDelPago `json:"facturas"`
	// Partes es con qué salió la plata, renglón por renglón (mes simulado,
	// H140/H362: un pago con cheque y transferencia figuraba solo como
	// «Transferencia» y sin la referencia, y no se podía conciliar).
	Partes          []ParteListada `json:"partes"`
	AnuladoAt       *time.Time     `json:"anuladoAt"`
	MotivoAnulacion *string        `json:"motivoAnulacion"`
}

// ParteListada es un renglón de con qué se pagó: el medio, el importe y la
// referencia (el número de la transferencia o el del cheque).
type ParteListada struct {
	Medio      string  `json:"medio"`
	Importe    float64 `json:"importe"`
	Referencia *string `json:"referencia"`
}

// FacturaDelPago es una factura que cubrió el pago.
type FacturaDelPago struct {
	ID      string  `json:"id"`
	Numero  string  `json:"numero"`
	Importe float64 `json:"importe"`
}

// ListarPagos es listarPagosAProveedores: con lo retenido y las facturas.
func (s *Servicio) ListarPagos(ctx context.Context, limite int) ([]PagoListado, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT p.id, p.fecha, p.total, p.neto, p.medio, p.circuito::text, p.referencia, s.nombre, p.supplier_id,
		  r.retenido, coalesce(r.certificados, 0), r.numeros, i.facturas, p.anulado_at, p.motivo_anulacion, x.partes
		FROM (SELECT * FROM supplier_payments ORDER BY fecha DESC LIMIT $1) p
		JOIN suppliers s ON s.id = p.supplier_id
		-- Lo retenido y las facturas, solo de los pagos que se muestran (el TS
		-- agrupaba todas las retenciones e imputaciones de la historia).
		LEFT JOIN LATERAL (SELECT sum(importe) AS retenido, count(*)::int AS certificados, array_agg(numero ORDER BY numero) AS numeros
		           FROM retenciones_practicadas WHERE payment_id = p.id) r ON true
		LEFT JOIN LATERAL (SELECT json_agg(json_build_object('id', f.id, 'numero', lpad(f.punto_venta::text, 4, '0') || '-' || lpad(f.numero::text, 8, '0'), 'importe', a.importe::text)
		             ORDER BY f.fecha_emision) AS facturas
		           FROM (SELECT a.purchase_invoice_id AS id, a.importe FROM supplier_payment_allocations a WHERE a.payment_id = p.id) a
		           JOIN purchase_invoices f ON f.id = a.id) i0 ON true
		LEFT JOIN LATERAL (SELECT json_agg(json_build_object('id', c.id, 'numero', 'Cheque ' || c.numero, 'importe', k.importe::text)) AS cheques
		           FROM supplier_payment_cheques k JOIN cheques c ON c.id = k.cheque_id WHERE k.payment_id = p.id) ch ON true
		LEFT JOIN LATERAL (SELECT coalesce(i0.facturas::jsonb, '[]'::jsonb) || coalesce(ch.cheques::jsonb, '[]'::jsonb) AS facturas) i ON true
		LEFT JOIN LATERAL (SELECT json_agg(json_build_object('medio', y.medio, 'importe', y.importe::text, 'referencia', coalesce(y.referencia, c.numero))
		             ORDER BY y.importe DESC) AS partes
		           FROM supplier_payment_parts y LEFT JOIN cheques c ON c.id = y.cheque_id WHERE y.payment_id = p.id) x ON true
		ORDER BY p.fecha DESC`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (PagoListado, error) {
		var p PagoListado
		var total, neto jsmath.Num
		var retenido *jsmath.Num
		var facturas, partes []byte
		if err := r.Scan(&p.ID, &p.Fecha, &total, &neto, &p.Medio, &p.Circuito, &p.Referencia, &p.Proveedor, &p.SupplierID,
			&retenido, &p.Certificados, &p.NumerosCertificado, &facturas, &p.AnuladoAt, &p.MotivoAnulacion, &partes); err != nil {
			return p, err
		}
		p.Total, p.Neto, p.Retenido = float64(total), float64(neto), numOCero(retenido)
		if p.NumerosCertificado == nil {
			p.NumerosCertificado = []string{}
		}
		p.Facturas = []FacturaDelPago{}
		if len(facturas) > 0 {
			var crudas []struct{ ID, Numero, Importe string }
			if err := json.Unmarshal(facturas, &crudas); err != nil {
				return p, err
			}
			for _, f := range crudas {
				p.Facturas = append(p.Facturas, FacturaDelPago{f.ID, f.Numero, jsmath.Numero(f.Importe)})
			}
		}
		p.Partes = []ParteListada{}
		if len(partes) > 0 {
			var crudas []struct {
				Medio, Importe string
				Referencia     *string
			}
			if err := json.Unmarshal(partes, &crudas); err != nil {
				return p, err
			}
			for _, x := range crudas {
				p.Partes = append(p.Partes, ParteListada{x.Medio, jsmath.Numero(x.Importe), x.Referencia})
			}
		}
		return p, nil
	})
}

// FacturaConSaldo es una factura del proveedor con algo por pagar.
type FacturaConSaldo struct {
	ID           string    `json:"id"`
	Numero       string    `json:"numero"`
	Tipo         string    `json:"tipo"`
	FechaEmision time.Time `json:"fechaEmision"`
	// FechaVencimiento es cuándo vence: el pago arranca por las vencidas.
	FechaVencimiento *time.Time `json:"fechaVencimiento"`
	Total            float64    `json:"total"`
	Imputado         float64    `json:"imputado"`
	Saldo            float64    `json:"saldo"`
	// NetoSinIva es lo que de la factura entra en la base de Ganancias e
	// IIBB: el neto gravado más lo no gravado o exento, sin el IVA ni las
	// percepciones. La pantalla del pago propone la base con la proporción
	// de esto sobre el total de cada factura imputada.
	NetoSinIva float64 `json:"netoSinIva"`
	// Proveedor y SupplierID, solo en los cheques a reponer del listado de
	// facturas (que junta a todos los proveedores).
	Proveedor  string `json:"proveedor,omitempty"`
	SupplierID string `json:"supplierId,omitempty"`
}

// FacturasConSaldo es facturasConSaldo: lo facturado menos lo ya imputado,
// por vencimiento (la que vence antes, primero). Sin las anuladas.
//
// Del mes simulado: trae también las notas de crédito que quedaron a favor
// (tipo nota_credito_*, el saldo es lo que restan: el pago las aplica a una
// factura, H292) y los cheques que le dimos y rebotaron (tipo
// «cheque_rechazado», el id es el del cheque: se pagan como una factura,
// H337).
func (s *Servicio) FacturasConSaldo(ctx context.Context, proveedor string) ([]FacturaConSaldo, error) {
	out := []FacturaConSaldo{}
	if !plataforma.UUIDValido(proveedor) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT f.id, f.punto_venta, f.numero, f.tipo::text, f.fecha_emision, f.fecha_vencimiento, f.total,
		  `+AplicadoA("f")+`,
		  f.neto + f.exento
		FROM purchase_invoices f
		WHERE f.supplier_id = $1 AND f.anulada_at IS NULL AND (f.tipo::text NOT LIKE 'nota_credito%' OR f.aplica_a_id IS NULL)
		UNION ALL
		-- El cheque que le dimos y rebotó: se le debe hasta que se reponga.
		SELECT c.id, 0, 0, 'cheque_rechazado', m.created_at, NULL::timestamptz, m.monto,
		  coalesce((SELECT sum(k.importe) FROM supplier_payment_cheques k JOIN supplier_payments p ON p.id = k.payment_id
		            WHERE k.cheque_id = c.id AND p.anulado_at IS NULL), 0), 0
		FROM supplier_movements m JOIN cheques c ON c.id = m.cheque_id
		WHERE m.supplier_id = $1 AND m.monto > 0
		ORDER BY 6 NULLS LAST, 5`, proveedor)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var f FacturaConSaldo
		var pv, n int64
		var total, imputado, netoSinIva jsmath.Num
		if err := filas.Scan(&f.ID, &pv, &n, &f.Tipo, &f.FechaEmision, &f.FechaVencimiento, &total, &imputado, &netoSinIva); err != nil {
			return nil, err
		}
		f.Numero, f.Total, f.Imputado, f.NetoSinIva = NumeroDeCompra(pv, n), float64(total), float64(imputado), float64(netoSinIva)
		f.Saldo = SaldoDeFactura(f.Total, f.Imputado)
		if f.Tipo == "cheque_rechazado" {
			if err := s.pool.QueryRow(ctx, `SELECT 'Cheque ' || numero FROM cheques WHERE id = $1`, f.ID).Scan(&f.Numero); err != nil {
				return nil, err
			}
		}
		if f.Saldo > 0.009 {
			out = append(out, f)
		}
	}
	return out, filas.Err()
}

// RegimenDeRetencion es una fila de regimenes_retencion (los numeric como
// texto, como los devolvía drizzle).
type RegimenDeRetencion struct {
	ID                  string    `json:"id"`
	Codigo              string    `json:"codigo"`
	Nombre              string    `json:"nombre"`
	Impuesto            string    `json:"impuesto"`
	Alicuota            string    `json:"alicuota"`
	AlicuotaNoInscripto string    `json:"alicuotaNoInscripto"`
	MinimoNoImponible   string    `json:"minimoNoImponible"`
	MinimoRetencion     string    `json:"minimoRetencion"`
	Activo              bool      `json:"activo"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	Jurisdiccion        *string   `json:"jurisdiccion"`
}

// Regimenes son los activos por código (para pagar) o todos por impuesto y
// código (para la pantalla de retenciones).
func (s *Servicio) Regimenes(ctx context.Context, todos bool) ([]RegimenDeRetencion, error) {
	consulta := `SELECT id, codigo, nombre, impuesto::text, alicuota::text, alicuota_no_inscripto::text, minimo_no_imponible::text,
		  minimo_retencion::text, activo, created_at, updated_at, jurisdiccion FROM regimenes_retencion `
	if todos {
		consulta += `ORDER BY impuesto, codigo`
	} else {
		consulta += `WHERE activo ORDER BY codigo`
	}
	filas, err := s.pool.Query(ctx, consulta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[RegimenDeRetencion])
}

// Acumulado es lo retenido en el mes a un proveedor, por régimen.
type Acumulado struct {
	CodigoRegimen string `json:"codigoRegimen"`
	Base          string `json:"base"`
	Retenido      string `json:"retenido"`
}

// inicioDeMes es el primer instante del mes argentino: un pago del 31 a las
// 22 es de ese mes, no del siguiente.
func inicioDeMes(t time.Time) time.Time {
	t = t.In(fiscal.Argentina)
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, fiscal.Argentina)
}

// AcumuladoDelMes es acumuladoDelMes.
func (s *Servicio) AcumuladoDelMes(ctx context.Context, proveedor string, ahora time.Time) ([]Acumulado, error) {
	if !plataforma.UUIDValido(proveedor) {
		return []Acumulado{}, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT b.codigo_regimen, sum(b.base)::text,
		  (SELECT coalesce(sum(r.importe), 0) FROM retenciones_practicadas r
		   WHERE r.supplier_id = $1 AND r.codigo_regimen = b.codigo_regimen AND r.fecha >= $2 AND r.fecha < $3 AND r.anulada_at IS NULL)::text
		FROM bases_de_retencion b
		WHERE b.supplier_id = $1 AND b.fecha >= $2 AND b.fecha < $3 GROUP BY b.codigo_regimen`, proveedor, inicioDeMes(ahora),
		inicioDeMes(ahora).AddDate(0, 1, 0))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Acumulado])
}

// Certificado es lo que hace falta para imprimir uno.
type Certificado struct {
	Numero               string    `json:"numero"`
	Fecha                time.Time `json:"fecha"`
	Impuesto             string    `json:"impuesto"`
	CodigoRegimen        string    `json:"codigoRegimen"`
	NombreRegimen        *string   `json:"nombreRegimen"`
	Base                 string    `json:"base"`
	Alicuota             string    `json:"alicuota"`
	Importe              string    `json:"importe"`
	ProveedorNombre      string    `json:"proveedorNombre"`
	ProveedorRazonSocial *string   `json:"proveedorRazonSocial"`
	ProveedorCuit        *string   `json:"proveedorCuit"`
	ProveedorDomicilio   *string   `json:"proveedorDomicilio"`
	PagoFecha            time.Time `json:"pagoFecha"`
	PagoMedio            string    `json:"pagoMedio"`
	PagoReferencia       *string   `json:"pagoReferencia"`
	// El cálculo (null en los certificados de antes de la 00089): el
	// acumulado del mes con este pago, el monto sujeto a retención y lo ya
	// retenido en el mes antes de este certificado.
	Acumulado     *string    `json:"acumulado"`
	Imponible     *string    `json:"imponible"`
	RetenidoAntes *string    `json:"retenidoAntes"`
	AnuladaAt     *time.Time `json:"anuladaAt"`
}

// CertificadoParaImprimir es certificadoParaImprimir: por número, que es lo
// que está impreso.
func (s *Servicio) CertificadoParaImprimir(ctx context.Context, numero string) (*Certificado, error) {
	var c Certificado
	err := s.pool.QueryRow(ctx, `
		SELECT r.numero, r.fecha, r.impuesto::text, r.codigo_regimen, g.nombre, r.base::text, r.alicuota::text, r.importe::text,
		  s.nombre, s.razon_social, s.cuit, s.direccion, p.fecha, p.medio, p.referencia,
		  r.acumulado::text, r.imponible::text, r.retenido_antes::text, r.anulada_at
		FROM retenciones_practicadas r
		JOIN suppliers s ON s.id = r.supplier_id
		JOIN supplier_payments p ON p.id = r.payment_id
		LEFT JOIN regimenes_retencion g ON g.id = r.regimen_id
		WHERE r.numero = $1 LIMIT 1`, numero).Scan(&c.Numero, &c.Fecha, &c.Impuesto, &c.CodigoRegimen, &c.NombreRegimen, &c.Base, &c.Alicuota,
		&c.Importe, &c.ProveedorNombre, &c.ProveedorRazonSocial, &c.ProveedorCuit, &c.ProveedorDomicilio, &c.PagoFecha, &c.PagoMedio, &c.PagoReferencia,
		&c.Acumulado, &c.Imponible, &c.RetenidoAntes, &c.AnuladaAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// DatosDelCertificadoPdf pasa el certificado a lo que dibuja internal/pdf
// (lo que hacía la ruta de Next con certificadoDeRetencionPdf). Con el
// cálculo guardado, el cuadro muestra la cuenta entera.
func DatosDelCertificadoPdf(c *Certificado, emisor *pdf.Emisor) pdf.DatosDelCertificado {
	de := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	d := pdf.DatosDelCertificado{Numero: c.Numero, Fecha: c.Fecha, Impuesto: c.Impuesto, CodigoRegimen: c.CodigoRegimen,
		NombreRegimen: de(c.NombreRegimen), Base: jsmath.Numero(c.Base), Alicuota: jsmath.Numero(c.Alicuota),
		Importe: jsmath.Numero(c.Importe), Anulado: c.AnuladaAt != nil}
	if emisor != nil {
		razon := emisor.RazonSocial
		d.Emisor = &pdf.EmisorDelCertificado{RazonSocial: &razon, NombreFantasia: emisor.NombreFantasia, Domicilio: emisor.Domicilio, Cuit: emisor.Cuit}
	}
	d.Proveedor.Nombre, d.Proveedor.RazonSocial = c.ProveedorNombre, de(c.ProveedorRazonSocial)
	d.Proveedor.Cuit, d.Proveedor.Domicilio = de(c.ProveedorCuit), de(c.ProveedorDomicilio)
	d.Pago.Fecha, d.Pago.Medio, d.Pago.Referencia = c.PagoFecha, c.PagoMedio, de(c.PagoReferencia)
	if c.Acumulado != nil && c.Imponible != nil && c.RetenidoAntes != nil {
		d.Calculo = &pdf.CalculoDelCertificado{Acumulado: jsmath.Numero(*c.Acumulado), Imponible: jsmath.Numero(*c.Imponible),
			RetenidoAntes: jsmath.Numero(*c.RetenidoAntes)}
	}
	return d
}

// RetencionesDelPeriodo es retencionesDelPeriodo: las practicadas entre dos
// fechas (inclusive), por fecha y número.
func (s *Servicio) RetencionesDelPeriodo(ctx context.Context, desde, hasta time.Time) ([]RetencionDelPeriodo, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT r.id, r.numero, r.fecha, r.impuesto::text, r.codigo_regimen, r.base, r.alicuota, r.importe, s.nombre, s.cuit,
		  r.acumulado, r.imponible, r.retenido_antes
		FROM retenciones_practicadas r JOIN suppliers s ON s.id = r.supplier_id
		WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.anulada_at IS NULL ORDER BY r.fecha, r.numero`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (RetencionDelPeriodo, error) {
		var x RetencionDelPeriodo
		var base, alicuota, importe jsmath.Num
		var acumulado, imponible, antes *jsmath.Num
		err := r.Scan(&x.ID, &x.Numero, &x.Fecha, &x.Impuesto, &x.CodigoRegimen, &base, &alicuota, &importe, &x.Proveedor, &x.Cuit,
			&acumulado, &imponible, &antes)
		x.Base, x.Alicuota, x.Importe = float64(base), float64(alicuota), float64(importe)
		x.Acumulado, x.Imponible, x.RetenidoAntes = aFloat(acumulado), aFloat(imponible), aFloat(antes)
		return x, err
	})
}

// CertificadoEmitido es uno de los que salieron con el pago.
type CertificadoEmitido struct {
	Numero   string  `json:"numero"`
	Impuesto string  `json:"impuesto"`
	Importe  float64 `json:"importe"`
}

// antesDeNumerar es un gancho para las pruebas de concurrencia.
var antesDeNumerar = func() {}

// siguienteCertificado es siguienteCertificado: por impuesto y por año.
func siguienteCertificado(ctx context.Context, tx pgx.Tx, impuesto string, fecha time.Time) (string, error) {
	tres := impuesto
	if len(tres) > 3 {
		tres = tres[:3]
	}
	prefijo := fmt.Sprintf("%s-%d-", strings.ToUpper(tres), fecha.In(fiscal.Argentina).Year())
	var maximo int64
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(max(nullif(regexp_replace(numero, '^.*-', ''), '')::bigint), 0)::int FROM retenciones_practicadas WHERE numero LIKE $1`,
		prefijo+"%").Scan(&maximo); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%06d", prefijo, maximo+1), nil
}

// PagoRegistrado es lo que contesta PagarAProveedor.
type PagoRegistrado struct {
	ID           string
	Ok           string
	Aviso        string
	Certificados []CertificadoEmitido
}

// fechaDelPago es el instante con que queda el pago: ahora si es de hoy (o
// no vino), el mediodía argentino de ese día si es de antes. Un pago con
// fecha futura no se registra: la plata todavía no salió.
func fechaDelPago(dia *string, ahora time.Time) (time.Time, error) {
	if dia == nil {
		return ahora.UTC(), nil
	}
	d, err := time.ParseInLocation("2006-01-02", *dia, caja.Argentina)
	if err != nil {
		return time.Time{}, plataforma.Invalido(map[string]string{"fecha": "La fecha del pago no es válida."})
	}
	hoy := caja.InicioDelDia(ahora)
	switch {
	case d.After(hoy):
		return time.Time{}, fallo("La fecha del pago no puede ser posterior a hoy.")
	case d.Equal(hoy):
		return ahora.UTC(), nil
	}
	return d.Add(12 * time.Hour).UTC(), nil
}

// efectivoDelPago es lo que sale en billetes: los renglones en efectivo o,
// sin renglones, el neto entero si el medio es efectivo.
func efectivoDelPago(medio string, neto float64, partes []ParteDePago) float64 {
	if len(partes) == 0 {
		if medio == "efectivo" {
			return neto
		}
		return 0
	}
	suma := 0.0
	for _, p := range partes {
		if p.Medio == "efectivo" {
			suma += p.Importe
		}
	}
	return jsmath.Redondear2(suma)
}

// PagarAProveedor es pagarAProveedor + registrarPagoAProveedor: el pago, las
// retenciones con sus certificados, las imputaciones a facturas, las partes
// (con los cheques) y un solo movimiento de cuenta por el total.
//
// Bug arreglado: la parte en efectivo no salía de ninguna caja (un gasto en
// efectivo sí), y el arqueo del turno mostraba un sobrante que no existía.
// Ahora sale del turno de la sucursal elegida, con la misma regla que un
// gasto (turnoDelGasto); si no hay turno, el pago se registra igual y se
// avisa.
func (s *Servicio) PagarAProveedor(ctx context.Context, ses *auth.Sesion, m map[string]any) (PagoRegistrado, error) {
	var out PagoRegistrado
	d, err := leerPago(m)
	if err != nil {
		return out, err
	}
	// Lo que filtraba la acción antes de llamar.
	var retenciones []RetencionPedida
	for _, r := range d.Retenciones {
		if r.Base > 0 {
			retenciones = append(retenciones, r)
		}
	}
	var imputaciones []Imputacion
	for _, i := range d.Imputaciones {
		if i.Importe > 0 {
			imputaciones = append(imputaciones, i)
		}
	}
	var reposiciones []Imputacion
	for _, c := range d.Cheques {
		if c.Importe > 0 {
			reposiciones = append(reposiciones, c)
		}
	}
	// Con renglones, el medio de la cabecera es el del renglón más grande:
	// el selector de un solo medio de arriba no dice nada.
	if len(d.Partes) > 0 {
		mayor := -1.0
		for _, p := range d.Partes {
			if p.Importe > mayor {
				mayor, d.Medio = p.Importe, p.Medio
			}
		}
	}
	for i := range d.Partes {
		if c := d.Partes[i].Cheque; c != nil {
			if p := RevisarNumeroDeCheque(c.Numero); p != "" {
				return out, fallo(p)
			}
			c.Numero = NormalizarNumeroDeCheque(c.Numero)
		}
	}
	// La base de una retención es parte del pago: no puede pasarlo. Para
	// Ganancias e IIBB es el neto de IVA de lo que se paga, así que siempre
	// es menor o igual al total; una base mayor es un error de tipeo (o el
	// total con IVA de otra factura) y haría retener de más.
	for _, r := range retenciones {
		if r.Base-d.Total > 0.009 {
			return out, fallo(fmt.Sprintf("La base de una retención (%s) no puede ser mayor al pago (%s).", Monto(r.Base), Monto(d.Total)))
		}
	}
	ahora := time.Now()
	fecha, err := fechaDelPago(d.Fecha, ahora)
	if err != nil {
		return out, err
	}
	var pagoID string
	var neto float64
	certificados := []CertificadoEmitido{}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, SeriePagosAProveedores); err != nil {
			return err
		}
		var nombre string
		var prov ProveedorParaRetener
		err := tx.QueryRow(ctx, `SELECT nombre, cuit, condicion_iva::text, condicion_ganancias, to_char(exento_ganancias_hasta, 'YYYY-MM-DD')
			FROM suppliers WHERE id = $1`, d.SupplierID).Scan(&nombre, &prov.Cuit, &prov.CondicionIva, &prov.CondicionGanancias, &prov.ExentoHasta)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Ese proveedor no existe.")
		}
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO supplier_payments (supplier_id, fecha, total, neto, medio, referencia, notas, circuito, created_by_user_id)
			VALUES ($1, $2, $3::numeric, $3::numeric, $4, $5, $6, $7::circuito, $8) RETURNING id`,
			d.SupplierID, fecha, jsmath.Fijo2(d.Total), d.Medio, d.Referencia, d.Notas, d.Circuito, ses.UserID).Scan(&pagoID); err != nil {
			return err
		}
		retenido := 0.0
		for _, pedida := range retenciones {
			var reg Regimen
			var regID string
			var a, ani, mni, mr jsmath.Num
			err := tx.QueryRow(ctx, `
				SELECT id, codigo, nombre, impuesto::text, alicuota, alicuota_no_inscripto, minimo_no_imponible, minimo_retencion
				FROM regimenes_retencion WHERE id = $1 AND activo`, pedida.RegimenID).Scan(&regID, &reg.Codigo, &reg.Nombre, &reg.Impuesto, &a, &ani, &mni, &mr)
			if errors.Is(err, pgx.ErrNoRows) {
				return fallo("Ese régimen de retención no existe o está apagado.")
			}
			if err != nil {
				return err
			}
			reg.Alicuota, reg.AlicuotaNoInscripto, reg.MinimoNoImponible, reg.MinimoRetencion = float64(a), float64(ani), float64(mni), float64(mr)
			// Antes de anotar la base: si no corresponde, el pago entero se
			// frena y no queda ni base ni certificado.
			aplica, inscripto, porque := SujetoARetencion(reg.Impuesto, prov, diaArgentino(fecha))
			if !aplica {
				return fallo(reg.Nombre + ": " + porque)
			}
			// El acumulado del mes, que es lo que mira ARCA.
			// La base sale de todos los pagos del mes, hayan retenido o no
			// (bases_de_retencion); lo retenido, de los certificados que no
			// se anularon (las bases de un pago anulado se borran con él).
			var base, ret jsmath.Num
			if err := tx.QueryRow(ctx, `
				SELECT (SELECT coalesce(sum(base), 0) FROM bases_de_retencion
				        WHERE supplier_id = $1 AND codigo_regimen = $2 AND fecha >= $3 AND fecha < $4),
				       (SELECT coalesce(sum(importe), 0) FROM retenciones_practicadas
				        WHERE supplier_id = $1 AND codigo_regimen = $2 AND fecha >= $3 AND fecha < $4 AND anulada_at IS NULL)`,
				// Con tope al fin del mes: un pago fechado en un mes anterior
				// sumaba lo del mes en curso y retenía de más.
				d.SupplierID, reg.Codigo, inicioDeMes(fecha), inicioDeMes(fecha).AddDate(0, 1, 0)).Scan(&base, &ret); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO bases_de_retencion (payment_id, supplier_id, codigo_regimen, base, fecha)
				VALUES ($1, $2, $3, $4::numeric, $5)`, pagoID, d.SupplierID, reg.Codigo, jsmath.Fijo2(pedida.Base), fecha); err != nil {
				return err
			}
			r := CalcularRetencion(pedida.Base, float64(base), float64(ret), reg, inscripto)
			if r.Retencion <= 0 {
				continue
			}
			antesDeNumerar()
			numero, err := siguienteCertificado(ctx, tx, reg.Impuesto, fecha)
			if err != nil {
				return err
			}
			// Con el cálculo entero: el certificado tiene que poder seguirse
			// (acumulado − mínimo = sujeto; sujeto × alícuota − ya retenido =
			// retenido), y con la base del pago sola no cierra.
			acumulado := math.Max(0, float64(base)+pedida.Base)
			if _, err := tx.Exec(ctx, `
				INSERT INTO retenciones_practicadas (payment_id, supplier_id, regimen_id, numero, codigo_regimen, impuesto, base, alicuota, importe, fecha,
				  created_by_user_id, acumulado, imponible, retenido_antes)
				VALUES ($1, $2, $3, $4, $5, $6::impuesto_retenido, $7::numeric, $8::numeric, $9::numeric, $10, $11, $12::numeric, $13::numeric, $14::numeric)`,
				pagoID, d.SupplierID, regID, numero, reg.Codigo, reg.Impuesto, jsmath.Fijo2(pedida.Base), jsmath.ToFixed(r.Alicuota, 3),
				jsmath.Fijo2(r.Retencion), fecha, ses.UserID, jsmath.Fijo2(acumulado), jsmath.Fijo2(r.Imponible), jsmath.Fijo2(float64(ret))); err != nil {
				return err
			}
			retenido = jsmath.Redondear2(retenido + r.Retencion)
			certificados = append(certificados, CertificadoEmitido{numero, reg.Impuesto, r.Retencion})
		}
		neto = jsmath.Redondear2(d.Total - retenido)
		if neto < 0 {
			return fallo("Las retenciones superan el importe del pago.")
		}
		if _, err := tx.Exec(ctx, `UPDATE supplier_payments SET neto = $2::numeric WHERE id = $1`, pagoID, jsmath.Fijo2(neto)); err != nil {
			return err
		}
		importes := make([]float64, len(imputaciones))
		libres := map[string]float64{}
		orden := []string{}
		for i, imp := range imputaciones {
			importes[i] = imp.Importe
			var f FacturaImputada
			var proveedor, tipo string
			var anulada bool
			var total, imputado jsmath.Num
			err := tx.QueryRow(ctx, `
				SELECT supplier_id, numero, total, `+AplicadoA("f")+`,
				  tipo::text, anulada_at IS NOT NULL
				FROM purchase_invoices f WHERE id = $1 FOR UPDATE`, imp.PurchaseInvoiceID).Scan(&proveedor, &f.Numero, &total, &imputado, &tipo, &anulada)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && proveedor != d.SupplierID {
				return fallo("Una de las facturas no es de este proveedor.")
			}
			if err != nil {
				return err
			}
			if anulada {
				return fallo(fmt.Sprintf("La factura %d está anulada: no se le aplica un pago.", f.Numero))
			}
			if strings.HasPrefix(tipo, "nota_credito") {
				return fallo(fmt.Sprintf("La %d es una nota de crédito: resta deuda, no se paga.", f.Numero))
			}
			f.Total, f.Imputado, f.Importe = float64(total), float64(imputado), imp.Importe
			if err := revisarImputacion(f); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO supplier_payment_allocations (payment_id, purchase_invoice_id, importe) VALUES ($1, $2, $3::numeric)`,
				pagoID, imp.PurchaseInvoiceID, jsmath.Fijo2(imp.Importe)); err != nil {
				return err
			}
			libres[imp.PurchaseInvoiceID] = jsmath.Redondear2(f.Total - f.Imputado - f.Importe)
			orden = append(orden, imp.PurchaseInvoiceID)
		}
		// Los cheques rechazados que se reponen con este pago.
		for _, c := range reposiciones {
			importes = append(importes, c.Importe)
			var debe, repuesto jsmath.Num
			err := tx.QueryRow(ctx, `
				SELECT m.monto, coalesce((SELECT sum(k.importe) FROM supplier_payment_cheques k JOIN supplier_payments p ON p.id = k.payment_id
				                          WHERE k.cheque_id = m.cheque_id AND p.anulado_at IS NULL), 0)
				FROM supplier_movements m WHERE m.cheque_id = $1 AND m.supplier_id = $2 AND m.monto > 0 LIMIT 1`,
				c.PurchaseInvoiceID, d.SupplierID).Scan(&debe, &repuesto)
			if errors.Is(err, pgx.ErrNoRows) {
				return fallo("Ese cheque rechazado no es de este proveedor.")
			}
			if err != nil {
				return err
			}
			if c.Importe-jsmath.Redondear2(debe.F()-repuesto.F()) > 0.01 {
				return fallo("Al cheque rechazado le faltan " + Monto(jsmath.Redondear2(debe.F()-repuesto.F())) + ": no se le aplica más.")
			}
			if _, err := tx.Exec(ctx, `INSERT INTO supplier_payment_cheques (payment_id, cheque_id, importe) VALUES ($1, $2, $3::numeric)`,
				pagoID, c.PurchaseInvoiceID, jsmath.Fijo2(c.Importe)); err != nil {
				return err
			}
		}
		// Las notas de crédito a favor que se descuentan: cada una se aplica
		// a la primera factura del pago a la que le queda lugar.
		for _, nota := range d.NotasDeCredito {
			var dueno, tipo string
			var anulada bool
			var aplicada *string
			var total jsmath.Num
			err := tx.QueryRow(ctx, `SELECT supplier_id, tipo::text, anulada_at IS NOT NULL, aplica_a_id, total FROM purchase_invoices WHERE id = $1 FOR UPDATE`,
				nota).Scan(&dueno, &tipo, &anulada, &aplicada, &total)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && (dueno != d.SupplierID || !strings.HasPrefix(tipo, "nota_credito")) {
				return fallo("Una de las notas de crédito no es de este proveedor.")
			}
			if err != nil {
				return err
			}
			if anulada || aplicada != nil {
				return fallo("Una de las notas de crédito ya no está a favor.")
			}
			destino := ""
			for _, f := range orden {
				if libres[f]-total.F() > -0.009 {
					destino = f
					break
				}
			}
			if destino == "" {
				return fallo("La nota de crédito de " + Monto(total.F()) + " es mayor que lo que queda de cada factura: aplicala desde su ficha.")
			}
			libres[destino] = jsmath.Redondear2(libres[destino] - total.F())
			if _, err := tx.Exec(ctx, `UPDATE purchase_invoices SET aplica_a_id = $2, updated_at = now() WHERE id = $1`, nota, destino); err != nil {
				return err
			}
		}
		var partes []ParteDePago
		var montos []float64
		for _, p := range d.Partes {
			if p.Importe > 0 {
				partes = append(partes, p)
				montos = append(montos, p.Importe)
			}
		}
		if err := revisarSumas(d.Total, neto, importes, montos); err != nil {
			return err
		}
		var desglose, sinMonto []string
		for _, parte := range partes {
			ref, err := s.registrarParte(ctx, tx, ses, pagoID, nombre, d.Circuito, parte)
			if err != nil {
				return err
			}
			renglon := NombreDelMedio(parte.Medio)
			if ref != "" {
				renglon += " " + ref
			}
			desglose = append(desglose, renglon+" "+Monto(parte.Importe))
			sinMonto = append(sinMonto, renglon)
		}
		// La referencia de la cabecera, si no vino: las de los renglones.
		if d.Referencia == nil && len(partes) > 0 {
			var refs []string
			for _, parte := range partes {
				if parte.Referencia != nil && *parte.Referencia != "" {
					refs = append(refs, *parte.Referencia)
				}
			}
			if len(refs) > 0 {
				r := strings.Join(refs, " · ")
				d.Referencia = &r
				if _, err := tx.Exec(ctx, `UPDATE supplier_payments SET referencia = $2 WHERE id = $1`, pagoID, r); err != nil {
					return err
				}
			}
		}
		if efectivo := efectivoDelPago(d.Medio, neto, partes); efectivo > 0 {
			if d.BranchID == nil {
				out.Aviso = "No se eligió de qué caja salió el efectivo: no salió de ningún turno."
			} else {
				turno, momento, hay, err := turnoDelGasto(ctx, tx, *d.BranchID, diaArgentino(fecha), ahora)
				if err != nil {
					return err
				}
				if !hay {
					out.Aviso = "No había caja abierta en ese momento: el efectivo no salió de ningún turno."
				} else if _, err := tx.Exec(ctx, `
					INSERT INTO cash_movements (session_id, tipo, monto, motivo, supplier_payment_id, creado_por, created_at)
					VALUES ($1, 'gasto', $2::numeric, $3, $4, $5, $6)`,
					turno, jsmath.Fijo2(-efectivo), "Pago a "+nombre, pagoID, ses.UserID, momento); err != nil {
					return err
				}
			}
		}
		medio := d.Medio
		if len(desglose) > 1 {
			medio = strings.Join(desglose, " + ")
		} else if len(sinMonto) == 1 {
			// Una sola parte: con su número. «Pago cheque» no decía cuál
			// era el endosado (mes simulado).
			medio = sinMonto[0]
		}
		detalle := "Pago " + medio
		if retenido > 0 {
			detalle = "Pago " + medio + " por " + formato.Importe(neto) + " más " + formato.Importe(retenido) + " de retenciones"
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, supplier_payment_id, created_at)
			VALUES ($1, 'pago', $2::numeric, $3, $4, $5, $6, $7)`, d.SupplierID, jsmath.Fijo2(-d.Total), d.Referencia, detalle, ses.UserID, pagoID,
			fechaDelMovimiento(fecha, ahora))
		return err
	})
	if err != nil {
		return out, err
	}
	// Con lo que salió de verdad: un pago con un e-Cheq endosado, un cheque
	// propio y una transferencia decía «por transferencia» (H381).
	desc := "Pagó " + Monto(d.Total) + " por " + mediosDelPago(d)
	if len(certificados) > 0 {
		desc += fmt.Sprintf(", con %d retenciones", len(certificados))
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "pago_proveedor", pagoID, desc, nil)
	out.ID, out.Certificados = pagoID, certificados
	out.Ok = "Pago registrado por " + Monto(neto) + "."
	if len(certificados) > 0 {
		out.Ok = "Pago registrado. Salieron " + Monto(neto) + " y se retuvieron " + Monto(d.Total-neto) + "."
	}
	return out, nil
}

// NombreDelMedio es cómo se dice el medio en la cuenta del proveedor
// (app/admin/compras/pagos/medios.ts).
func NombreDelMedio(m string) string {
	switch m {
	case "transferencia":
		return "transferencia"
	case "efectivo":
		return "efectivo"
	case "cheque":
		return "cheque"
	case "echeq":
		return "e-Cheq"
	}
	return m
}

// fechaDelMovimiento es el created_at del movimiento de cuenta de un pago:
// el de la transacción si es de hoy (como siempre), el día del pago si es de
// antes, así el libro de la cuenta queda en orden.
func fechaDelMovimiento(fecha, ahora time.Time) time.Time {
	if diaArgentino(fecha) == diaArgentino(ahora) {
		return ahora.UTC()
	}
	return fecha
}

// registrarParte es un renglón de con qué salió la plata: un cheque nuevo
// nace entregado; uno de la cartera se endosa. Devuelve cómo se lo
// encuentra: la referencia o el número del cheque.
func (s *Servicio) registrarParte(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, pagoID, proveedor, circuito string, parte ParteDePago) (string, error) {
	ref := ""
	if parte.Referencia != nil {
		ref = *parte.Referencia
	}
	esEcheq := parte.Medio == "echeq" || parte.Cheque != nil && parte.Cheque.Tipo == "echeq"
	if circuito == "negro" && esEcheq {
		return "", fallo("Un e-Cheq no puede salir por el " + reglas.Circuito(ctx, tx) + ": queda registrado en el banco a nombre de la empresa. Usá cheque físico o efectivo.")
	}
	var chequeID *string
	if parte.ChequeID != nil && *parte.ChequeID != "" {
		var importe jsmath.Num
		var tipo, delCheque, numero string
		err := tx.QueryRow(ctx, `SELECT ch.importe, ch.tipo::text, ch.numero FROM cheques ch WHERE ch.id = $1 AND ch.estado = 'cartera' FOR UPDATE OF ch`,
			*parte.ChequeID).Scan(&importe, &tipo, &numero)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", fallo("Uno de los cheques elegidos ya no está en cartera.")
		}
		if err != nil {
			return "", err
		}
		// El circuito, en otra consulta y con el cheque ya bloqueado: si la
		// factura del pedido se estaba emitiendo (facturacion.EmitirEnTransaccion
		// toma el mismo candado), esta lectura ya la ve. En la misma consulta
		// del candado salía con la foto de antes de esperar, y un cheque recién
		// facturado se endosaba en un pago B.
		if err := tx.QueryRow(ctx, `SELECT `+fragmentos.CircuitoDelCheque("ch")+` FROM cheques ch WHERE ch.id = $1`,
			*parte.ChequeID).Scan(&delCheque); err != nil {
			return "", err
		}
		if circuito == "negro" && tipo == "echeq" {
			return "", fallo("Ese es un e-Cheq y el pago va por el " + reglas.Circuito(ctx, tx) + ": quedaría registrado en el banco. Endosá un cheque físico.")
		}
		// Un cheque se endosa en un pago de su mismo circuito (comité final,
		// M8): el del B endosado en un pago blanco salía de Valores a
		// depositar del estudio, donde nunca entró; el blanco en un pago B
		// dejaba ese valor en el estudio para siempre.
		pago := circuito
		if pago == "" {
			pago = "blanco"
		}
		if delCheque != pago {
			if delCheque == "negro" {
				return "", fallo("Ese cheque es del " + reglas.Circuito(ctx, tx) + " y el pago no: endosalo en un pago del " + reglas.Circuito(ctx, tx) + ".")
			}
			return "", fallo("Ese cheque es del circuito blanco y el pago va por el " + reglas.Circuito(ctx, tx) + ": endosalo en un pago blanco.")
		}
		if diferencia := float64(importe) - parte.Importe; diferencia > 0.01 || diferencia < -0.01 {
			return "", fallo("El importe del renglón no coincide con el del cheque endosado.")
		}
		if _, err := tx.Exec(ctx, `UPDATE cheques SET estado = 'entregado', updated_at = now() WHERE id = $1`, *parte.ChequeID); err != nil {
			return "", err
		}
		chequeID, ref = parte.ChequeID, numero
	} else if c := parte.Cheque; c != nil {
		var id string
		if err := tx.QueryRow(ctx, `
			INSERT INTO cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, circuito, notas, created_by_user_id)
			VALUES ('entregado', $1::tipo_cheque, $2, $3, $4, $5::numeric, 'entregado', $6::circuito, $7, $8) RETURNING id`,
			c.Tipo, c.Numero, c.Banco, c.FechaPago, jsmath.Fijo2(parte.Importe), circuito, "Pago a "+proveedor, ses.UserID).Scan(&id); err != nil {
			return "", err
		}
		chequeID, ref = &id, c.Numero
	}
	_, err := tx.Exec(ctx, `INSERT INTO supplier_payment_parts (payment_id, medio, importe, referencia, cheque_id) VALUES ($1, $2, $3::numeric, $4, $5)`,
		pagoID, parte.Medio, jsmath.Fijo2(parte.Importe), parte.Referencia, chequeID)
	return ref, err
}

// GuardarRegimen es guardarRegimen: la alícuota (y si está activo) de un
// régimen, y sus dos mínimos: el no imponible (lo que se descuenta del
// acumulado del mes antes de aplicar la alícuota) y el de retención (por
// debajo, no se retiene). Los mínimos los actualiza ARCA o la provincia cada
// tanto y antes solo se cambiaban con SQL. Devuelve el mensaje.
func (s *Servicio) GuardarRegimen(ctx context.Context, ses *auth.Sesion, form map[string]*string) (string, error) {
	if v := form["id"]; v == nil || trimJS(*v) == "" {
		return s.altaDeRegimen(ctx, ses, form)
	}
	r, ok := leerRegimen(form)
	if !ok {
		return "", fallo("Revisá los números: las alícuotas van en porcentaje, de 0 a 100, y los mínimos en pesos, de cero para arriba.")
	}
	texto := func(p *float64) *string {
		if p == nil {
			return nil
		}
		t := jsmath.Fijo2(*p)
		return &t
	}
	var nombre string
	var mni, mr jsmath.Num
	err := s.pool.QueryRow(ctx, `
		UPDATE regimenes_retencion SET alicuota = $2::numeric, alicuota_no_inscripto = $3::numeric, activo = $4,
		  minimo_no_imponible = coalesce($5::numeric, minimo_no_imponible), minimo_retencion = coalesce($6::numeric, minimo_retencion),
		  updated_at = now()
		WHERE id = $1 RETURNING nombre, minimo_no_imponible, minimo_retencion`,
		r.ID, jsmath.ToFixed(r.Alicuota, 3), jsmath.ToFixed(r.AlicuotaNoInscripto, 3), r.Activo,
		texto(r.MinimoNoImponible), texto(r.MinimoRetencion)).Scan(&nombre, &mni, &mr)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fallo("Ese régimen ya no está.")
	}
	if err != nil {
		return "", err
	}
	desc := "Dejó " + nombre + " al " + jsmath.Texto(r.Alicuota) + "%, mínimo no imponible " + Monto(float64(mni)) +
		" y mínimo de retención " + Monto(float64(mr))
	if !r.Activo {
		desc += " y lo apagó"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "retencion", r.ID, desc,
		struct {
			Alicuota            float64 `json:"alicuota"`
			AlicuotaNoInscripto float64 `json:"alicuotaNoInscripto"`
			MinimoNoImponible   float64 `json:"minimoNoImponible"`
			MinimoRetencion     float64 `json:"minimoRetencion"`
			Activo              bool    `json:"activo"`
		}{r.Alicuota, r.AlicuotaNoInscripto, float64(mni), float64(mr), r.Activo})
	if r.Alicuota == 0 {
		return "Listo: queda cargado y no retiene.", nil
	}
	return "Régimen actualizado.", nil
}

// altaDeRegimen suma un régimen nuevo (sin id en el formulario): el código
// que va impreso en el certificado, el nombre, el impuesto, la jurisdicción
// y las mismas alícuotas y mínimos que se editan después. Solo se podían
// editar los que venían sembrados, y el IIBB que la clienta sí retiene no se
// podía cargar (mes simulado, M2S1-031).
func (s *Servicio) altaDeRegimen(ctx context.Context, ses *auth.Sesion, form map[string]*string) (string, error) {
	campo := func(k string) string {
		if v := form[k]; v != nil {
			return trimJS(*v)
		}
		return ""
	}
	codigo, nombre, impuesto, jurisdiccion := campo("codigo"), campo("nombre"), campo("impuesto"), campo("jurisdiccion")
	switch {
	case codigo == "":
		return "", plataforma.Invalido(map[string]string{"codigo": "Poné el código del régimen."})
	case plataforma.LargoJS(codigo) > 20:
		return "", plataforma.Invalido(map[string]string{"codigo": "El código no puede pasar de 20 letras."})
	case nombre == "":
		return "", plataforma.Invalido(map[string]string{"nombre": "Poné el nombre del régimen."})
	case plataforma.LargoJS(nombre) > 80:
		return "", plataforma.Invalido(map[string]string{"nombre": "El nombre no puede pasar de 80 letras."})
	case plataforma.LargoJS(jurisdiccion) > 40:
		return "", plataforma.Invalido(map[string]string{"jurisdiccion": "La jurisdicción no puede pasar de 40 letras."})
	}
	switch impuesto {
	case "ganancias", "iva", "suss", "iibb":
	default:
		return "", plataforma.Invalido(map[string]string{"impuesto": "Elegí el impuesto."})
	}
	// Las alícuotas y los mínimos, con la misma lectura que la edición (un
	// id cualquiera para que pase la del uuid).
	conID := map[string]*string{}
	for k, v := range form {
		conID[k] = v
	}
	ficticio := "00000000-0000-4000-8000-000000000000"
	conID["id"] = &ficticio
	r, ok := leerRegimen(conID)
	if !ok {
		return "", fallo("Revisá los números: las alícuotas van en porcentaje, de 0 a 100, y los mínimos en pesos, de cero para arriba.")
	}
	cero := func(p *float64) string {
		if p == nil {
			return "0"
		}
		return jsmath.Fijo2(*p)
	}
	var jur *string
	if jurisdiccion != "" {
		jur = &jurisdiccion
	}
	var id string
	err := s.pool.QueryRow(ctx, `INSERT INTO regimenes_retencion (codigo, nombre, impuesto, jurisdiccion, alicuota, alicuota_no_inscripto,
		  minimo_no_imponible, minimo_retencion, activo)
		VALUES ($1, $2, $3::impuesto_retenido, $4, $5::numeric, $6::numeric, $7::numeric, $8::numeric, true)
		ON CONFLICT (codigo) DO NOTHING RETURNING id`,
		codigo, nombre, impuesto, jur, jsmath.ToFixed(r.Alicuota, 3), jsmath.ToFixed(r.AlicuotaNoInscripto, 3),
		cero(r.MinimoNoImponible), cero(r.MinimoRetencion)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.Invalido(map[string]string{"codigo": "Ya hay un régimen con ese código."})
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "retencion", id,
		"Dio de alta el régimen "+codigo+" · "+nombre+" al "+jsmath.Texto(r.Alicuota)+"%", map[string]any{"impuesto": impuesto})
	return "Régimen agregado.", nil
}

// mediosDelPago nombra los medios de las partes del pago, en orden y sin
// repetir: el cheque o e-Cheq de la cartera es «endosado» y el que se libra,
// «propio». Sin partes, el medio del pago.
func mediosDelPago(d FormPago) string {
	var out []string
	visto := map[string]bool{}
	for _, p := range d.Partes {
		if p.Importe <= 0 {
			continue
		}
		n := strings.ReplaceAll(p.Medio, "_", " ")
		switch p.Medio {
		case "cheque", "echeq":
			n = "cheque"
			if p.Medio == "echeq" || p.Cheque != nil && p.Cheque.Tipo == "echeq" {
				n = "e-Cheq"
			}
			if p.ChequeID != nil {
				n += " endosado"
			} else {
				n += " propio"
			}
		}
		if !visto[n] {
			visto[n] = true
			out = append(out, n)
		}
	}
	if len(out) == 0 {
		return strings.ReplaceAll(d.Medio, "_", " ")
	}
	if len(out) == 1 {
		return out[0]
	}
	return strings.Join(out[:len(out)-1], ", ") + " y " + out[len(out)-1]
}

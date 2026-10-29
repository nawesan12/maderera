package compras

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
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
		  r.retenido, coalesce(r.certificados, 0), r.numeros, i.facturas
		FROM supplier_payments p
		JOIN suppliers s ON s.id = p.supplier_id
		LEFT JOIN (SELECT payment_id, sum(importe) AS retenido, count(*)::int AS certificados, array_agg(numero ORDER BY numero) AS numeros
		           FROM retenciones_practicadas GROUP BY payment_id) r ON r.payment_id = p.id
		LEFT JOIN (SELECT a.payment_id, json_agg(json_build_object('id', f.id, 'numero', f.punto_venta || '-' || f.numero, 'importe', a.importe::text)
		             ORDER BY f.fecha_emision) AS facturas
		           FROM supplier_payment_allocations a JOIN purchase_invoices f ON f.id = a.purchase_invoice_id GROUP BY a.payment_id) i
		  ON i.payment_id = p.id
		ORDER BY p.fecha DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (PagoListado, error) {
		var p PagoListado
		var total, neto jsmath.Num
		var retenido *jsmath.Num
		var facturas []byte
		if err := r.Scan(&p.ID, &p.Fecha, &total, &neto, &p.Medio, &p.Circuito, &p.Referencia, &p.Proveedor, &p.SupplierID,
			&retenido, &p.Certificados, &p.NumerosCertificado, &facturas); err != nil {
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
		return p, nil
	})
}

// FacturaConSaldo es una factura del proveedor con algo por pagar.
type FacturaConSaldo struct {
	ID           string    `json:"id"`
	Numero       string    `json:"numero"`
	Tipo         string    `json:"tipo"`
	FechaEmision time.Time `json:"fechaEmision"`
	Total        float64   `json:"total"`
	Imputado     float64   `json:"imputado"`
	Saldo        float64   `json:"saldo"`
}

// FacturasConSaldo es facturasConSaldo: lo facturado menos lo ya imputado.
func (s *Servicio) FacturasConSaldo(ctx context.Context, proveedor string) ([]FacturaConSaldo, error) {
	out := []FacturaConSaldo{}
	if !plataforma.UUIDValido(proveedor) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT f.id, f.punto_venta, f.numero, f.tipo::text, f.fecha_emision, f.total,
		  coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0)
		FROM purchase_invoices f WHERE f.supplier_id = $1 ORDER BY f.fecha_emision`, proveedor)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var f FacturaConSaldo
		var pv, n int64
		var total, imputado jsmath.Num
		if err := filas.Scan(&f.ID, &pv, &n, &f.Tipo, &f.FechaEmision, &total, &imputado); err != nil {
			return nil, err
		}
		f.Numero, f.Total, f.Imputado = NumeroDeCompra(pv, n), float64(total), float64(imputado)
		f.Saldo = SaldoDeFactura(f.Total, f.Imputado)
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

func inicioDeMes(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// AcumuladoDelMes es acumuladoDelMes.
func (s *Servicio) AcumuladoDelMes(ctx context.Context, proveedor string, ahora time.Time) ([]Acumulado, error) {
	if !plataforma.UUIDValido(proveedor) {
		return []Acumulado{}, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT codigo_regimen, sum(base)::text, sum(importe)::text FROM retenciones_practicadas
		WHERE supplier_id = $1 AND fecha >= $2 GROUP BY codigo_regimen`, proveedor, inicioDeMes(ahora))
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
}

// CertificadoParaImprimir es certificadoParaImprimir: por número, que es lo
// que está impreso.
func (s *Servicio) CertificadoParaImprimir(ctx context.Context, numero string) (*Certificado, error) {
	var c Certificado
	err := s.pool.QueryRow(ctx, `
		SELECT r.numero, r.fecha, r.impuesto::text, r.codigo_regimen, g.nombre, r.base::text, r.alicuota::text, r.importe::text,
		  s.nombre, s.razon_social, s.cuit, s.direccion, p.fecha, p.medio, p.referencia
		FROM retenciones_practicadas r
		JOIN suppliers s ON s.id = r.supplier_id
		JOIN supplier_payments p ON p.id = r.payment_id
		LEFT JOIN regimenes_retencion g ON g.id = r.regimen_id
		WHERE r.numero = $1 LIMIT 1`, numero).Scan(&c.Numero, &c.Fecha, &c.Impuesto, &c.CodigoRegimen, &c.NombreRegimen, &c.Base, &c.Alicuota,
		&c.Importe, &c.ProveedorNombre, &c.ProveedorRazonSocial, &c.ProveedorCuit, &c.ProveedorDomicilio, &c.PagoFecha, &c.PagoMedio, &c.PagoReferencia)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// RetencionesDelPeriodo es retencionesDelPeriodo: las practicadas entre dos
// fechas (inclusive), por fecha y número.
func (s *Servicio) RetencionesDelPeriodo(ctx context.Context, desde, hasta time.Time) ([]RetencionDelPeriodo, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT r.id, r.numero, r.fecha, r.impuesto::text, r.codigo_regimen, r.base, r.alicuota, r.importe, s.nombre, s.cuit
		FROM retenciones_practicadas r JOIN suppliers s ON s.id = r.supplier_id
		WHERE r.fecha >= $1 AND r.fecha <= $2 ORDER BY r.fecha, r.numero`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (RetencionDelPeriodo, error) {
		var x RetencionDelPeriodo
		var base, alicuota, importe jsmath.Num
		err := r.Scan(&x.ID, &x.Numero, &x.Fecha, &x.Impuesto, &x.CodigoRegimen, &base, &alicuota, &importe, &x.Proveedor, &x.Cuit)
		x.Base, x.Alicuota, x.Importe = float64(base), float64(alicuota), float64(importe)
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
	prefijo := fmt.Sprintf("%s-%d-", strings.ToUpper(tres), fecha.UTC().Year())
	var maximo int64
	if err := tx.QueryRow(ctx, `
		SELECT coalesce(max(nullif(regexp_replace(numero, '^.*-', ''), '')::bigint), 0)::int FROM retenciones_practicadas WHERE numero LIKE $1`,
		prefijo+"%").Scan(&maximo); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s%06d", prefijo, maximo+1), nil
}

// PagarAProveedor es pagarAProveedor + registrarPagoAProveedor: el pago, las
// retenciones con sus certificados, las imputaciones a facturas, las partes
// (con los cheques) y un solo movimiento de cuenta por el total.
func (s *Servicio) PagarAProveedor(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, []CertificadoEmitido, error) {
	d, err := leerPago(m)
	if err != nil {
		return "", nil, err
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
	for i := range d.Partes {
		if c := d.Partes[i].Cheque; c != nil {
			if p := RevisarNumeroDeCheque(c.Numero); p != "" {
				return "", nil, fallo(p)
			}
			c.Numero = NormalizarNumeroDeCheque(c.Numero)
		}
	}
	fecha := time.Now().UTC()
	var pagoID string
	var neto float64
	certificados := []CertificadoEmitido{}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, SeriePagosAProveedores); err != nil {
			return err
		}
		var nombre string
		var cuit *string
		err := tx.QueryRow(ctx, `SELECT nombre, cuit FROM suppliers WHERE id = $1`, d.SupplierID).Scan(&nombre, &cuit)
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
				FROM regimenes_retencion WHERE id = $1`, pedida.RegimenID).Scan(&regID, &reg.Codigo, &reg.Nombre, &reg.Impuesto, &a, &ani, &mni, &mr)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return err
			}
			reg.Alicuota, reg.AlicuotaNoInscripto, reg.MinimoNoImponible, reg.MinimoRetencion = float64(a), float64(ani), float64(mni), float64(mr)
			// El acumulado del mes, que es lo que mira ARCA.
			var base, ret jsmath.Num
			if err := tx.QueryRow(ctx, `
				SELECT coalesce(sum(base), 0), coalesce(sum(importe), 0) FROM retenciones_practicadas
				WHERE supplier_id = $1 AND codigo_regimen = $2 AND fecha >= $3`, d.SupplierID, reg.Codigo, inicioDeMes(fecha)).Scan(&base, &ret); err != nil {
				return err
			}
			// Inscripto es quien tiene CUIT cargado (todavía no se consulta el padrón).
			r := CalcularRetencion(pedida.Base, float64(base), float64(ret), reg, cuit != nil && *cuit != "")
			if r.Retencion <= 0 {
				continue
			}
			antesDeNumerar()
			numero, err := siguienteCertificado(ctx, tx, reg.Impuesto, fecha)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO retenciones_practicadas (payment_id, supplier_id, regimen_id, numero, codigo_regimen, impuesto, base, alicuota, importe, fecha, created_by_user_id)
				VALUES ($1, $2, $3, $4, $5, $6::impuesto_retenido, $7::numeric, $8::numeric, $9::numeric, $10, $11)`,
				pagoID, d.SupplierID, regID, numero, reg.Codigo, reg.Impuesto, jsmath.Fijo2(pedida.Base), jsmath.ToFixed(r.Alicuota, 3),
				jsmath.Fijo2(r.Retencion), fecha, ses.UserID); err != nil {
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
		for i, imp := range imputaciones {
			importes[i] = imp.Importe
			var f FacturaImputada
			var proveedor string
			var total, imputado jsmath.Num
			err := tx.QueryRow(ctx, `
				SELECT supplier_id, numero, total,
				  coalesce((SELECT sum(a.importe) FROM supplier_payment_allocations a WHERE a.purchase_invoice_id = f.id), 0)
				FROM purchase_invoices f WHERE id = $1 FOR UPDATE`, imp.PurchaseInvoiceID).Scan(&proveedor, &f.Numero, &total, &imputado)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && proveedor != d.SupplierID {
				return fallo("Una de las facturas no es de este proveedor.")
			}
			if err != nil {
				return err
			}
			f.Total, f.Imputado, f.Importe = float64(total), float64(imputado), imp.Importe
			if err := revisarImputacion(f); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO supplier_payment_allocations (payment_id, purchase_invoice_id, importe) VALUES ($1, $2, $3::numeric)`,
				pagoID, imp.PurchaseInvoiceID, jsmath.Fijo2(imp.Importe)); err != nil {
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
		for _, parte := range partes {
			if err := s.registrarParte(ctx, tx, ses, pagoID, nombre, d.Circuito, parte); err != nil {
				return err
			}
		}
		detalle := "Pago " + d.Medio
		if retenido > 0 {
			detalle = fmt.Sprintf("Pago %s por $%s más $%s de retenciones", d.Medio, jsmath.Fijo2(neto), jsmath.Fijo2(retenido))
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id)
			VALUES ($1, 'pago', $2::numeric, $3, $4, $5)`, d.SupplierID, jsmath.Fijo2(-d.Total), d.Referencia, detalle, ses.UserID)
		return err
	})
	if err != nil {
		return "", nil, err
	}
	desc := "Pagó " + Monto(d.Total) + " por " + d.Medio
	if len(certificados) > 0 {
		desc += fmt.Sprintf(", con %d retenciones", len(certificados))
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "pago_proveedor", pagoID, desc, nil)
	ok := "Pago registrado por " + Monto(neto) + "."
	if len(certificados) > 0 {
		ok = "Pago registrado. Salieron " + Monto(neto) + " y se retuvieron " + Monto(d.Total-neto) + "."
	}
	return ok, certificados, nil
}

// registrarParte es un renglón de con qué salió la plata: un cheque nuevo
// nace entregado; uno de la cartera se endosa.
func (s *Servicio) registrarParte(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, pagoID, proveedor, circuito string, parte ParteDePago) error {
	esEcheq := parte.Medio == "echeq" || parte.Cheque != nil && parte.Cheque.Tipo == "echeq"
	if circuito == "negro" && esEcheq {
		return fallo("Un e-Cheq no puede salir por el circuito B: queda registrado en el banco a nombre de la empresa. Usá cheque físico o efectivo.")
	}
	var chequeID *string
	if parte.ChequeID != nil && *parte.ChequeID != "" {
		var importe jsmath.Num
		var tipo string
		err := tx.QueryRow(ctx, `SELECT importe, tipo::text FROM cheques WHERE id = $1 AND estado = 'cartera' FOR UPDATE`, *parte.ChequeID).Scan(&importe, &tipo)
		if errors.Is(err, pgx.ErrNoRows) {
			return fallo("Uno de los cheques elegidos ya no está en cartera.")
		}
		if err != nil {
			return err
		}
		if circuito == "negro" && tipo == "echeq" {
			return fallo("Ese es un e-Cheq y el pago va por el circuito B: quedaría registrado en el banco. Endosá un cheque físico.")
		}
		if diferencia := float64(importe) - parte.Importe; diferencia > 0.01 || diferencia < -0.01 {
			return fallo("El importe del renglón no coincide con el del cheque endosado.")
		}
		if _, err := tx.Exec(ctx, `UPDATE cheques SET estado = 'entregado', updated_at = now() WHERE id = $1`, *parte.ChequeID); err != nil {
			return err
		}
		chequeID = parte.ChequeID
	} else if c := parte.Cheque; c != nil {
		var id string
		if err := tx.QueryRow(ctx, `
			INSERT INTO cheques (sentido, tipo, numero, banco, fecha_pago, importe, estado, circuito, notas, created_by_user_id)
			VALUES ('entregado', $1::tipo_cheque, $2, $3, $4, $5::numeric, 'entregado', $6::circuito, $7, $8) RETURNING id`,
			c.Tipo, c.Numero, c.Banco, c.FechaPago, jsmath.Fijo2(parte.Importe), circuito, "Pago a "+proveedor, ses.UserID).Scan(&id); err != nil {
			return err
		}
		chequeID = &id
	}
	_, err := tx.Exec(ctx, `INSERT INTO supplier_payment_parts (payment_id, medio, importe, referencia, cheque_id) VALUES ($1, $2, $3::numeric, $4, $5)`,
		pagoID, parte.Medio, jsmath.Fijo2(parte.Importe), parte.Referencia, chequeID)
	return err
}

// GuardarRegimen es guardarRegimen: la alícuota (y si está activo) de un
// régimen. Devuelve el mensaje.
func (s *Servicio) GuardarRegimen(ctx context.Context, ses *auth.Sesion, form map[string]*string) (string, error) {
	r, ok := leerRegimen(form)
	if !ok {
		return "", fallo("Revisá las alícuotas: van en porcentaje, de 0 a 100.")
	}
	var nombre string
	err := s.pool.QueryRow(ctx, `
		UPDATE regimenes_retencion SET alicuota = $2::numeric, alicuota_no_inscripto = $3::numeric, activo = $4 WHERE id = $1 RETURNING nombre`,
		r.ID, jsmath.ToFixed(r.Alicuota, 3), jsmath.ToFixed(r.AlicuotaNoInscripto, 3), r.Activo).Scan(&nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fallo("Ese régimen ya no está.")
	}
	if err != nil {
		return "", err
	}
	desc := "Dejó " + nombre + " al " + jsmath.Texto(r.Alicuota) + "%"
	if !r.Activo {
		desc += " y lo apagó"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "retencion", r.ID, desc,
		struct {
			Alicuota            float64 `json:"alicuota"`
			AlicuotaNoInscripto float64 `json:"alicuotaNoInscripto"`
			Activo              bool    `json:"activo"`
		}{r.Alicuota, r.AlicuotaNoInscripto, r.Activo})
	if r.Alicuota == 0 {
		return "Listo: queda cargado y no retiene.", nil
	}
	return "Alícuota actualizada.", nil
}

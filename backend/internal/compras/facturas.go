package compras

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/fiscal"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// --- las facturas de compra: el listado, la ficha, el alta, la corrección
// y la anulación ---

// FacturaDeCompra es una fila del listado del panel.
type FacturaDeCompra struct {
	ID               string     `json:"id"`
	Tipo             string     `json:"tipo"`
	PuntoVenta       int32      `json:"puntoVenta"`
	Numero           int32      `json:"numero"`
	FechaEmision     time.Time  `json:"fechaEmision"`
	FechaVencimiento *time.Time `json:"fechaVencimiento"`
	Proveedor        string     `json:"proveedor"`
	SupplierID       string     `json:"supplierId"`
	Neto             string     `json:"neto"`
	Total            string     `json:"total"`
	Pagado           string     `json:"pagado"`
	AnuladaAt        *time.Time `json:"anuladaAt"`
	// AplicaA es, de una nota de crédito, el número de la factura a la que
	// se aplicó («1-2011»); nil si quedó a favor.
	AplicaA *string `json:"aplicaA"`
}

// FiltroDeFacturas es lo que se puede pedir del listado.
//
// Estado: «pendiente» (las que falta pagar, todas, por vencimiento),
// «pagadas» (de a páginas, las más nuevas primero) o «todas» (también las
// anuladas). Proveedor y fechas (de emisión) cortan cualquiera de las tres.
type FiltroDeFacturas struct {
	Estado       string
	Proveedor    string
	Desde, Hasta *time.Time
	Pagina       int
	PorPagina    int
}

// ListadoDeFacturas es la página pedida y la deuda entera.
//
// Bug arreglado: la pantalla traía las últimas 60 facturas y sumaba ahí el
// «$X sin pagar»; una impaga más vieja que esas 60 no estaba en la suma ni en
// el filtro «sin pagar». La deuda ahora se suma en la base sobre todas.
type ListadoDeFacturas struct {
	Facturas []FacturaDeCompra `json:"facturas"`
	// Lo impago de todas las facturas vivas (con el filtro de proveedor, sin
	// el de fechas): es la deuda, no lo que entra en la página.
	Impago        float64 `json:"impago"`
	Impagas       int     `json:"impagas"`
	Vencidas      int     `json:"vencidas"`
	ImpagoVencido float64 `json:"impagoVencido"`
	HayMas        bool    `json:"hayMas"`
	// ChequesAReponer son los cheques que le dimos a un proveedor y
	// rebotaron: se le deben como una factura y suman en lo impago (mes
	// simulado, H293: Facturas de compra y Proveedores no decían lo mismo).
	ChequesAReponer []FacturaConSaldo `json:"chequesAReponer"`
}

// condicionPendiente es «falta pagarla»: viva, que no sea una nota de crédito
// (resta deuda, no se paga) y con saldo. La misma regla que FacturasConSaldo.
const condicionPendiente = `f.anulada_at IS NULL AND f.tipo::text NOT LIKE 'nota_credito%' AND f.total - f.pagado > 0.01`

// ListarFacturas es el listado de /admin/compras/facturas.
func (s *Servicio) ListarFacturas(ctx context.Context, filtro FiltroDeFacturas, ahora time.Time) (ListadoDeFacturas, error) {
	out := ListadoDeFacturas{Facturas: []FacturaDeCompra{}}
	proveedor := filtro.Proveedor
	if proveedor != "" && !plataforma.UUIDValido(proveedor) {
		return out, nil
	}
	porPagina := filtro.PorPagina
	if porPagina <= 0 || porPagina > 500 {
		porPagina = 50
	}
	pagina := max(filtro.Pagina, 1)
	base := `
		WITH f AS (
		  SELECT f.*, s.nombre AS proveedor, ` + AplicadoA("f") + ` AS pagado,
		    (SELECT c.punto_venta || '-' || c.numero FROM purchase_invoices c WHERE c.id = f.aplica_a_id) AS aplica_a
		  FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		  WHERE ($1::text = '' OR f.supplier_id::text = $1)
		    AND ($2::timestamptz IS NULL OR f.fecha_emision >= $2) AND ($3::timestamptz IS NULL OR f.fecha_emision <= $3)
		)`
	var donde, orden string
	limite, desde := porPagina+1, (pagina-1)*porPagina
	switch filtro.Estado {
	case "pendiente":
		// Lo que falta pagar se ve entero y por vencimiento: lo más urgente
		// arriba. Son pocas; el tope es por las dudas.
		donde, orden, limite, desde = condicionPendiente, `f.fecha_vencimiento NULLS LAST, f.fecha_emision, f.numero`, 501, 0
	case "pagadas":
		donde, orden = `f.anulada_at IS NULL AND NOT (`+condicionPendiente+`)`, `f.fecha_emision DESC, f.numero DESC`
	default:
		donde, orden = `true`, `f.fecha_emision DESC, f.numero DESC`
	}
	filas, err := s.pool.Query(ctx, base+`
		SELECT f.id, f.tipo::text, f.punto_venta, f.numero, f.fecha_emision, f.fecha_vencimiento, f.proveedor, f.supplier_id,
		  f.neto::text, f.total::text, f.pagado::text, f.anulada_at, f.aplica_a
		FROM f WHERE `+donde+` ORDER BY `+orden+` LIMIT $4 OFFSET $5`,
		proveedor, filtro.Desde, filtro.Hasta, limite, desde)
	if err != nil {
		return out, err
	}
	out.Facturas, err = pgx.CollectRows(filas, pgx.RowToStructByPos[FacturaDeCompra])
	if err != nil {
		return out, err
	}
	if len(out.Facturas) > limite-1 {
		out.Facturas, out.HayMas = out.Facturas[:limite-1], true
	}
	var impago, vencido jsmath.Num
	err = s.pool.QueryRow(ctx, base+`
		SELECT coalesce(sum(f.total - f.pagado), 0), count(*)::int,
		  count(*) FILTER (WHERE f.fecha_vencimiento < $4)::int, coalesce(sum(f.total - f.pagado) FILTER (WHERE f.fecha_vencimiento < $4), 0)
		FROM f WHERE `+condicionPendiente, proveedor, nil, nil, diaDeHoy(ahora)).Scan(&impago, &out.Impagas, &out.Vencidas, &vencido)
	out.Impago, out.ImpagoVencido = float64(impago), float64(vencido)
	if err != nil {
		return out, err
	}
	out.ChequesAReponer, err = s.chequesAReponer(ctx, proveedor)
	for _, c := range out.ChequesAReponer {
		out.Impago = jsmath.Redondear2(out.Impago + c.Saldo)
		out.Impagas++
	}
	return out, err
}

// chequesAReponer son los cheques rechazados que todavía se le deben a un
// proveedor (o a todos, con proveedor vacío).
func (s *Servicio) chequesAReponer(ctx context.Context, proveedor string) ([]FacturaConSaldo, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT c.id, 'Cheque ' || c.numero, s.nombre, m.supplier_id, m.created_at, m.monto,
		  coalesce((SELECT sum(k.importe) FROM supplier_payment_cheques k JOIN supplier_payments p ON p.id = k.payment_id
		            WHERE k.cheque_id = c.id AND p.anulado_at IS NULL), 0)
		FROM supplier_movements m JOIN cheques c ON c.id = m.cheque_id JOIN suppliers s ON s.id = m.supplier_id
		WHERE m.monto > 0 AND ($1 = '' OR m.supplier_id::text = $1) ORDER BY m.created_at`, proveedor)
	if err != nil {
		return nil, err
	}
	out := []FacturaConSaldo{}
	defer filas.Close()
	for filas.Next() {
		var f FacturaConSaldo
		var total, repuesto jsmath.Num
		if err := filas.Scan(&f.ID, &f.Numero, &f.Proveedor, &f.SupplierID, &f.FechaEmision, &total, &repuesto); err != nil {
			return nil, err
		}
		f.Tipo, f.Total, f.Imputado = "cheque_rechazado", total.F(), repuesto.F()
		f.Saldo = SaldoDeFactura(f.Total, f.Imputado)
		if f.Saldo > 0.009 {
			out = append(out, f)
		}
	}
	return out, filas.Err()
}

// PagoDeLaFactura es un pago que canceló (en todo o en parte) la factura.
type PagoDeLaFactura struct {
	PagoID     string    `json:"pagoId"`
	Fecha      time.Time `json:"fecha"`
	Medio      string    `json:"medio"`
	Referencia *string   `json:"referencia"`
	Aplicado   float64   `json:"aplicado"`
}

// RenglonDeLaFactura es un renglón de la mercadería que cubre la factura
// (el de la recepción vinculada: la factura de compra no tiene renglones
// propios, trae importes por alícuota).
type RenglonDeLaFactura struct {
	Producto      *string `json:"producto"`
	Variante      *string `json:"variante"`
	Cantidad      float64 `json:"cantidad"`
	CostoUnitario float64 `json:"costoUnitario"`
	AlicuotaIva   float64 `json:"alicuotaIva"`
}

// FichaDeFactura es la factura con sus importes, la mercadería y sus pagos.
type FichaDeFactura struct {
	ID               string     `json:"id"`
	Tipo             string     `json:"tipo"`
	PuntoVenta       int32      `json:"puntoVenta"`
	Numero           int32      `json:"numero"`
	FechaEmision     time.Time  `json:"fechaEmision"`
	FechaVencimiento *time.Time `json:"fechaVencimiento"`
	Cae              *string    `json:"cae"`
	Neto             float64    `json:"neto"`
	Iva21            float64    `json:"iva21"`
	Iva105           float64    `json:"iva105"`
	Iva27            float64    `json:"iva27"`
	Exento           float64    `json:"exento"`
	Percepciones     float64    `json:"percepciones"`
	PercepcionIva    float64    `json:"percepcionIva"`
	PercepcionIibb   float64    `json:"percepcionIibb"`
	Total            float64    `json:"total"`
	Pagado           float64    `json:"pagado"`
	Observaciones    *string    `json:"observaciones"`
	SupplierID       string     `json:"supplierId"`
	Proveedor        string     `json:"proveedor"`
	CondicionIva     string     `json:"condicionIva"`
	ReceiptID        *string    `json:"receiptId"`
	NumeroRemito     *string    `json:"numeroRemito"`
	CreatedAt        time.Time  `json:"createdAt"`
	AnuladaAt        *time.Time `json:"anuladaAt"`
	MotivoAnulacion  *string    `json:"motivoAnulacion"`
	// AplicaA es, de una nota de crédito, la factura a la que se aplicó.
	AplicaA   *string              `json:"aplicaA"`
	AplicaAID *string              `json:"aplicaAId"`
	Pagos     []PagoDeLaFactura    `json:"pagos"`
	Renglones []RenglonDeLaFactura `json:"renglones"`
}

// ObtenerFactura es la ficha de /admin/compras/facturas/[id]; nil si no está.
func (s *Servicio) ObtenerFactura(ctx context.Context, id string) (*FichaDeFactura, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var f FichaDeFactura
	var neto, i21, i105, i27, exento, perc, pIva, pIibb, total, pagado jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT f.id, f.tipo::text, f.punto_venta, f.numero, f.fecha_emision, f.fecha_vencimiento, f.cae, f.neto, f.iva21, f.iva105, f.iva27,
		  f.exento, f.percepciones, f.percepcion_iva, f.percepcion_iibb, f.total,
		  `+AplicadoA("f")+`,
		  f.observaciones, f.supplier_id, s.nombre, s.condicion_iva::text, f.receipt_id,
		  (SELECT string_agg(g.numero_remito, ' · ' ORDER BY g.fecha) FROM purchase_invoice_receipts x JOIN goods_receipts g ON g.id = x.goods_receipt_id
		   WHERE x.purchase_invoice_id = f.id),
		  f.created_at, f.anulada_at, f.motivo_anulacion,
		  (SELECT c.punto_venta || '-' || c.numero FROM purchase_invoices c WHERE c.id = f.aplica_a_id), f.aplica_a_id
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.id = $1`, id).Scan(&f.ID, &f.Tipo, &f.PuntoVenta, &f.Numero, &f.FechaEmision, &f.FechaVencimiento, &f.Cae, &neto, &i21, &i105, &i27,
		&exento, &perc, &pIva, &pIibb, &total, &pagado, &f.Observaciones, &f.SupplierID, &f.Proveedor, &f.CondicionIva, &f.ReceiptID,
		&f.NumeroRemito, &f.CreatedAt, &f.AnuladaAt, &f.MotivoAnulacion, &f.AplicaA, &f.AplicaAID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	f.Neto, f.Iva21, f.Iva105, f.Iva27 = float64(neto), float64(i21), float64(i105), float64(i27)
	f.Exento, f.Percepciones, f.PercepcionIva, f.PercepcionIibb = float64(exento), float64(perc), float64(pIva), float64(pIibb)
	f.Total, f.Pagado = float64(total), float64(pagado)
	filas, err := s.pool.Query(ctx, `
		SELECT p.id, p.fecha, p.medio, p.referencia, a.importe
		FROM supplier_payment_allocations a JOIN supplier_payments p ON p.id = a.payment_id
		WHERE a.purchase_invoice_id = $1 ORDER BY p.fecha`, id)
	if err != nil {
		return nil, err
	}
	f.Pagos, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (PagoDeLaFactura, error) {
		var p PagoDeLaFactura
		var importe jsmath.Num
		err := r.Scan(&p.PagoID, &p.Fecha, &p.Medio, &p.Referencia, &importe)
		p.Aplicado = float64(importe)
		return p, err
	})
	if err != nil {
		return nil, err
	}
	f.Renglones = []RenglonDeLaFactura{}
	if f.ReceiptID != nil {
		filas, err := s.pool.Query(ctx, `
			SELECT p.name, v.label, i.cantidad, i.costo_unitario, i.alicuota_iva
			FROM goods_receipt_items i JOIN goods_receipts g ON g.id = i.receipt_id
			LEFT JOIN product_variants v ON v.id = i.variant_id LEFT JOIN products p ON p.id = v.product_id
			WHERE i.receipt_id IN (SELECT goods_receipt_id FROM purchase_invoice_receipts WHERE purchase_invoice_id = $1)
			ORDER BY g.fecha, i.orden`, f.ID)
		if err != nil {
			return nil, err
		}
		f.Renglones, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (RenglonDeLaFactura, error) {
			var x RenglonDeLaFactura
			var cantidad, costo, alicuota jsmath.Num
			err := r.Scan(&x.Producto, &x.Variante, &cantidad, &costo, &alicuota)
			x.Cantidad, x.CostoUnitario, x.AlicuotaIva = float64(cantidad), float64(costo), float64(alicuota)
			return x, err
		})
		if err != nil {
			return nil, err
		}
	}
	return &f, nil
}

// cargoDeFactura es lo que una factura carga en la cuenta del proveedor: el
// total (en negativo si es nota de crédito) o, si cubre una recepción, solo
// la diferencia con lo que la recepción ya cargó. Devuelve el tipo de
// movimiento, el monto y el detalle.
func cargoDeFactura(tipo string, total float64, conRecepcion bool, yaCargado float64) (string, float64, string) {
	mov, monto, detalle := "factura", total, "Factura de compra"
	if strings.HasPrefix(tipo, "nota_credito") {
		mov, monto = "nota_credito", -total
	} else if strings.HasPrefix(tipo, "nota_debito") {
		mov = "nota_debito"
	}
	if conRecepcion {
		// Si la factura vino por menos, la diferencia baja la deuda.
		monto = float64(total - yaCargado)
		if yaCargado != 0 {
			detalle = "Factura de compra (diferencia con la recepción)"
		}
		if monto < 0 {
			mov = "ajuste"
		}
	}
	return mov, monto, detalle
}

// esCero es «no hay movimiento que anotar»: a centavos.
func esCero(monto float64) bool {
	t := jsmath.Fijo2(monto)
	return t == "0.00" || t == "-0.00"
}

// vencimientoDe es el vencimiento de la factura: el que se cargó a mano o la
// emisión más los días de pago del proveedor.
func vencimientoDe(d FormFactura, emision time.Time, dias int) (time.Time, error) {
	if d.FechaVencimiento == nil {
		return Vencimiento(emision, dias), nil
	}
	v, ok := LeerFecha(*d.FechaVencimiento)
	if !ok {
		return time.Time{}, plataforma.Invalido(map[string]string{"fechaVencimiento": "La fecha de vencimiento no es válida."})
	}
	if v.Before(emision) {
		return time.Time{}, fallo("El vencimiento no puede ser anterior a la fecha de la factura.")
	}
	return v, nil
}

// totalDeFactura es la suma de las partes: el total no se tipea.
func totalDeFactura(d FormFactura) float64 {
	return d.Neto + d.Iva21 + d.Iva105 + d.Iva27 + d.Exento + d.Percepciones
}

// errorDeFactura traduce los índices únicos a lo que se le dice a quien carga.
func errorDeFactura(err error) error {
	switch {
	case err == nil:
		return nil
	case strings.Contains(err.Error(), "purchase_invoices_numeracion_idx"):
		return fallo("Ese comprobante ya está cargado para este proveedor. Computarlo dos veces rompería el IVA del mes.")
	case strings.Contains(err.Error(), "purchase_invoices_receipt_idx"):
		return fallo("Esa recepción ya tiene una factura cargada.")
	case strings.Contains(err.Error(), "foreign key"):
		return fallo("Ese proveedor no existe.")
	}
	return err
}

// CargarFactura es cargarFacturaDeCompra: la factura y la deuda, en el mismo
// acto. El total no se pide: se suma.
//
// La factura puede venir vinculada a la recepción que cubre (receiptId). En
// ese caso carga en la cuenta solo la diferencia entre su total y lo que esa
// recepción ya cargó: antes la recepción cargaba la deuda y la factura la
// volvía a cargar, y una orden de $1.210 recibida y facturada dejaba $2.420.
// Lo «ya cargado» se lee de los movimientos atados a la recepción, así que
// esto anda igual si el contador dice que la deuda nace con la factura (ver
// LaDeudaNaceConElRemito): la recepción no carga nada y la factura, todo.
// El vínculo también resuelve el aviso «Recepciones sin factura» del cierre.
// Una recepción la cubre una sola factura; si un proveedor factura tres
// remitos juntos, se cargan sin vincular (y cargan el total, como antes).
//
// El movimiento de cuenta queda atado a la factura (purchase_invoice_id):
// así la ficha del proveedor lleva a ella y anularla devuelve justo eso.
func (s *Servicio) CargarFactura(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, string, error) {
	d, err := leerFactura(m)
	if err != nil {
		return "", "", err
	}
	total := totalDeFactura(d)
	if total <= 0 {
		return "", "", fallo("La factura no puede sumar cero.")
	}
	emision, ok := LeerFecha(d.FechaEmision)
	if !ok {
		return "", "", plataforma.Invalido(map[string]string{"fechaEmision": "La fecha no es válida."})
	}
	esCredito := strings.HasPrefix(d.Tipo, "nota_credito")
	recepciones := d.ReceiptIDs
	if d.ReceiptID != nil {
		recepciones = append([]string{*d.ReceiptID}, recepciones...)
	}
	if len(recepciones) > 0 && d.ReceiptID == nil {
		d.ReceiptID = &recepciones[0]
	}
	if d.AplicaA != nil && !esCredito {
		return "", "", fallo("Solo una nota de crédito se aplica a otra factura.")
	}
	var id string
	var ajuste ajusteDeCosto
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var yaCargado float64
		netoRecibido := 0.0
		if len(recepciones) > 0 && (esCredito || strings.HasPrefix(d.Tipo, "nota_debito")) {
			return fallo("Una nota de crédito o de débito no cubre una recepción: vinculá la factura.")
		}
		for _, r := range recepciones {
			var proveedor, estado string
			var neto jsmath.Num
			err := tx.QueryRow(ctx, `
				SELECT g.supplier_id, g.estado::text,
				  g.gastos + coalesce((SELECT sum(i.cantidad * i.costo_unitario) FROM goods_receipt_items i WHERE i.receipt_id = g.id), 0)
				FROM goods_receipts g WHERE g.id = $1 FOR UPDATE OF g`, r).Scan(&proveedor, &estado, &neto)
			if errors.Is(err, pgx.ErrNoRows) {
				return fallo("Esa recepción no existe.")
			}
			if err != nil {
				return err
			}
			if proveedor != d.SupplierID {
				return fallo("Esa recepción es de otro proveedor.")
			}
			if estado != "confirmada" {
				return fallo("Solo se vincula una recepción confirmada: esa está " + estado + ".")
			}
			ya, err := facturaDeRecepcion(ctx, tx, r)
			if err != nil {
				return err
			}
			if ya != "" {
				return fallo("Esa recepción ya tiene una factura cargada.")
			}
			cargado, err := cargadoPorRecepcion(ctx, tx, r)
			if err != nil {
				return err
			}
			if cargado != nil {
				yaCargado = float64(yaCargado + *cargado)
			}
			netoRecibido = float64(netoRecibido + neto.F())
		}
		var aplicaA *string
		if d.AplicaA != nil {
			if err := revisarAplicacion(ctx, tx, *d.AplicaA, d.SupplierID, total); err != nil {
				return err
			}
			aplicaA = d.AplicaA
		}
		dias := int32(0)
		if err := tx.QueryRow(ctx, `SELECT dias_pago FROM suppliers WHERE id = $1`, d.SupplierID).Scan(&dias); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		vence, err := vencimientoDe(d, emision, int(dias))
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, fecha_vencimiento, cae, neto, iva21, iva105, iva27,
			  exento, percepciones, total, observaciones, created_by_user_id, receipt_id, percepcion_iva, percepcion_iibb, aplica_a_id)
			VALUES ($1, $2::tipo_comprobante_compra, $3, $4, $5, $6, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12::numeric,
			  $13::numeric, $14::numeric, $15, $16, $17, $18::numeric, $19::numeric, $20) RETURNING id`,
			d.SupplierID, d.Tipo, int64(d.PuntoVenta), int64(d.Numero), emision, vence, d.Cae, jsmath.Fijo2(d.Neto),
			jsmath.Fijo2(d.Iva21), jsmath.Fijo2(d.Iva105), jsmath.Fijo2(d.Iva27), jsmath.Fijo2(d.Exento), jsmath.Fijo2(d.Percepciones),
			jsmath.Fijo2(total), d.Observaciones, ses.UserID, d.ReceiptID, jsmath.Fijo2(d.PercepcionIva), jsmath.Fijo2(d.PercepcionIibb),
			aplicaA).Scan(&id); err != nil {
			return err
		}
		for _, r := range recepciones {
			if _, err := tx.Exec(ctx, `INSERT INTO purchase_invoice_receipts (purchase_invoice_id, goods_receipt_id) VALUES ($1, $2)`, id, r); err != nil {
				return err
			}
		}
		// La factura vino distinta de lo recibido y quien la carga aceptó la
		// diferencia: el costo de la mercadería pasa a lo facturado.
		if d.AjustarCosto && len(recepciones) > 0 {
			ajuste, err = pasarDiferenciaAlCosto(ctx, tx, ses, id, recepciones, jsmath.Redondear2(d.Neto-netoRecibido))
			if err != nil {
				return err
			}
		}
		tipo, monto, detalle := cargoDeFactura(d.Tipo, total, len(recepciones) > 0, yaCargado)
		if len(recepciones) > 0 && esCero(monto) {
			return nil
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, purchase_invoice_id)
			VALUES ($1, $2::tipo_movimiento_proveedor, $3::numeric, $4, $5, $6, $7)`,
			d.SupplierID, tipo, jsmath.Fijo2(monto), NumeroDeCompra(int64(d.PuntoVenta), int64(d.Numero)), detalle, ses.UserID, id)
		return err
	})
	if err != nil {
		return "", "", errorDeFactura(err)
	}
	desc := "Cargó una factura de compra por " + formato.Importe(total)
	if ajuste.variantes > 0 {
		desc += fmt.Sprintf("; pasó %s de diferencia al costo de %d productos", Monto(ajuste.diferencia), ajuste.variantes)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "factura_compra", id, desc, nil)
	return id, d.SupplierID, nil
}

// revisarAplicacion mira que una nota de crédito por `total` se pueda
// aplicar a la factura `factura`: del mismo proveedor, viva, que no sea otra
// nota de crédito y con saldo para cubrirla. La deja bloqueada.
func revisarAplicacion(ctx context.Context, tx pgx.Tx, factura, proveedor string, total float64) error {
	var dueno, tipo string
	var anulada bool
	var ftotal, aplicado jsmath.Num
	err := tx.QueryRow(ctx, `SELECT f.supplier_id, f.tipo::text, f.anulada_at IS NOT NULL, f.total, `+AplicadoA("f")+`
		FROM purchase_invoices f WHERE f.id = $1 FOR UPDATE`, factura).Scan(&dueno, &tipo, &anulada, &ftotal, &aplicado)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && dueno != proveedor {
		return fallo("Esa factura no es de este proveedor.")
	}
	if err != nil {
		return err
	}
	if anulada {
		return fallo("Esa factura está anulada.")
	}
	if strings.HasPrefix(tipo, "nota_credito") {
		return fallo("Una nota de crédito se aplica a una factura, no a otra nota de crédito.")
	}
	saldo := SaldoDeFactura(ftotal.F(), aplicado.F())
	if total-saldo > 0.009 {
		return fallo("La nota de crédito es de " + Monto(total) + " y a esa factura le faltan " + Monto(saldo) + ".")
	}
	return nil
}

// AplicarNotaDeCredito aplica una nota de crédito ya cargada, que había
// quedado a favor, a una factura del mismo proveedor con saldo.
func (s *Servicio) AplicarNotaDeCredito(ctx context.Context, ses *auth.Sesion, nota, factura string) (string, error) {
	if !plataforma.UUIDValido(nota) || !plataforma.UUIDValido(factura) {
		return "", fallo("Esa factura no existe.")
	}
	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		f, err := bloquearFactura(ctx, tx, nota)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(f.tipo, "nota_credito") {
			return fallo("Solo una nota de crédito se aplica a otra factura.")
		}
		if f.anulada {
			return fallo("Esa nota de crédito está anulada.")
		}
		var ya *string
		if err := tx.QueryRow(ctx, `SELECT aplica_a_id FROM purchase_invoices WHERE id = $1`, nota).Scan(&ya); err != nil {
			return err
		}
		if ya != nil {
			return fallo("Esa nota de crédito ya está aplicada.")
		}
		if err := revisarAplicacion(ctx, tx, factura, f.supplierID, f.total); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT punto_venta || '-' || numero FROM purchase_invoices WHERE id = $1`, factura).Scan(&numero); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `UPDATE purchase_invoices SET aplica_a_id = $2, updated_at = now() WHERE id = $1`, nota, factura)
		return err
	})
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "factura_compra", nota, "Aplicó la nota de crédito a la factura "+numero, nil)
	return "Nota de crédito aplicada a la factura " + numero + ".", nil
}

// ajusteDeCosto es lo que hizo pasarDiferenciaAlCosto.
type ajusteDeCosto struct {
	diferencia float64
	variantes  int
}

// pasarDiferenciaAlCosto reparte la diferencia entre el neto facturado y
// el recibido (mes simulado, H195: el proveedor facturó el tirante a $21.300
// y el costo siguió en $20.800) entre los renglones de las recepciones, en
// proporción a lo que valía cada uno, y la suma al valor del stock de cada
// variante: el costo promedio sube (o baja) lo que le toca dividido lo que
// hay. El costo no se revierte nunca, así que solo se hace si quien carga la
// factura lo eligió; queda en el historial del costo atado a la factura.
func pasarDiferenciaAlCosto(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, factura string, recepciones []string, diferencia float64) (ajusteDeCosto, error) {
	out := ajusteDeCosto{diferencia: diferencia}
	if esCero(diferencia) {
		return out, nil
	}
	filas, err := tx.Query(ctx, `
		SELECT i.variant_id, sum(i.cantidad * i.costo_unitario) FROM goods_receipt_items i
		WHERE i.receipt_id = ANY($1::uuid[]) GROUP BY i.variant_id ORDER BY i.variant_id`, recepciones)
	if err != nil {
		return out, err
	}
	type parte struct {
		variante string
		valor    float64
	}
	partes, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (parte, error) {
		var p parte
		var v jsmath.Num
		err := r.Scan(&p.variante, &v)
		p.valor = v.F()
		return p, err
	})
	if err != nil {
		return out, err
	}
	base := 0.0
	for _, p := range partes {
		base += p.valor
	}
	if !(base > 0) {
		return out, nil
	}
	for _, p := range partes {
		var cantidad, costo jsmath.Num
		err := tx.QueryRow(ctx, `SELECT cantidad_base, costo_promedio FROM variant_costs WHERE variant_id = $1 FOR UPDATE`, p.variante).Scan(&cantidad, &costo)
		if errors.Is(err, pgx.ErrNoRows) || err == nil && !(cantidad.F() > 0) {
			continue
		}
		if err != nil {
			return out, err
		}
		cuota := float64(diferencia*p.valor) / base
		nuevo := math.Max(0, float64(costo.F()+cuota/cantidad.F()))
		if _, err := tx.Exec(ctx, `UPDATE variant_costs SET costo_promedio = $2::numeric WHERE variant_id = $1`, p.variante, jsmath.ToFixed(nuevo, 4)); err != nil {
			return out, err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO cost_history (variant_id, costo_anterior, costo_nuevo, cantidad_anterior, cantidad_nueva, documento_tipo, documento_id, motivo, created_by_user_id)
			VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $4::numeric, 'factura_compra', $5, 'Diferencia de la factura con lo recibido', $6)`,
			p.variante, jsmath.ToFixed(costo.F(), 4), jsmath.ToFixed(nuevo, 4), jsmath.ToFixed(cantidad.F(), 4), factura, ses.UserID); err != nil {
			return out, err
		}
		out.variantes++
	}
	return out, nil
}

// facturaBloqueada es lo que la corrección y la anulación leen de la factura,
// con la fila tomada (FOR UPDATE: un pago que la imputa a la vez espera).
type facturaBloqueada struct {
	supplierID, proveedor, tipo string
	puntoVenta, numero          int32
	total, pagado               float64
	receiptID                   *string
	anulada                     bool
}

func bloquearFactura(ctx context.Context, tx pgx.Tx, id string) (facturaBloqueada, error) {
	var f facturaBloqueada
	var total jsmath.Num
	var anulada *time.Time
	err := tx.QueryRow(ctx, `
		SELECT f.supplier_id, s.nombre, f.tipo::text, f.punto_venta, f.numero, f.total, f.receipt_id, f.anulada_at
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id WHERE f.id = $1 FOR UPDATE OF f`, id).
		Scan(&f.supplierID, &f.proveedor, &f.tipo, &f.puntoVenta, &f.numero, &total, &f.receiptID, &anulada)
	if errors.Is(err, pgx.ErrNoRows) {
		return f, fallo("Esa factura no existe.")
	}
	if err != nil {
		return f, err
	}
	f.total, f.anulada = float64(total), anulada != nil
	var pagado jsmath.Num
	if err := tx.QueryRow(ctx, `SELECT `+AplicadoA("f")+` FROM purchase_invoices f WHERE f.id = $1`, id).
		Scan(&pagado); err != nil {
		return f, err
	}
	f.pagado = float64(pagado)
	return f, nil
}

// loQueCargo es lo que la factura movió en la cuenta del proveedor: la suma
// de sus movimientos. Las cargadas antes de la 00101 que la migración no
// pudo atar a su movimiento no tienen ninguno: se reconstruye con la misma
// regla del alta.
func loQueCargo(ctx context.Context, tx pgx.Tx, id string, f facturaBloqueada) (float64, error) {
	var suma *jsmath.Num
	var cuantos int
	if err := tx.QueryRow(ctx, `SELECT sum(monto), count(*)::int FROM supplier_movements WHERE purchase_invoice_id = $1`, id).
		Scan(&suma, &cuantos); err != nil {
		return 0, err
	}
	if cuantos > 0 {
		return numOCero(suma), nil
	}
	ya, err := cargadoPorSusRecepciones(ctx, tx, id, f.receiptID)
	if err != nil {
		return 0, err
	}
	_, monto, _ := cargoDeFactura(f.tipo, f.total, f.receiptID != nil, ya)
	return monto, nil
}

// cargadoPorSusRecepciones es lo que cargaron en la cuenta todas las
// recepciones que cubre la factura (una o varias, H199).
func cargadoPorSusRecepciones(ctx context.Context, tx pgx.Tx, factura string, primera *string) (float64, error) {
	var n *jsmath.Num
	if err := tx.QueryRow(ctx, `
		SELECT sum(m.monto) FROM supplier_movements m
		WHERE m.goods_receipt_id IN (SELECT goods_receipt_id FROM purchase_invoice_receipts WHERE purchase_invoice_id = $1
		                             UNION SELECT $2::uuid WHERE $2::uuid IS NOT NULL)`, factura, primera).Scan(&n); err != nil {
		return 0, err
	}
	return numOCero(n), nil
}

// CorregirFactura cambia los datos de una factura cargada mal (el número,
// las fechas, los importes, el tipo) sin anularla. Si el total cambia, la
// diferencia va a la cuenta del proveedor como un ajuste atado a la factura;
// el libro IVA la lee de la factura, así que se corrige solo.
//
// No cambia el proveedor ni la recepción vinculada: eso es otra factura, y se
// anula y se carga de nuevo. Tampoco baja el total por debajo de lo que ya se
// le pagó.
func (s *Servicio) CorregirFactura(ctx context.Context, ses *auth.Sesion, id string, m map[string]any) (string, error) {
	motivo, _ := m["motivo"].(string)
	motivo = trimJS(motivo)
	if motivo == "" {
		return "", fallo("Poné el motivo: una corrección sin explicación no se puede revisar después.")
	}
	if !plataforma.UUIDValido(id) {
		return "", fallo("Esa factura no existe.")
	}
	d, err := leerFactura(m)
	if err != nil {
		return "", err
	}
	total := totalDeFactura(d)
	if total <= 0 {
		return "", fallo("La factura no puede sumar cero.")
	}
	emision, ok := LeerFecha(d.FechaEmision)
	if !ok {
		return "", plataforma.Invalido(map[string]string{"fechaEmision": "La fecha no es válida."})
	}
	var antes facturaBloqueada
	var diferencia float64
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		f, err := bloquearFactura(ctx, tx, id)
		if err != nil {
			return err
		}
		antes = f
		if f.anulada {
			return fallo("Esa factura está anulada: no se corrige.")
		}
		if d.SupplierID != f.supplierID {
			return fallo("Para cambiarle el proveedor, anulá la factura y cargala de nuevo.")
		}
		if f.receiptID != nil && (strings.HasPrefix(d.Tipo, "nota_credito") || strings.HasPrefix(d.Tipo, "nota_debito")) {
			return fallo("Una nota de crédito o de débito no cubre una recepción: la factura está vinculada a una.")
		}
		if f.pagado > 0 && strings.HasPrefix(d.Tipo, "nota_credito") {
			return fallo("Esa factura ya tiene pagos aplicados: no puede pasar a ser una nota de crédito.")
		}
		if f.pagado-total > 0.01 {
			return fallo("Ya se le pagaron " + Monto(f.pagado) + " a esta factura: el total no puede quedar por debajo.")
		}
		cargado, err := loQueCargo(ctx, tx, id, f)
		if err != nil {
			return err
		}
		ya, err := cargadoPorSusRecepciones(ctx, tx, id, f.receiptID)
		if err != nil {
			return err
		}
		_, nuevo, _ := cargoDeFactura(d.Tipo, total, f.receiptID != nil, ya)
		diferencia = jsmath.Redondear2(nuevo - cargado)
		var dias int32
		if err := tx.QueryRow(ctx, `SELECT dias_pago FROM suppliers WHERE id = $1`, f.supplierID).Scan(&dias); err != nil {
			return err
		}
		vence, err := vencimientoDe(d, emision, int(dias))
		if err != nil {
			return err
		}
		percepcionIva, percepcionIibb := "percepcion_iva", "percepcion_iibb"
		if d.conPercepciones {
			percepcionIva, percepcionIibb = jsmath.Fijo2(d.PercepcionIva)+"::numeric", jsmath.Fijo2(d.PercepcionIibb)+"::numeric"
		}
		if _, err := tx.Exec(ctx, `
			UPDATE purchase_invoices SET tipo = $2::tipo_comprobante_compra, punto_venta = $3, numero = $4, fecha_emision = $5,
			  fecha_vencimiento = $6, cae = $7, neto = $8::numeric, iva21 = $9::numeric, iva105 = $10::numeric, iva27 = $11::numeric,
			  exento = $12::numeric, percepciones = $13::numeric, total = $14::numeric, observaciones = $15,
			  percepcion_iva = `+percepcionIva+`, percepcion_iibb = `+percepcionIibb+`, updated_at = now()
			WHERE id = $1`,
			id, d.Tipo, int64(d.PuntoVenta), int64(d.Numero), emision, vence, d.Cae, jsmath.Fijo2(d.Neto), jsmath.Fijo2(d.Iva21),
			jsmath.Fijo2(d.Iva105), jsmath.Fijo2(d.Iva27), jsmath.Fijo2(d.Exento), jsmath.Fijo2(d.Percepciones), jsmath.Fijo2(total),
			d.Observaciones); err != nil {
			return err
		}
		if esCero(diferencia) {
			return nil
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, purchase_invoice_id)
			VALUES ($1, 'ajuste', $2::numeric, $3, $4, $5, $6)`,
			f.supplierID, jsmath.Fijo2(diferencia), NumeroDeCompra(int64(d.PuntoVenta), int64(d.Numero)),
			"Corrección de la factura: "+motivo, ses.UserID, id)
		return err
	})
	if err != nil {
		return "", errorDeFactura(err)
	}
	numero := NumeroDeCompra(int64(antes.puntoVenta), int64(antes.numero))
	desc := "Corrigió la factura " + numero + " de " + antes.proveedor + " (" + motivo + ")"
	if !esCero(diferencia) {
		desc += "; total de " + Monto(antes.total) + " a " + Monto(total)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "factura_compra", id, desc, struct {
		Motivo     string  `json:"motivo"`
		TotalAntes float64 `json:"totalAntes"`
		Total      float64 `json:"total"`
	}{motivo, antes.total, total})
	if esCero(diferencia) {
		return "Factura corregida.", nil
	}
	return "Factura corregida: la cuenta de " + antes.proveedor + " se ajustó en " + Monto(diferencia) + ".", nil
}

// AnularFactura deshace una factura cargada por error, con el molde de
// AnularPago: la factura queda (con su motivo) pero deja de contar.
//
//   - La cuenta del proveedor vuelve con un ajuste por lo que la factura
//     cargó (el total o, si cubría una recepción, la diferencia: la deuda de
//     la recepción queda).
//   - Sale del libro IVA compras (lo lee filtrando las anuladas).
//   - Los pagos que la cancelaban no se tocan: se les sacan las
//     aplicaciones a esta factura y quedan a cuenta, para aplicarlos a otra.
//   - La recepción vinculada queda libre para la factura correcta.
//   - El número queda libre: la correcta se carga con el mismo.
func (s *Servicio) AnularFactura(ctx context.Context, ses *auth.Sesion, id, motivo string) (string, error) {
	motivo = trimJS(motivo)
	if motivo == "" {
		return "", fallo("Poné el motivo: una anulación sin explicación no se puede revisar después.")
	}
	if !plataforma.UUIDValido(id) {
		return "", fallo("Esa factura no existe.")
	}
	var f facturaBloqueada
	var cargado float64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		f, err = bloquearFactura(ctx, tx, id)
		if err != nil {
			return err
		}
		if f.anulada {
			return fallo("Esa factura ya estaba anulada.")
		}
		cargado, err = loQueCargo(ctx, tx, id, f)
		if err != nil {
			return err
		}
		// Con pagos aplicados, lo que dice Reglas del negocio: quedan a cuenta
		// del proveedor (lo de siempre) o la anulación se frena hasta anular
		// esos pagos.
		var aplicado jsmath.Num
		if err := tx.QueryRow(ctx, `SELECT coalesce(sum(importe), 0) FROM supplier_payment_allocations WHERE purchase_invoice_id = $1`,
			id).Scan(&aplicado); err != nil {
			return err
		}
		if aplicado.F() > 0.005 {
			var regla string
			_ = tx.QueryRow(ctx, `SELECT valor FROM site_settings WHERE clave = 'anular_compra_con_pagos'`).Scan(&regla)
			if regla == "bloquear" {
				return fallo("Esta factura tiene " + Monto(aplicado.F()) + " pagados: anulá primero esos pagos.")
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM supplier_payment_allocations WHERE purchase_invoice_id = $1`, id); err != nil {
			return err
		}
		if !esCero(cargado) {
			if _, err := tx.Exec(ctx, `
				INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, purchase_invoice_id)
				VALUES ($1, 'ajuste', $2::numeric, $3, $4, $5, $6)`,
				f.supplierID, jsmath.Fijo2(-cargado), NumeroDeCompra(int64(f.puntoVenta), int64(f.numero)),
				"Anulación de la factura: "+motivo, ses.UserID, id); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(ctx, `DELETE FROM purchase_invoice_receipts WHERE purchase_invoice_id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE purchase_invoices SET aplica_a_id = NULL, updated_at = now() WHERE aplica_a_id = $1`, id); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE purchase_invoices SET anulada_at = now(), motivo_anulacion = $2, anulada_por_user_id = $3, receipt_id = NULL,
			  aplica_a_id = NULL, updated_at = now()
			WHERE id = $1`, id, motivo, ses.UserID)
		return err
	})
	if err != nil {
		return "", err
	}
	numero := NumeroDeCompra(int64(f.puntoVenta), int64(f.numero))
	desc := "Anuló la factura " + numero + " de " + f.proveedor + " por " + Monto(f.total) + " (" + motivo + ")"
	if f.receiptID != nil {
		desc += "; cubría la recepción " + *f.receiptID
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaAnular, "factura_compra", id, desc, struct {
		Motivo    string  `json:"motivo"`
		Devuelto  float64 `json:"devuelto"`
		Liberado  float64 `json:"liberado"`
		Recepcion *string `json:"recepcion"`
	}{motivo, cargado, f.pagado, f.receiptID})
	ok := "Factura anulada: salió del libro IVA"
	if !esCero(cargado) {
		ok += " y la cuenta de " + f.proveedor + " bajó " + Monto(math.Abs(cargado))
		if cargado < 0 {
			ok = "Factura anulada: salió del libro IVA y la cuenta de " + f.proveedor + " volvió a subir " + Monto(math.Abs(cargado))
		}
	}
	ok += "."
	if f.pagado > 0.009 {
		ok += " Los " + Monto(f.pagado) + " que se le habían pagado quedaron a cuenta, sin aplicar."
	}
	return ok, nil
}

// diaArgentino es el aaaa-mm-dd argentino de un instante.
func diaArgentino(t time.Time) string { return t.In(fiscal.Argentina).Format("2006-01-02") }

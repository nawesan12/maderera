package compras

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/caja"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Los gastos del negocio (lib/dal/admin/gastos.ts). Un gasto en efectivo
// también sale de la caja del turno que lo contiene (caja.TurnoQueContiene,
// la misma regla que una venta sin conexión).

// etiquetaDeCircuito es la de lib/circuito.ts.
func etiquetaDeCircuito(c string) string {
	switch c {
	case "blanco":
		return "Facturas"
	case "negro":
		return "B"
	}
	return c
}

// CargarGasto es cargarGasto + registrarGasto. Devuelve el mensaje y el aviso
// (si era efectivo y no había turno donde cargarlo).
func (s *Servicio) CargarGasto(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, string, error) {
	d, err := leerGasto(m)
	if err != nil {
		return "", "", err
	}
	fecha, ok := LeerFecha(d.Fecha)
	if !ok {
		return "", "", plataforma.Invalido(map[string]string{"fecha": "La fecha no es válida."})
	}
	for _, id := range []*string{d.BranchID, d.SupplierID} {
		if id != nil && !plataforma.UUIDValido(*id) {
			return "", "", fallo("La sucursal o el proveedor no existen.")
		}
	}
	descripcion := trimJS(d.Descripcion)
	// El efectivo sale de una caja (mes simulado, H264/H351): sin decir de
	// cuál, o sin turno que lo contenga, el gasto salía «de la Caja» del CSV
	// del contador y de ningún arqueo. Ahora se frena y se dice por qué.
	if d.Medio == "efectivo" && d.BranchID == nil {
		return "", "", plataforma.Invalido(map[string]string{"branchId": "Elegí de qué caja salió el efectivo."})
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var factura *string
		if d.Factura != nil {
			id, err := facturaDelGasto(ctx, tx, ses, d, fecha)
			if err != nil {
				return err
			}
			factura = &id
		}
		var gasto string
		if err := tx.QueryRow(ctx, `
			INSERT INTO expenses (fecha, categoria, descripcion, importe, medio, circuito, branch_id, supplier_id, notas, created_by_user_id, purchase_invoice_id)
			VALUES ($1, $2::categoria_gasto, $3, $4::numeric, $5::medio_gasto, $6::circuito, $7, $8, $9, $10, $11) RETURNING id`,
			fecha, d.Categoria, descripcion, jsmath.Fijo2(d.Importe), d.Medio, d.Circuito, d.BranchID, d.SupplierID, d.Notas, ses.UserID, factura).Scan(&gasto); err != nil {
			return err
		}
		// Solo el efectivo toca la caja.
		if d.Medio != "efectivo" {
			return nil
		}
		turno, momento, hay, err := turnoDelGasto(ctx, tx, *d.BranchID, d.Fecha, time.Now())
		if err != nil {
			return err
		}
		if !hay {
			var nombre string
			_ = tx.QueryRow(ctx, `SELECT name FROM branches WHERE id = $1`, *d.BranchID).Scan(&nombre)
			return fallo("No había caja abierta en " + nombre + " ese día: el efectivo no sale de ningún turno. Anotalo con el medio con que se pagó, o con la caja abierta.")
		}
		// Como un retiro: el cajón no queda por debajo del cambio fijo
		// (mes simulado, H376: un flete de $48.000 dejó $2.000 con un cambio
		// de $50.000, sin ningún aviso).
		var base, enCaja jsmath.Num
		if err := tx.QueryRow(ctx, `
			SELECT b.fondo_base, coalesce((SELECT sum(m.monto) FROM cash_movements m WHERE m.session_id = s.id), 0)
			FROM cash_sessions s JOIN branches b ON b.id = s.branch_id WHERE s.id = $1 FOR UPDATE OF s`, turno).Scan(&base, &enCaja); err != nil {
			return err
		}
		if ok, motivo := AlcanzaElCajon(enCaja.F(), base.F(), d.Importe); !ok {
			return fallo(motivo)
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO cash_movements (session_id, tipo, monto, motivo, expense_id, creado_por, created_at)
			VALUES ($1, 'gasto', $2::numeric, $3, $4, $5, $6)`, turno, jsmath.Fijo2(-d.Importe), descripcion, gasto, ses.UserID, momento)
		return err
	})
	if err != nil {
		return "", "", errorDeFactura(err)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "gasto", "",
		"Anotó un gasto de "+Monto(d.Importe)+" en "+d.Categoria+" ("+etiquetaDeCircuito(d.Circuito)+"): "+d.Descripcion, nil)
	return "Gasto anotado por " + Monto(d.Importe) + ".", "", nil
}

// AlcanzaElCajon dice si de un cajón con `enCaja` se pueden sacar `importe`
// sin bajar del cambio fijo `base` (la regla del retiro del mostrador), y si
// no, por qué. Sin cambio fijo, el piso es cero: con `fondo_base` en 0 el
// control no corría y un gasto podía dejar el cajón en negativo (mes
// simulado).
func AlcanzaElCajon(enCaja, base, importe float64) (bool, string) {
	piso := max(base, 0)
	if float64(enCaja-importe)-piso >= -0.009 {
		return true, ""
	}
	disponible := max(0, jsmath.Redondear2(enCaja-piso))
	switch {
	case piso > 0 && disponible > 0:
		return false, "Deja el cajón sin el cambio fijo (" + Monto(base) + "): de esa caja salen hasta " + Monto(disponible) + "."
	case piso > 0:
		return false, "En el cajón hay " + Monto(enCaja) + " y el cambio fijo es " + Monto(base) + ": de esa caja no sale."
	case disponible > 0:
		return false, "En el cajón hay " + Monto(enCaja) + ": de esa caja salen hasta " + Monto(disponible) + "."
	}
	return false, "En el cajón de esa caja no hay efectivo."
}

// facturaDelGasto carga la factura de compra del gasto: entra al libro IVA
// compras con su crédito fiscal y nace pagada (el gasto es el pago, así que
// no suma deuda en la cuenta del proveedor ni aparece en lo que hay que
// pagar: compras.AplicadoA la da por cancelada).
func facturaDelGasto(ctx context.Context, tx pgx.Tx, ses *auth.Sesion, d FormGasto, fecha time.Time) (string, error) {
	x := d.Factura
	iva := jsmath.Redondear2(float64(x.Iva21+x.Iva105) + x.Iva27)
	neto := jsmath.Redondear2(float64(d.Importe-iva) - x.Percepciones)
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO purchase_invoices (supplier_id, tipo, punto_venta, numero, fecha_emision, fecha_vencimiento, neto, iva21, iva105, iva27,
		  exento, percepciones, total, observaciones, created_by_user_id)
		VALUES ($1, $2::tipo_comprobante_compra, $3, $4, $5, $5, $6::numeric, $7::numeric, $8::numeric, $9::numeric, 0, $10::numeric, $11::numeric,
		  $12, $13) RETURNING id`,
		*d.SupplierID, x.Tipo, int64(x.PuntoVenta), int64(x.Numero), fecha, jsmath.Fijo2(neto), jsmath.Fijo2(x.Iva21), jsmath.Fijo2(x.Iva105),
		jsmath.Fijo2(x.Iva27), jsmath.Fijo2(x.Percepciones), jsmath.Fijo2(d.Importe), "Gasto: "+trimJS(d.Descripcion), ses.UserID).Scan(&id)
	return id, err
}

// turnoDelGasto es el turno de la sucursal del que sale un gasto en efectivo
// del día `dia` (aaaa-mm-dd, un día argentino), y el momento en que se anota
// el movimiento de caja.
//
// Bug arreglado: el turno se buscaba con la fecha del formulario, que es la
// medianoche UTC (las 21 del día anterior en Argentina). Un gasto de hoy
// nunca caía en el turno abierto a la mañana, no salía de la caja y el
// arqueo mostraba un faltante. Ahora, si el día es hoy, sale del turno que
// está abierto ahora; si es otro día, del último turno que estuvo abierto
// en algún momento de ese día argentino.
func turnoDelGasto(ctx context.Context, tx pgx.Tx, sucursal, dia string, ahora time.Time) (string, time.Time, bool, error) {
	d, err := time.ParseInLocation("2006-01-02", dia, caja.Argentina)
	if err != nil {
		// Vino con hora (un instante): se busca el turno de ese instante.
		f, ok := LeerFecha(dia)
		if !ok {
			return "", time.Time{}, false, nil
		}
		id, hay, err := caja.TurnoQueContiene(ctx, tx, sucursal, f)
		return id, f, hay, err
	}
	if d.Equal(caja.InicioDelDia(ahora)) {
		id, hay, err := caja.TurnoQueContiene(ctx, tx, sucursal, ahora)
		return id, ahora, hay, err
	}
	fin := d.AddDate(0, 0, 1)
	var id string
	var abierta time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, abierta_at FROM cash_sessions
		WHERE branch_id = $1 AND abierta_at < $3 AND (cerrada_at IS NULL OR cerrada_at >= $2)
		ORDER BY abierta_at DESC LIMIT 1`, sucursal, d, fin).Scan(&id, &abierta)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	// El movimiento se fecha adentro del turno y del día.
	momento := d
	if abierta.After(momento) {
		momento = abierta
	}
	return id, momento, true, nil
}

// Gasto es una fila del listado.
type Gasto struct {
	ID          string    `json:"id"`
	Fecha       time.Time `json:"fecha"`
	Categoria   string    `json:"categoria"`
	Descripcion string    `json:"descripcion"`
	Importe     string    `json:"importe"`
	Medio       string    `json:"medio"`
	Circuito    string    `json:"circuito"`
	ConFactura  bool      `json:"conFactura"`
	Sucursal    *string   `json:"sucursal"`
	Proveedor   *string   `json:"proveedor"`
	SupplierID  *string   `json:"supplierId"`
	Notas       *string   `json:"notas"`
	EnCaja      bool      `json:"enCaja"`
	// La factura del gasto, si se cargó con una.
	PurchaseInvoiceID *string `json:"purchaseInvoiceId"`
	Factura           *string `json:"factura"`
	// Anulado: sigue en el listado, apagado, y no cuenta en ningún total.
	AnuladoAt       *time.Time `json:"anuladoAt"`
	MotivoAnulacion *string    `json:"motivoAnulacion"`
}

// ListarGastos es listarGastos: los del período, los más nuevos primero.
func (s *Servicio) ListarGastos(ctx context.Context, desde, hasta time.Time, limite int) ([]Gasto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT e.id, e.fecha, e.categoria::text, e.descripcion, e.importe::text, e.medio::text, e.circuito::text, e.purchase_invoice_id IS NOT NULL,
		  b.name, s.nombre, e.supplier_id, e.notas, EXISTS (SELECT 1 FROM cash_movements m WHERE m.expense_id = e.id),
		  e.purchase_invoice_id, CASE WHEN f.id IS NOT NULL THEN lpad(f.punto_venta::text, 4, '0') || '-' || lpad(f.numero::text, 8, '0') END,
		  e.anulado_at, e.motivo_anulacion
		FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN suppliers s ON s.id = e.supplier_id
		LEFT JOIN purchase_invoices f ON f.id = e.purchase_invoice_id
		WHERE e.fecha >= $1 AND e.fecha <= $2 ORDER BY e.fecha DESC LIMIT $3`, desde, hasta, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Gasto])
}

// TotalDeGastos es cuánto se gastó en una categoría o un circuito.
type TotalDeGastos struct {
	Clave    string `json:"clave"`
	Cantidad int    `json:"cantidad"`
	Total    string `json:"total"`
}

// GastosPorCategoria es gastosPorCategoria (lo más gastado primero).
func (s *Servicio) GastosPorCategoria(ctx context.Context, desde, hasta time.Time) ([]TotalDeGastos, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT categoria::text, count(*)::int, sum(importe)::text FROM expenses WHERE fecha >= $1 AND fecha <= $2 AND anulado_at IS NULL
		GROUP BY categoria ORDER BY sum(importe) DESC`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[TotalDeGastos])
}

// GastosPorCircuito es gastosPorCircuito.
func (s *Servicio) GastosPorCircuito(ctx context.Context, desde, hasta time.Time) ([]TotalDeGastos, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT circuito::text, count(*)::int, sum(importe)::text FROM expenses WHERE fecha >= $1 AND fecha <= $2 AND anulado_at IS NULL GROUP BY circuito`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[TotalDeGastos])
}

// SucursalParaGasto es una sucursal activa con su turno abierto, si hay.
type SucursalParaGasto struct {
	ID           string  `json:"id"`
	Nombre       string  `json:"nombre"`
	TurnoAbierto *string `json:"turnoAbierto"`
	// DeLaSesion: el turno abierto lo abrió quien está mirando. El usuario
	// del panel no tiene una sucursal asignada; la caja que abrió hoy es lo
	// más parecido, y es la que proponen los formularios de compras.
	DeLaSesion bool `json:"deLaSesion"`
	// EnCaja es el efectivo del turno abierto y CambioFijo lo que tiene que
	// quedar: el gasto en efectivo muestra cuánto hay (mes simulado, H376).
	EnCaja     *float64 `json:"enCaja"`
	CambioFijo float64  `json:"cambioFijo"`
}

// SucursalesParaGasto es sucursalesParaGasto: las activas, en su orden.
func (s *Servicio) SucursalesParaGasto(ctx context.Context, usuario string) ([]SucursalParaGasto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT b.id, b.name, c.id, coalesce(c.abierta_por = $1, false),
		  CASE WHEN c.id IS NOT NULL THEN (SELECT coalesce(sum(m.monto), 0)::float8 FROM cash_movements m WHERE m.session_id = c.id) END,
		  b.fondo_base::float8
		FROM branches b
		LEFT JOIN cash_sessions c ON c.branch_id = b.id AND c.estado = 'abierta'
		WHERE b.active ORDER BY b.sort_order`, usuario)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[SucursalParaGasto])
}

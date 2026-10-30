package compras

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// RecepcionListada es una fila del listado.
type RecepcionListada struct {
	ID           string    `json:"id"`
	NumeroRemito *string   `json:"numeroRemito"`
	Fecha        time.Time `json:"fecha"`
	Estado       string    `json:"estado"`
	Gastos       string    `json:"gastos"`
	Proveedor    string    `json:"proveedor"`
	SupplierID   string    `json:"supplierId"`
	Sucursal     *string   `json:"sucursal"`
	Lineas       int       `json:"lineas"`
	Neto         float64   `json:"neto"`
	// Facturada dice si ya hay una factura de compra vinculada.
	Facturada bool `json:"facturada"`
}

// ListarRecepciones es listarRecepciones: el neto de las líneas más el flete.
func (s *Servicio) ListarRecepciones(ctx context.Context, limite int) ([]RecepcionListada, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT r.id, r.numero_remito, r.fecha, r.estado::text, r.gastos::text, s.nombre, r.supplier_id, b.name, coalesce(t.lineas, 0), t.neto, r.gastos,
		  EXISTS (SELECT 1 FROM purchase_invoices f WHERE f.receipt_id = r.id)
		FROM goods_receipts r
		JOIN suppliers s ON s.id = r.supplier_id
		LEFT JOIN branches b ON b.id = r.branch_id
		LEFT JOIN (SELECT receipt_id, count(*)::int AS lineas, sum(cantidad * costo_unitario) AS neto FROM goods_receipt_items GROUP BY receipt_id) t
		  ON t.receipt_id = r.id
		ORDER BY r.fecha DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (RecepcionListada, error) {
		var x RecepcionListada
		var neto *jsmath.Num
		var gastos jsmath.Num
		err := r.Scan(&x.ID, &x.NumeroRemito, &x.Fecha, &x.Estado, &x.Gastos, &x.Proveedor, &x.SupplierID, &x.Sucursal, &x.Lineas, &neto, &gastos, &x.Facturada)
		x.Neto = numOCero(neto) + float64(gastos)
		return x, err
	})
}

// LineaDeRecepcion es una línea con la cuenta del costo, si ya se confirmó.
type LineaDeRecepcion struct {
	ID               string  `json:"id"`
	VariantID        string  `json:"variantId"`
	Producto         *string `json:"producto"`
	Variante         *string `json:"variante"`
	Sku              *string `json:"sku"`
	Cantidad         string  `json:"cantidad"`
	CostoUnitario    string  `json:"costoUnitario"`
	AlicuotaIva      string  `json:"alicuotaIva"`
	CostoConGastos   *string `json:"costoConGastos"`
	CantidadAnterior *string `json:"cantidadAnterior"`
	CostoAnterior    *string `json:"costoAnterior"`
	CostoResultante  *string `json:"costoResultante"`
	Orden            int32   `json:"orden"`
}

// Recepcion es una recepción con sus líneas.
type Recepcion struct {
	ID           string             `json:"id"`
	NumeroRemito *string            `json:"numeroRemito"`
	Fecha        time.Time          `json:"fecha"`
	Estado       string             `json:"estado"`
	Gastos       string             `json:"gastos"`
	Notas        *string            `json:"notas"`
	ConfirmadaAt *time.Time         `json:"confirmadaAt"`
	SupplierID   string             `json:"supplierId"`
	Proveedor    string             `json:"proveedor"`
	BranchID     string             `json:"branchId"`
	Sucursal     *string            `json:"sucursal"`
	Items        []LineaDeRecepcion `json:"items"`
}

// ObtenerRecepcion es obtenerRecepcion.
func (s *Servicio) ObtenerRecepcion(ctx context.Context, id string) (*Recepcion, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var r Recepcion
	err := s.pool.QueryRow(ctx, `
		SELECT r.id, r.numero_remito, r.fecha, r.estado::text, r.gastos::text, r.notas, r.confirmada_at, r.supplier_id, s.nombre, r.branch_id, b.name
		FROM goods_receipts r JOIN suppliers s ON s.id = r.supplier_id LEFT JOIN branches b ON b.id = r.branch_id
		WHERE r.id = $1`, id).Scan(&r.ID, &r.NumeroRemito, &r.Fecha, &r.Estado, &r.Gastos, &r.Notas, &r.ConfirmadaAt, &r.SupplierID,
		&r.Proveedor, &r.BranchID, &r.Sucursal)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT i.id, i.variant_id, p.name, v.label, v.sku, i.cantidad::text, i.costo_unitario::text, i.alicuota_iva::text,
		  i.costo_con_gastos::text, i.cantidad_anterior::text, i.costo_anterior::text, i.costo_resultante::text, i.orden
		FROM goods_receipt_items i
		LEFT JOIN product_variants v ON v.id = i.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		WHERE i.receipt_id = $1 ORDER BY i.orden`, id)
	if err != nil {
		return nil, err
	}
	r.Items, err = pgx.CollectRows(filas, pgx.RowToStructByPos[LineaDeRecepcion])
	return &r, err
}

// Mercaderia es una variante para cargar en una recepción u orden: con lo
// que cuesta hoy.
type Mercaderia struct {
	VariantID   string  `json:"variantId"`
	Producto    string  `json:"producto"`
	Variante    string  `json:"variante"`
	Sku         string  `json:"sku"`
	Unidad      string  `json:"unidad"`
	AlicuotaIva string  `json:"alicuotaIva"`
	CostoActual *string `json:"costoActual"`
}

// BuscarParaRecibir es buscarParaRecibir: hasta 20, por nombre.
func (s *Servicio) BuscarParaRecibir(ctx context.Context, texto string) ([]Mercaderia, error) {
	consulta := trimJS(texto)
	if plataforma.LargoJS(consulta) < 2 {
		return []Mercaderia{}, nil
	}
	var a argumentos
	cond := []string{"v.active"}
	if c := a.coincide(consulta, "p.name", "v.label", "v.sku", "p.brand", "c.name"); c != "" {
		cond = append(cond, c)
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.name, v.label, v.sku, p.unit::text, p.alicuota_iva::text, vc.costo_promedio::text
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN variant_costs vc ON vc.variant_id = v.id
		WHERE `+strings.Join(cond, " AND ")+` ORDER BY p.name LIMIT 20`, a...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Mercaderia])
}

// VariantesParaPedir es variantesParaPedir: las mismas, por id (hasta 40),
// para abrir una orden con los renglones del reporte de reposición.
func (s *Servicio) VariantesParaPedir(ctx context.Context, ids []string) ([]Mercaderia, error) {
	var acotados []string
	for _, id := range ids {
		if id != "" {
			acotados = append(acotados, id)
		}
	}
	if len(acotados) > 40 {
		acotados = acotados[:40]
	}
	var validos []string
	for _, id := range acotados {
		if plataforma.UUIDValido(id) {
			validos = append(validos, id)
		}
	}
	if len(validos) == 0 {
		return []Mercaderia{}, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.name, v.label, v.sku, p.unit::text, p.alicuota_iva::text, vc.costo_promedio::text
		FROM product_variants v JOIN products p ON p.id = v.product_id LEFT JOIN variant_costs vc ON vc.variant_id = v.id
		WHERE v.id = ANY($1::uuid[])`, validos)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Mercaderia])
}

// CrearRecepcion es crearRecepcion: en borrador, sin tocar stock ni costo.
func (s *Servicio) CrearRecepcion(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, error) {
	r, err := leerRecepcion(m)
	if err != nil {
		return "", err
	}
	var fecha *time.Time
	if r.Fecha != nil && *r.Fecha != "" {
		f, ok := LeerFecha(*r.Fecha)
		if !ok {
			return "", plataforma.Invalido(map[string]string{"fecha": "La fecha no es válida."})
		}
		fecha = &f
	}
	var id string
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `
			INSERT INTO goods_receipts (supplier_id, branch_id, numero_remito, notas, gastos, fecha, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5::numeric, coalesce($6, now()), $7) RETURNING id`,
			r.SupplierID, r.BranchID, r.NumeroRemito, r.Notas, jsmath.Fijo2(r.Gastos), fecha, ses.UserID).Scan(&id); err != nil {
			return err
		}
		for i, l := range r.Lineas {
			if _, err := tx.Exec(ctx, `
				INSERT INTO goods_receipt_items (receipt_id, variant_id, cantidad, costo_unitario, alicuota_iva, orden)
				VALUES ($1, $2, $3::numeric, $4::numeric, $5::numeric, $6)`, id, l.VariantID,
				jsmath.ToFixed(l.Cantidad, 4), jsmath.ToFixed(l.CostoUnitario, 4), jsmath.Fijo2(l.AlicuotaIva), i); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if strings.Contains(err.Error(), "goods_receipts_remito_idx") {
			return "", fallo("Ya hay una recepción con ese remito para este proveedor.")
		}
		if strings.Contains(err.Error(), "foreign key") {
			return "", fallo("El proveedor, la sucursal o alguno de los productos ya no existe.")
		}
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "recepcion", id, fmt.Sprintf("Cargó una recepción con %d renglones", len(r.Lineas)), nil)
	return id, nil
}

type cabeceraRecepcion struct {
	supplier, branch, estado string
	remito, notas, orden     *string
	gastos                   jsmath.Num
}

type itemRecepcion struct {
	id, variante              string
	itemDeOrden               *string
	cantidad, costo, alicuota jsmath.Num
	cantidadTexto             string
}

func leerCabecera(ctx context.Context, tx pgx.Tx, id string) (*cabeceraRecepcion, error) {
	var c cabeceraRecepcion
	err := tx.QueryRow(ctx, `
		SELECT supplier_id, branch_id, estado::text, numero_remito, notas, purchase_order_id, gastos
		FROM goods_receipts WHERE id = $1 FOR UPDATE`, id).Scan(&c.supplier, &c.branch, &c.estado, &c.remito, &c.notas, &c.orden, &c.gastos)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fallo("Esa recepción no existe.")
	}
	return &c, err
}

func leerItems(ctx context.Context, tx pgx.Tx, id string) ([]itemRecepcion, error) {
	filas, err := tx.Query(ctx, `
		SELECT id, variant_id, purchase_order_item_id, cantidad, costo_unitario, alicuota_iva, cantidad::text
		FROM goods_receipt_items WHERE receipt_id = $1 ORDER BY orden`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (itemRecepcion, error) {
		var i itemRecepcion
		return i, r.Scan(&i.id, &i.variante, &i.itemDeOrden, &i.cantidad, &i.costo, &i.alicuota, &i.cantidadTexto)
	})
}

// bloquearStock toma el candado de lib/inventario/locks.ts de cada variante
// en la sucursal, en un orden fijo para que dos recepciones con las mismas
// variantes en otro orden no se traben.
func bloquearStock(ctx context.Context, tx pgx.Tx, sucursal string, variantes []string) error {
	unicas := map[string]bool{}
	for _, v := range variantes {
		unicas[v] = true
	}
	orden := make([]string, 0, len(unicas))
	for v := range unicas {
		orden = append(orden, v)
	}
	sort.Strings(orden)
	q := sqlc.New(tx)
	for _, v := range orden {
		if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: v, Sucursal: sucursal}); err != nil {
			return err
		}
	}
	return nil
}

// antesDeMezclar es un gancho para las pruebas de concurrencia.
var antesDeMezclar = func(string) {}

// ConfirmarRecepcion es confirmarRecepcion: entra el stock, se mezcla el
// costo y sube la deuda con el proveedor, todo en una transacción.
//
// Una diferencia con el TS, a propósito: además del candado del stock (por
// variante y sucursal) bloquea la fila del costo, que es **por variante**.
// El TS solo tomaba el del stock, así que dos recepciones de la misma
// variante en sucursales distintas leían el mismo costo previo y la segunda
// pisaba la mezcla de la primera (o, sin fila previa, la segunda abortaba
// con el índice único de variant_costs).
func (s *Servicio) ConfirmarRecepcion(ctx context.Context, ses *auth.Sesion, id string) (int, float64, error) {
	var lineas int
	var neto float64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		c, err := leerCabecera(ctx, tx, id)
		if err != nil {
			return err
		}
		switch c.estado {
		case "confirmada":
			return fallo("Esta recepción ya estaba confirmada.")
		case "anulada":
			return fallo("Esta recepción está anulada.")
		}
		items, err := leerItems(ctx, tx, id)
		if err != nil {
			return err
		}
		if len(items) == 0 {
			return fallo("La recepción no tiene ninguna línea.")
		}
		variantes := make([]string, len(items))
		for i, it := range items {
			variantes[i] = it.variante
		}
		if err := bloquearStock(ctx, tx, c.branch, variantes); err != nil {
			return err
		}
		// La fila del costo de cada variante, creada si no estaba (en cero:
		// lo mismo que el TS leía cuando faltaba) y bloqueada.
		if _, err := tx.Exec(ctx, `
			INSERT INTO variant_costs (variant_id) SELECT DISTINCT unnest($1::uuid[]) ORDER BY 1 ON CONFLICT (variant_id) DO NOTHING`, variantes); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `SELECT 1 FROM variant_costs WHERE variant_id = ANY($1::uuid[]) ORDER BY variant_id FOR UPDATE`, variantes); err != nil {
			return err
		}
		motivo := "Recepción de mercadería"
		if c.remito != nil && *c.remito != "" {
			motivo = "Remito " + *c.remito
		}
		recibidas := make([]LineaRecibida, len(items))
		for i, it := range items {
			recibidas[i] = LineaRecibida{it.variante, float64(it.cantidad), float64(it.costo), float64(it.alicuota)}
		}
		k := 0
		var deuda float64
		neto, deuda, err = CuentaDeRecepcion(recibidas, float64(c.gastos),
			func(v string) (EstadoDeCosto, error) {
				var e EstadoDeCosto
				var base, costo jsmath.Num
				err := tx.QueryRow(ctx, `SELECT cantidad_base, costo_promedio FROM variant_costs WHERE variant_id = $1`, v).Scan(&base, &costo)
				e.CantidadBase, e.CostoPromedio = float64(base), float64(costo)
				antesDeMezclar(v)
				return e, err
			},
			func(v string, previo, nuevo EstadoDeCosto, l LineaConfirmada) error {
				it := items[k]
				k++
				if _, err := tx.Exec(ctx, `UPDATE variant_costs SET cantidad_base = $2::numeric, costo_promedio = $3::numeric WHERE variant_id = $1`,
					v, jsmath.ToFixed(nuevo.CantidadBase, 4), jsmath.ToFixed(nuevo.CostoPromedio, 4)); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO cost_history (variant_id, costo_anterior, costo_nuevo, cantidad_anterior, cantidad_nueva, documento_tipo, documento_id, motivo, created_by_user_id)
					VALUES ($1, $2::numeric, $3::numeric, $4::numeric, $5::numeric, 'recepcion', $6, $7, $8)`,
					v, jsmath.ToFixed(previo.CostoPromedio, 4), jsmath.ToFixed(nuevo.CostoPromedio, 4), jsmath.ToFixed(previo.CantidadBase, 4),
					jsmath.ToFixed(nuevo.CantidadBase, 4), id, motivo, ses.UserID); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					UPDATE goods_receipt_items SET costo_con_gastos = $2::numeric, cantidad_anterior = $3::numeric, costo_anterior = $4::numeric, costo_resultante = $5::numeric
					WHERE id = $1`, it.id, jsmath.ToFixed(l.CostoConGastos, 4), jsmath.ToFixed(previo.CantidadBase, 4),
					jsmath.ToFixed(previo.CostoPromedio, 4), jsmath.ToFixed(nuevo.CostoPromedio, 4)); err != nil {
					return err
				}
				if l.Unidades > 0 {
					// Con upsert: una recepción puede traer algo que nunca estuvo en esa sucursal.
					if _, err := tx.Exec(ctx, `
						INSERT INTO inventory (variant_id, branch_id, qty) VALUES ($1, $2, $3::numeric)
						ON CONFLICT (variant_id, branch_id) DO UPDATE SET qty = inventory.qty + $3::numeric, updated_at = now()`,
						v, c.branch, jsmath.Texto(l.Unidades)); err != nil {
						return err
					}
					if _, err := tx.Exec(ctx, `
						INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, documento_tipo, documento_id, created_by_user_id)
						VALUES ($1, $2, 'ingreso', $3::numeric, $4, 'recepcion', $5, $6)`, v, c.branch, jsmath.Texto(l.Unidades), motivo, id, ses.UserID); err != nil {
						return err
					}
				}
				return nil
			})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE goods_receipts SET estado = 'confirmada', confirmada_at = now(), confirmada_por = $2 WHERE id = $1`, id, ses.UserID); err != nil {
			return err
		}
		if err := actualizarOrden(ctx, tx, c.orden, items, false); err != nil {
			return err
		}
		lineas = len(items)
		if !LaDeudaNaceConElRemito {
			return nil
		}
		// La deuda sube por el total con IVA: es lo que hay que pagarle. El
		// movimiento queda atado a la recepción para que la factura que la
		// cubra sepa cuánto ya está cargado (ver CargarFactura).
		_, err = tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, goods_receipt_id)
			VALUES ($1, 'factura', $2::numeric, $3, 'Recepción de mercadería', $4, $5)`, c.supplier, jsmath.Fijo2(deuda), c.remito, ses.UserID, id)
		return err
	})
	if err != nil {
		return 0, 0, err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "recepcion", id,
		fmt.Sprintf("Confirmó la recepción: %d renglones por $%s netos", lineas, jsmath.Fijo2(neto)), nil)
	return lineas, neto, nil
}

// LaDeudaNaceConElRemito dice cuándo nace la deuda con el proveedor. Es una
// pregunta para el contador: «¿la deuda nace con el remito o con la factura?».
//
// Con true (lo de siempre), confirmar la recepción carga la deuda por el
// total con IVA, y la factura que la cubre carga solo la diferencia entre lo
// facturado y lo que ya cargó la recepción (un flete que no estaba en el
// remito, un precio que cambió). Con false, la recepción no carga nada y la
// factura carga su total: la diferencia sale igual de la misma cuenta,
// porque lo «ya cargado» se lee de los movimientos atados a la recepción y
// no se recalcula. Cambiar la respuesta es cambiar esta constante; las
// recepciones confirmadas antes siguen bien porque su movimiento quedó atado.
const LaDeudaNaceConElRemito = true

// cargadoPorRecepcion es lo que la recepción cargó en la cuenta del
// proveedor, neto de su anulación: la suma de los movimientos atados a ella.
// nil si no cargó nada (la deuda nace con la factura, o es de antes de que
// los movimientos se ataran y la migración 00087 no la encontró).
func cargadoPorRecepcion(ctx context.Context, tx pgx.Tx, id string) (*float64, error) {
	var n *jsmath.Num
	if err := tx.QueryRow(ctx, `SELECT sum(monto) FROM supplier_movements WHERE goods_receipt_id = $1`, id).Scan(&n); err != nil {
		return nil, err
	}
	if n == nil {
		return nil, nil
	}
	v := float64(*n)
	return &v, nil
}

// facturaDeRecepcion es el id de la factura que cubre la recepción, o "".
func facturaDeRecepcion(ctx context.Context, tx pgx.Tx, id string) (string, error) {
	var f string
	err := tx.QueryRow(ctx, `SELECT id FROM purchase_invoices WHERE receipt_id = $1 LIMIT 1`, id).Scan(&f)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return f, err
}

// actualizarOrden es actualizarOrden: suma (o resta, al anular) lo recibido
// a cada renglón de la orden y recalcula su estado.
func actualizarOrden(ctx context.Context, tx pgx.Tx, orden *string, items []itemRecepcion, restar bool) error {
	if orden == nil {
		return nil
	}
	for _, it := range items {
		if it.itemDeOrden == nil {
			continue
		}
		cantidad := it.cantidadTexto
		if restar {
			cantidad = jsmath.ToFixed(-float64(it.cantidad), 4)
		}
		if _, err := tx.Exec(ctx, `UPDATE purchase_order_items SET cantidad_recibida = cantidad_recibida + $2::numeric WHERE id = $1`,
			*it.itemDeOrden, cantidad); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx, `
		UPDATE purchase_orders o SET estado = CASE WHEN r.cortos = 0 THEN 'completa' WHEN r.recibido > 0 THEN 'parcial' ELSE 'enviada' END::estado_orden_compra
		FROM (SELECT coalesce(sum(cantidad_recibida), 0) AS recibido, count(*) FILTER (WHERE cantidad_recibida < cantidad) AS cortos
		      FROM purchase_order_items WHERE purchase_order_id = $1) r
		WHERE o.id = $1`, *orden)
	return err
}

// AnularRecepcion es anularRecepcion: saca el stock y no toca el costo.
//
// Una diferencia con el TS, a propósito: la nota de crédito que devuelve la
// deuda se calcula de las líneas de esta recepción (lo mismo que se cargó al
// confirmar). El TS sumaba las facturas del proveedor con la misma
// referencia que el remito: sin remito no encontraba ninguna y la deuda
// quedaba cargada aunque la mercadería se devolviera.
func (s *Servicio) AnularRecepcion(ctx context.Context, ses *auth.Sesion, id, motivo string) error {
	motivo = trimJS(motivo)
	if motivo == "" {
		return fallo("Poné el motivo: una anulación sin explicación no se puede revisar después.")
	}
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		c, err := leerCabecera(ctx, tx, id)
		if err != nil {
			return err
		}
		if c.estado == "anulada" {
			return fallo("Ya estaba anulada.")
		}
		items, err := leerItems(ctx, tx, id)
		if err != nil {
			return err
		}
		if c.estado == "confirmada" {
			var variantes []string
			for _, it := range items {
				if CantidadDeStock(float64(it.cantidad)) > 0 {
					variantes = append(variantes, it.variante)
				}
			}
			if err := bloquearStock(ctx, tx, c.branch, variantes); err != nil {
				return err
			}
			nota := "Anulación de recepción: " + motivo
			for _, it := range items {
				unidades := CantidadDeStock(float64(it.cantidad))
				if unidades <= 0 {
					continue
				}
				if _, err := tx.Exec(ctx, `UPDATE inventory SET qty = qty - $3::numeric, updated_at = now() WHERE variant_id = $1 AND branch_id = $2`,
					it.variante, c.branch, jsmath.Texto(unidades)); err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, documento_tipo, documento_id, created_by_user_id)
					VALUES ($1, $2, 'ajuste', $3::numeric, $4, 'recepcion', $5, $6)`, it.variante, c.branch, jsmath.Texto(-unidades), nota, id, ses.UserID); err != nil {
					return err
				}
			}
			// La deuda vuelve atrás con una nota de crédito por lo mismo que
			// se cargó: las líneas con el flete que les tocó, con IVA.
			var deuda float64
			filas, err := tx.Query(ctx, `SELECT cantidad, costo_con_gastos, alicuota_iva FROM goods_receipt_items WHERE receipt_id = $1 ORDER BY orden`, id)
			if err != nil {
				return err
			}
			if _, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (struct{}, error) {
				var cant, alic jsmath.Num
				var conGastos *jsmath.Num
				if err := r.Scan(&cant, &conGastos, &alic); err != nil {
					return struct{}{}, err
				}
				deuda += AgregarIva(float64(float64(cant)*numOCero(conGastos)), float64(alic))
				return struct{}{}, nil
			}); err != nil {
				return err
			}
			// Si ya llegó la factura de esta recepción, la deuda es de la
			// factura y no se toca: la devuelve la nota de crédito que mande el
			// proveedor por la mercadería devuelta. Devolverla acá también la
			// bajaría dos veces. Si no, vuelve exactamente lo que la recepción
			// cargó; la cuenta de las líneas queda para las recepciones de
			// antes de que el movimiento se atara.
			facturada, err := facturaDeRecepcion(ctx, tx, id)
			if err != nil {
				return err
			}
			cargado, err := cargadoPorRecepcion(ctx, tx, id)
			if err != nil {
				return err
			}
			switch {
			case facturada != "":
				deuda = 0
			case cargado != nil:
				deuda = *cargado
			case !LaDeudaNaceConElRemito:
				deuda = 0
			}
			if deuda > 0 {
				if _, err := tx.Exec(ctx, `
					INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, goods_receipt_id)
					VALUES ($1, 'nota_credito', $2::numeric, $3, $4, $5, $6)`, c.supplier, jsmath.Fijo2(-deuda), c.remito, nota, ses.UserID, id); err != nil {
					return err
				}
			}
			if err := actualizarOrden(ctx, tx, c.orden, items, true); err != nil {
				return err
			}
		}
		notas := "Anulada: " + motivo
		if c.notas != nil && *c.notas != "" {
			notas = *c.notas + " · " + notas
		}
		_, err = tx.Exec(ctx, `UPDATE goods_receipts SET estado = 'anulada', notas = $2 WHERE id = $1`, id, notas)
		return err
	})
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "recepcion", id, "Anuló la recepción: "+motivo, nil)
	return nil
}

package compras

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// --- ayudantes de consultas ---

// argumentos junta los parámetros de una consulta armada a mano.
type argumentos []any

func (a *argumentos) poner(v any) string {
	*a = append(*a, v)
	return fmt.Sprintf("$%d", len(*a))
}

// coincide es coincideBusqueda (lib/busqueda.ts): cada palabra (hasta seis)
// tiene que aparecer en alguna de las columnas, sin tildes.
func (a *argumentos) coincide(texto string, columnas ...string) string {
	terminos := strings.FieldsFunc(trimJS(texto), func(r rune) bool { return trimJS(string(r)) == "" })
	if len(terminos) > 6 {
		terminos = terminos[:6]
	}
	if len(terminos) == 0 {
		return ""
	}
	var porTermino []string
	for _, t := range terminos {
		p := a.poner("%" + t + "%")
		var col []string
		for _, c := range columnas {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+p+")")
		}
		porTermino = append(porTermino, "("+strings.Join(col, " OR ")+")")
	}
	return "(" + strings.Join(porTermino, " AND ") + ")"
}

func numOCero(n *jsmath.Num) float64 {
	if n == nil {
		return 0
	}
	return float64(*n)
}

// --- proveedores ---

// ProveedorListado es una fila del listado.
type ProveedorListado struct {
	ID               string     `json:"id"`
	Nombre           string     `json:"nombre"`
	RazonSocial      *string    `json:"razonSocial"`
	Cuit             *string    `json:"cuit"`
	Rubro            *string    `json:"rubro"`
	Contacto         *string    `json:"contacto"`
	Telefono         *string    `json:"telefono"`
	Email            *string    `json:"email"`
	DiasPago         int32      `json:"diasPago"`
	Estado           string     `json:"estado"`
	Saldo            float64    `json:"saldo"`
	UltimoMovimiento *time.Time `json:"ultimoMovimiento"`
	// Para que el pago no ofrezca los regímenes que no le corresponden.
	CondicionIva         string  `json:"condicionIva"`
	CondicionGanancias   *string `json:"condicionGanancias"`
	ExentoGananciasHasta *string `json:"exentoGananciasHasta"`
}

// ListarProveedores es listarProveedores: los vivos, con el saldo sumado en
// una sola pasada (positivo: les debemos).
func (s *Servicio) ListarProveedores(ctx context.Context, busqueda, estado string) ([]ProveedorListado, error) {
	var a argumentos
	cond := []string{"s.active"}
	if estado == "activo" || estado == "inactivo" {
		cond = append(cond, "s.estado = "+a.poner(estado)+"::estado_proveedor")
	}
	if c := a.coincide(busqueda, "s.nombre", "s.razon_social", "s.cuit", "s.rubro", "s.contacto"); c != "" {
		cond = append(cond, c)
	}
	filas, err := s.pool.Query(ctx, `
		SELECT s.id, s.nombre, s.razon_social, s.cuit, s.rubro, s.contacto, s.telefono, s.email, s.dias_pago, s.estado::text,
		  saldos.saldo, saldos.ultimo, s.condicion_iva::text, s.condicion_ganancias, to_char(s.exento_ganancias_hasta, 'YYYY-MM-DD')
		FROM suppliers s
		LEFT JOIN (SELECT supplier_id, sum(monto) AS saldo, max(created_at) AS ultimo FROM supplier_movements GROUP BY supplier_id) saldos
		  ON saldos.supplier_id = s.id
		WHERE `+strings.Join(cond, " AND ")+`
		ORDER BY s.nombre`, a...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, func(r pgx.CollectableRow) (ProveedorListado, error) {
		var p ProveedorListado
		var saldo *jsmath.Num
		err := r.Scan(&p.ID, &p.Nombre, &p.RazonSocial, &p.Cuit, &p.Rubro, &p.Contacto, &p.Telefono, &p.Email, &p.DiasPago, &p.Estado, &saldo, &p.UltimoMovimiento,
			&p.CondicionIva, &p.CondicionGanancias, &p.ExentoGananciasHasta)
		p.Saldo = numOCero(saldo)
		return p, err
	})
}

// MovimientoDeCuenta es un renglón del libro del proveedor.
type MovimientoDeCuenta struct {
	ID         string    `json:"id"`
	Tipo       string    `json:"tipo"`
	Monto      float64   `json:"monto"`
	Detalle    *string   `json:"detalle"`
	Referencia *string   `json:"referencia"`
	CreatedAt  time.Time `json:"createdAt"`
	Saldo      float64   `json:"saldo"`
	// De dónde salió: la ficha lleva a la factura o al pago.
	PurchaseInvoiceID *string `json:"purchaseInvoiceId"`
	SupplierPaymentID *string `json:"supplierPaymentId"`
	// GoodsReceiptID es la recepción que lo cargó (es un remito, no una
	// factura: mes simulado, H070) y FacturaDelRemito la factura que la cubrió.
	GoodsReceiptID   *string `json:"goodsReceiptId"`
	FacturaDelRemito *string `json:"facturaDelRemito"`
	// ChequeID es el cheque que rebotó (el renglón se llama «Cheque
	// rechazado», no «Ajuste»: M2S3-055) y AplicaA la factura a la que se
	// aplicó un ajuste que bajó la deuda.
	ChequeID *string `json:"chequeId"`
	AplicaA  *string `json:"aplicaA"`
}

// GastoDelProveedor es un gasto pagado en el acto a un proveedor (un flete,
// la luz): no pasa por su cuenta, pero es plata que se le pagó (mes
// simulado, H065).
type GastoDelProveedor struct {
	ID          string    `json:"id"`
	Fecha       time.Time `json:"fecha"`
	Descripcion string    `json:"descripcion"`
	Importe     float64   `json:"importe"`
	Medio       string    `json:"medio"`
	Factura     *string   `json:"factura"`
}

// Proveedor es la ficha completa, con el libro de la cuenta.
type Proveedor struct {
	ID           string    `json:"id"`
	Nombre       string    `json:"nombre"`
	RazonSocial  *string   `json:"razonSocial"`
	Cuit         *string   `json:"cuit"`
	CondicionIva string    `json:"condicionIva"`
	Email        *string   `json:"email"`
	Telefono     *string   `json:"telefono"`
	Direccion    *string   `json:"direccion"`
	Rubro        *string   `json:"rubro"`
	Contacto     *string   `json:"contacto"`
	DiasPago     int32     `json:"diasPago"`
	Cbu          *string   `json:"cbu"`
	AliasCbu     *string   `json:"aliasCbu"`
	Estado       string    `json:"estado"`
	Notas        *string   `json:"notas"`
	CodigoLegacy *string   `json:"codigoLegacy"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
	Convenios    *string   `json:"convenios"`
	// CondicionGanancias (nil: no se sabe) y hasta cuándo vale la exención.
	CondicionGanancias   *string              `json:"condicionGanancias"`
	ExentoGananciasHasta *string              `json:"exentoGananciasHasta"`
	Saldo                float64              `json:"saldo"`
	Movimientos          []MovimientoDeCuenta `json:"movimientos"`
	Gastos               []GastoDelProveedor  `json:"gastos"`
}

// ObtenerProveedor es obtenerProveedor: la ficha y los últimos 200
// movimientos, cada uno con el saldo de ese día.
func (s *Servicio) ObtenerProveedor(ctx context.Context, id string) (*Proveedor, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	var p Proveedor
	err := s.pool.QueryRow(ctx, `
		SELECT id, nombre, razon_social, cuit, condicion_iva::text, email, telefono, direccion, rubro, contacto, dias_pago,
		  cbu, alias_cbu, estado::text, notas, codigo_legacy, active, created_at, updated_at, convenios, condicion_ganancias,
		  to_char(exento_ganancias_hasta, 'YYYY-MM-DD')
		FROM suppliers WHERE id = $1`, id).Scan(&p.ID, &p.Nombre, &p.RazonSocial, &p.Cuit, &p.CondicionIva, &p.Email, &p.Telefono,
		&p.Direccion, &p.Rubro, &p.Contacto, &p.DiasPago, &p.Cbu, &p.AliasCbu, &p.Estado, &p.Notas, &p.CodigoLegacy, &p.Active,
		&p.CreatedAt, &p.UpdatedAt, &p.Convenios, &p.CondicionGanancias, &p.ExentoGananciasHasta)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT m.id, m.tipo::text, m.monto,
		  -- Los pagos de una sola parte anotados antes como «Pago cheque»: se
		  -- leen con el número de esa parte (mes simulado). El renglón
		  -- guardado no se toca.
		  CASE WHEN m.tipo = 'pago' AND m.detalle IN ('Pago cheque', 'Pago echeq', 'Pago transferencia', 'Pago efectivo') THEN coalesce((
		    SELECT 'Pago ' || CASE pp.medio WHEN 'echeq' THEN 'e-Cheq' ELSE pp.medio END || ' ' || coalesce(c.numero, nullif(pp.referencia, ''))
		    FROM supplier_payment_parts pp LEFT JOIN cheques c ON c.id = pp.cheque_id
		    WHERE pp.payment_id = m.supplier_payment_id AND (SELECT count(*) FROM supplier_payment_parts q WHERE q.payment_id = m.supplier_payment_id) = 1
		    LIMIT 1), m.detalle) ELSE m.detalle END,
		  m.referencia, m.created_at, m.purchase_invoice_id, m.supplier_payment_id, m.goods_receipt_id,
		  (SELECT lpad(f.punto_venta::text, 4, '0') || '-' || lpad(f.numero::text, 8, '0') FROM purchase_invoice_receipts x JOIN purchase_invoices f ON f.id = x.purchase_invoice_id
		   WHERE x.goods_receipt_id = m.goods_receipt_id LIMIT 1),
		  m.cheque_id,
		  (SELECT lpad(f.punto_venta::text, 4, '0') || '-' || lpad(f.numero::text, 8, '0') FROM purchase_invoices f WHERE f.id = m.aplica_a_id)
		FROM supplier_movements m
		WHERE m.supplier_id = $1 ORDER BY m.created_at DESC LIMIT 200`, id)
	if err != nil {
		return nil, err
	}
	p.Movimientos, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (MovimientoDeCuenta, error) {
		var m MovimientoDeCuenta
		var monto jsmath.Num
		err := r.Scan(&m.ID, &m.Tipo, &monto, &m.Detalle, &m.Referencia, &m.CreatedAt, &m.PurchaseInvoiceID, &m.SupplierPaymentID,
			&m.GoodsReceiptID, &m.FacturaDelRemito, &m.ChequeID, &m.AplicaA)
		m.Monto = float64(monto)
		return m, err
	})
	if err != nil {
		return nil, err
	}
	montos := make([]float64, len(p.Movimientos))
	for i, m := range p.Movimientos {
		montos[i] = m.Monto
	}
	saldos, total := SaldosCorrientes(montos)
	for i := range p.Movimientos {
		p.Movimientos[i].Saldo = saldos[i]
	}
	p.Saldo = total
	filas, err = s.pool.Query(ctx, `
		SELECT e.id, e.fecha, e.descripcion, e.importe, e.medio::text, CASE WHEN f.id IS NOT NULL THEN lpad(f.punto_venta::text, 4, '0') || '-' || lpad(f.numero::text, 8, '0') END
		FROM expenses e LEFT JOIN purchase_invoices f ON f.id = e.purchase_invoice_id
		WHERE e.supplier_id = $1 AND e.anulado_at IS NULL ORDER BY e.fecha DESC LIMIT 50`, id)
	if err != nil {
		return nil, err
	}
	p.Gastos, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (GastoDelProveedor, error) {
		var g GastoDelProveedor
		var importe jsmath.Num
		err := r.Scan(&g.ID, &g.Fecha, &g.Descripcion, &importe, &g.Medio, &g.Factura)
		g.Importe = importe.F()
		return g, err
	})
	if err != nil {
		return nil, err
	}
	return &p, nil
}

// CondicionDePago es una fila de supplier_terms.
type CondicionDePago struct {
	ID              string  `json:"id"`
	Modalidad       string  `json:"modalidad"`
	PlazoDias       int32   `json:"plazoDias"`
	BonificacionPct string  `json:"bonificacionPct"`
	Detalle         *string `json:"detalle"`
	Activo          bool    `json:"activo"`
}

// CondicionesDelProveedor es condicionesDelProveedor.
func (s *Servicio) CondicionesDelProveedor(ctx context.Context, id string) ([]CondicionDePago, error) {
	if !plataforma.UUIDValido(id) {
		return []CondicionDePago{}, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id, modalidad::text, plazo_dias, bonificacion_pct::text, detalle, activo FROM supplier_terms
		WHERE supplier_id = $1 ORDER BY plazo_dias, modalidad`, id)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[CondicionDePago])
}

// ProveedorParaElegir es lo que muestran los selectores.
type ProveedorParaElegir struct {
	ID           string  `json:"id"`
	Nombre       string  `json:"nombre"`
	Cuit         *string `json:"cuit"`
	CondicionIva string  `json:"condicionIva"`
	DiasPago     int32   `json:"diasPago"`
	// Para no ofrecer en el pago los regímenes que no le corresponden.
	CondicionGanancias   *string `json:"condicionGanancias"`
	ExentoGananciasHasta *string `json:"exentoGananciasHasta"`
}

// ProveedoresParaElegir son los activos, por nombre.
func (s *Servicio) ProveedoresParaElegir(ctx context.Context) ([]ProveedorParaElegir, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id, nombre, cuit, condicion_iva::text, dias_pago, condicion_ganancias, to_char(exento_ganancias_hasta, 'YYYY-MM-DD')
		FROM suppliers WHERE active AND estado = 'activo' ORDER BY nombre`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[ProveedorParaElegir])
}

// --- escribir ---

func refrescoDeFicha(id string) []string {
	return []string{"/admin/proveedores", "/admin/proveedores/" + id}
}

// GuardarProveedor es guardarProveedor: alta o edición de la ficha.
func (s *Servicio) GuardarProveedor(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, string, error) {
	f, err := leerFicha(m)
	if err != nil {
		return "", "", err
	}
	// Un CUIT que ya tiene otro proveedor: las facturas y los pagos se
	// repartían entre dos cuentas y el acumulado del mes para retener se
	// contaba por separado (M3S3-008).
	if f.Cuit != nil && NormalizarNumeroDeCheque(*f.Cuit) != "" {
		var otro, nombre string
		err := s.pool.QueryRow(ctx, `
			SELECT id, nombre FROM suppliers
			WHERE regexp_replace(coalesce(cuit, ''), '\D', '', 'g') = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
			ORDER BY estado = 'activo' DESC LIMIT 1`, NormalizarNumeroDeCheque(*f.Cuit), f.ID).Scan(&otro, &nombre)
		if err == nil {
			return "", "", plataforma.Invalido(map[string]string{"cuit": "Ya existe " + nombre + " con ese CUIT."})
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", "", err
		}
	}
	args := []any{f.Nombre, f.RazonSocial, f.Cuit, f.CondicionIva, f.Contacto, f.Telefono, f.Email, f.Direccion, f.Rubro,
		f.Cbu, f.AliasCbu, int32(f.DiasPago), f.Notas, f.CondicionGanancias, f.ExentoGananciasHasta}
	if f.ID != nil {
		// Como el TS: la edición no pregunta si existe (un id que no está no
		// cambia nada y contesta igual).
		if _, err := s.pool.Exec(ctx, `
			UPDATE suppliers SET nombre = $1, razon_social = $2, cuit = $3, condicion_iva = $4::condicion_iva, contacto = $5,
			  telefono = $6, email = $7, direccion = $8, rubro = $9, cbu = $10, alias_cbu = $11, dias_pago = $12, notas = $13,
			  condicion_ganancias = $14, exento_ganancias_hasta = $15::date
			WHERE id = $16`, append(args, *f.ID)...); err != nil {
			return "", "", err
		}
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "proveedor", *f.ID, "Editó la ficha de "+f.Nombre, nil)
		return *f.ID, "Ficha guardada.", nil
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO suppliers (nombre, razon_social, cuit, condicion_iva, contacto, telefono, email, direccion, rubro, cbu, alias_cbu, dias_pago, notas,
		  condicion_ganancias, exento_ganancias_hasta)
		VALUES ($1, $2, $3, $4::condicion_iva, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::date) RETURNING id`, args...).Scan(&id); err != nil {
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "proveedor", id, "Dio de alta a "+f.Nombre, nil)
	return id, "Proveedor creado.", nil
}

// RegistrarMovimiento es registrarMovimientoDeProveedor, limitado a ajustes.
//
// Bug arreglado: dejaba anotar a mano una «Factura» o un «Pago» que no
// pasaba por compras ni por el libro IVA: la deuda bajaba sin pago (ni
// retenciones, ni caja, ni cheque) y subía sin factura (ni crédito fiscal).
// Las facturas y los pagos van por su pantalla; acá queda el ajuste (un
// saldo inicial, un redondeo, una diferencia acordada), con su motivo y para
// el lado que diga `sentido`: «sube» (le debemos más) o «baja».
func (s *Servicio) RegistrarMovimiento(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, error) {
	x, err := leerMovimiento(m)
	if err != nil {
		return "", err
	}
	if x.Tipo != "ajuste" {
		return "", fallo("A mano solo se anotan ajustes: las facturas se cargan en Compras › Facturas y los pagos en Compras › Pagos.")
	}
	if x.Detalle == nil {
		return "", plataforma.Invalido(map[string]string{"detalle": "Poné el motivo del ajuste."})
	}
	conSigno := x.Monto
	switch m["sentido"] {
	case "baja":
		conSigno = -x.Monto
	case "sube", nil:
	default:
		return "", fallo("Elegí si el ajuste sube o baja la deuda.")
	}
	// Un ajuste que baja la deuda se puede aplicar a una factura, como una
	// nota de crédito (una bonificación pactada, M3S2-028): la factura queda
	// pagada por lo que cubre.
	var aplicaA *string
	if v, _ := m["aplicaA"].(string); v != "" {
		if conSigno > 0 {
			return "", fallo("Solo un ajuste que baja la deuda se aplica a una factura.")
		}
		aplicaA = &v
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if aplicaA != nil {
			if !plataforma.UUIDValido(*aplicaA) {
				return fallo("Esa factura no existe.")
			}
			var dueno, tipo string
			var anulada bool
			var total, imputado jsmath.Num
			err := tx.QueryRow(ctx, `SELECT supplier_id, tipo::text, anulada_at IS NOT NULL, total, `+AplicadoA("f")+`
				FROM purchase_invoices f WHERE id = $1 FOR UPDATE`, *aplicaA).Scan(&dueno, &tipo, &anulada, &total, &imputado)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && dueno != x.SupplierID {
				return fallo("Esa factura no es de este proveedor.")
			}
			if err != nil {
				return err
			}
			if anulada || strings.HasPrefix(tipo, "nota_credito") {
				return fallo("Ese comprobante no se paga.")
			}
			if saldo := SaldoDeFactura(total.F(), imputado.F()); x.Monto-saldo > 0.009 {
				return fallo("A esa factura le quedan " + formato.Importe(saldo) + ": el ajuste no puede ser mayor.")
			}
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO supplier_movements (supplier_id, tipo, monto, detalle, referencia, created_by_user_id, aplica_a_id)
			VALUES ($1, $2::tipo_movimiento_proveedor, $3::numeric, $4, $5, $6, $7)`,
			x.SupplierID, x.Tipo, jsmath.Fijo2(conSigno), x.Detalle, x.Referencia, ses.UserID, aplicaA)
		return err
	})
	if err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			return "", fallo("Ese proveedor no existe.")
		}
		return "", err
	}
	ref := ""
	if x.Referencia != nil {
		ref = " (" + *x.Referencia + ")"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "proveedor", x.SupplierID,
		"Anotó un ajuste de "+formato.Importe(conSigno)+ref+": "+*x.Detalle, nil)
	return x.SupplierID, nil
}

// DarDeBaja es darDeBajaProveedor: queda inactivo, no se borra.
func (s *Servicio) DarDeBaja(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", noExiste("Ese proveedor no existe.")
	}
	var nombre string
	err := s.pool.QueryRow(ctx, `UPDATE suppliers SET estado = 'inactivo' WHERE id = $1 RETURNING nombre`, id).Scan(&nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", noExiste("Ese proveedor no existe.")
	}
	if err != nil {
		return "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "proveedor", id, "Dio de baja a "+nombre, nil)
	return nombre + " quedó inactivo.", nil
}

// GuardarCondicion es guardarCondicion (el FormData como texto).
func (s *Servicio) GuardarCondicion(ctx context.Context, ses *auth.Sesion, form map[string]*string) (Condicion, error) {
	c, err := leerCondicion(form)
	if err != nil {
		return c, err
	}
	args := []any{c.SupplierID, c.Modalidad, int32(c.PlazoDias), jsmath.Fijo2(c.BonificacionPct), c.Detalle}
	accion := sqlc.AccionAuditoriaCrear
	entidad := ""
	if c.ID != nil {
		// A diferencia del TS, la condición tiene que ser de ese proveedor:
		// con el id de otra se podía pisar una condición ajena desde la ficha
		// equivocada.
		if _, err = s.pool.Exec(ctx, `
			UPDATE supplier_terms SET supplier_id = $1, modalidad = $2::modalidad_de_pago, plazo_dias = $3, bonificacion_pct = $4::numeric, detalle = $5
			WHERE id = $6 AND supplier_id = $1`, append(args, *c.ID)...); err != nil {
			return c, err
		}
		accion, entidad = sqlc.AccionAuditoriaEditar, *c.ID
	} else if _, err = s.pool.Exec(ctx, `
		INSERT INTO supplier_terms (supplier_id, modalidad, plazo_dias, bonificacion_pct, detalle)
		VALUES ($1, $2::modalidad_de_pago, $3, $4::numeric, $5)`, args...); err != nil {
		if strings.Contains(err.Error(), "foreign key") {
			return c, fallo("Ese proveedor no existe.")
		}
		return c, err
	}
	desc := fmt.Sprintf("Condición de pago: %s a %s días", c.Modalidad, jsmath.Texto(c.PlazoDias))
	if c.BonificacionPct > 0 {
		desc += ", " + jsmath.Texto(c.BonificacionPct) + "% de bonificación"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "condicion_proveedor", entidad, desc, nil)
	return c, nil
}

// BorrarCondicion es borrarCondicion.
func (s *Servicio) BorrarCondicion(ctx context.Context, ses *auth.Sesion, id, supplierID string) error {
	if !plataforma.UUIDValido(id) {
		return nil
	}
	// La bitácora dice cuál era (M3S4-022): «Borró una condición» sola no
	// dejaba saber qué se había pactado.
	var modalidad string
	var plazo int32
	var bonif jsmath.Num
	var detalle *string
	err := s.pool.QueryRow(ctx, `DELETE FROM supplier_terms WHERE id = $1 AND supplier_id = $2
		RETURNING modalidad::text, plazo_dias, bonificacion_pct, detalle`, id, supplierID).Scan(&modalidad, &plazo, &bonif, &detalle)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	cual := NombreDelMedio(modalidad)
	if plazo == 0 {
		cual += " contado"
	} else {
		cual += fmt.Sprintf(" a %d días", plazo)
	}
	if bonif.F() > 0 {
		cual += " · " + strings.Replace(jsmath.Texto(bonif.F()), ".", ",", 1) + " % de bonificación"
	}
	if detalle != nil && *detalle != "" {
		cual += " (" + *detalle + ")"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "condicion_proveedor", id, "Borró la condición de pago «"+cual+"»", nil)
	return nil
}

// GuardarConvenios es guardarConvenios: lo pactado en prosa.
func (s *Servicio) GuardarConvenios(ctx context.Context, ses *auth.Sesion, id, convenios string) error {
	if plataforma.LargoJS(convenios) > 2000 {
		return fallo("El texto de convenios es demasiado largo.")
	}
	var valor *string
	if t := trimJS(convenios); t != "" {
		valor = &t
	}
	if _, err := s.pool.Exec(ctx, `UPDATE suppliers SET convenios = $1 WHERE id = $2`, valor, id); err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "proveedor", id, "Actualizó los convenios del proveedor", nil)
	return nil
}

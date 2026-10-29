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
		  saldos.saldo, saldos.ultimo
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
		err := r.Scan(&p.ID, &p.Nombre, &p.RazonSocial, &p.Cuit, &p.Rubro, &p.Contacto, &p.Telefono, &p.Email, &p.DiasPago, &p.Estado, &saldo, &p.UltimoMovimiento)
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
}

// Proveedor es la ficha completa, con el libro de la cuenta.
type Proveedor struct {
	ID           string               `json:"id"`
	Nombre       string               `json:"nombre"`
	RazonSocial  *string              `json:"razonSocial"`
	Cuit         *string              `json:"cuit"`
	CondicionIva string               `json:"condicionIva"`
	Email        *string              `json:"email"`
	Telefono     *string              `json:"telefono"`
	Direccion    *string              `json:"direccion"`
	Rubro        *string              `json:"rubro"`
	Contacto     *string              `json:"contacto"`
	DiasPago     int32                `json:"diasPago"`
	Cbu          *string              `json:"cbu"`
	AliasCbu     *string              `json:"aliasCbu"`
	Estado       string               `json:"estado"`
	Notas        *string              `json:"notas"`
	CodigoLegacy *string              `json:"codigoLegacy"`
	Active       bool                 `json:"active"`
	CreatedAt    time.Time            `json:"createdAt"`
	UpdatedAt    time.Time            `json:"updatedAt"`
	Convenios    *string              `json:"convenios"`
	Saldo        float64              `json:"saldo"`
	Movimientos  []MovimientoDeCuenta `json:"movimientos"`
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
		  cbu, alias_cbu, estado::text, notas, codigo_legacy, active, created_at, updated_at, convenios
		FROM suppliers WHERE id = $1`, id).Scan(&p.ID, &p.Nombre, &p.RazonSocial, &p.Cuit, &p.CondicionIva, &p.Email, &p.Telefono,
		&p.Direccion, &p.Rubro, &p.Contacto, &p.DiasPago, &p.Cbu, &p.AliasCbu, &p.Estado, &p.Notas, &p.CodigoLegacy, &p.Active,
		&p.CreatedAt, &p.UpdatedAt, &p.Convenios)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id, tipo::text, monto, detalle, referencia, created_at FROM supplier_movements
		WHERE supplier_id = $1 ORDER BY created_at DESC LIMIT 200`, id)
	if err != nil {
		return nil, err
	}
	p.Movimientos, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (MovimientoDeCuenta, error) {
		var m MovimientoDeCuenta
		var monto jsmath.Num
		err := r.Scan(&m.ID, &m.Tipo, &monto, &m.Detalle, &m.Referencia, &m.CreatedAt)
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
}

// ProveedoresParaElegir son los activos, por nombre.
func (s *Servicio) ProveedoresParaElegir(ctx context.Context) ([]ProveedorParaElegir, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id, nombre, cuit, condicion_iva::text, dias_pago FROM suppliers
		WHERE active AND estado = 'activo' ORDER BY nombre`)
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
	args := []any{f.Nombre, f.RazonSocial, f.Cuit, f.CondicionIva, f.Contacto, f.Telefono, f.Email, f.Direccion, f.Rubro,
		f.Cbu, f.AliasCbu, int32(f.DiasPago), f.Notas}
	if f.ID != nil {
		// Como el TS: la edición no pregunta si existe (un id que no está no
		// cambia nada y contesta igual).
		if _, err := s.pool.Exec(ctx, `
			UPDATE suppliers SET nombre = $1, razon_social = $2, cuit = $3, condicion_iva = $4::condicion_iva, contacto = $5,
			  telefono = $6, email = $7, direccion = $8, rubro = $9, cbu = $10, alias_cbu = $11, dias_pago = $12, notas = $13
			WHERE id = $14`, append(args, *f.ID)...); err != nil {
			return "", "", err
		}
		bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "proveedor", *f.ID, "Editó la ficha de "+f.Nombre, nil)
		return *f.ID, "Ficha guardada.", nil
	}
	var id string
	if err := s.pool.QueryRow(ctx, `
		INSERT INTO suppliers (nombre, razon_social, cuit, condicion_iva, contacto, telefono, email, direccion, rubro, cbu, alias_cbu, dias_pago, notas)
		VALUES ($1, $2, $3, $4::condicion_iva, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`, args...).Scan(&id); err != nil {
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "proveedor", id, "Dio de alta a "+f.Nombre, nil)
	return id, "Proveedor creado.", nil
}

// subeLaDeuda son los tipos que suman: el signo lo pone el tipo, no quien carga.
var subeLaDeuda = map[string]bool{"factura": true, "nota_debito": true, "ajuste": true}

// RegistrarMovimiento es registrarMovimientoDeProveedor.
func (s *Servicio) RegistrarMovimiento(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, error) {
	x, err := leerMovimiento(m)
	if err != nil {
		return "", err
	}
	conSigno := x.Monto
	if !subeLaDeuda[x.Tipo] {
		conSigno = -x.Monto
	}
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO supplier_movements (supplier_id, tipo, monto, detalle, referencia, created_by_user_id)
		VALUES ($1, $2::tipo_movimiento_proveedor, $3::numeric, $4, $5, $6)`,
		x.SupplierID, x.Tipo, jsmath.Fijo2(conSigno), x.Detalle, x.Referencia, ses.UserID); err != nil {
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
		"Anotó "+strings.Replace(x.Tipo, "_", " ", 1)+" por $"+jsmath.Fijo2(x.Monto)+ref, nil)
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
	if _, err := s.pool.Exec(ctx, `DELETE FROM supplier_terms WHERE id = $1 AND supplier_id = $2`, id, supplierID); err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEliminar, "condicion_proveedor", id, "Borró una condición de pago del proveedor", nil)
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

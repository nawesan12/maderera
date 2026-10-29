package mostrador

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/caja"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/cuit"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/numeracion"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
	"mjbj/internal/zodjs"
)

// diasDeValidez de un presupuesto de mostrador, igual que los del panel.
const diasDeValidez = 15

// Presupuesto es emitirPresupuestoDeMostrador: lo cargado, sin cobrar, en la
// cola de presupuestos con origen «mostrador». Devuelve el id y el número.
func (s *Servicio) Presupuesto(ctx context.Context, ses *auth.Sesion, p PresupuestoPedido) (string, string, error) {
	subtotal := 0.0
	for _, l := range p.Lineas {
		subtotal += jsmath.Round(float64(float64(l.Cantidad*l.PrecioUnitario)*100)) / 100
	}
	var vendedor *string
	if p.CustomerID != nil {
		err := s.pool.QueryRow(ctx, `SELECT seller_id FROM customers WHERE id = $1`, *p.CustomerID).Scan(&vendedor)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", "", err
		}
	}
	ahora := s.ahora()
	// setDate(getDate() + 15): quince días de calendario argentino, a la misma hora.
	a := ahora.In(caja.Argentina)
	valido := time.Date(a.Year(), a.Month(), a.Day()+diasDeValidez, a.Hour(), a.Minute(), a.Second(), a.Nanosecond(), caja.Argentina)
	var id, numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		if numero, err = numeracion.Presupuesto(ctx, tx, ahora.In(caja.Argentina)); err != nil {
			return err
		}
		asesor := ses.Nombre
		if err := tx.QueryRow(ctx, `
			INSERT INTO quotes (numero, customer_id, contacto_nombre, contacto_telefono, branch_id, estado, origen,
			                    subtotal, total, notas, asesor, seller_id, valido_hasta, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5, 'enviado', 'mostrador', $6::numeric, $6::numeric, $7, $8, $9, $10, $11) RETURNING id`,
			numero, p.CustomerID, p.ContactoNombre, p.ContactoTelefono, p.BranchID, jsmath.Fijo2(subtotal), p.Notas,
			asesor, vendedor, valido, ses.UserID).Scan(&id); err != nil {
			return err
		}
		for i, l := range p.Lineas {
			if _, err := tx.Exec(ctx, `
				INSERT INTO quote_items (quote_id, variant_id, descripcion, unidad, cantidad, precio_unitario, subtotal, presentacion, orden)
				VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9)`,
				id, l.VariantID, l.Descripcion, l.Unidad, jsmath.Fijo2(l.Cantidad), jsmath.Fijo2(l.PrecioUnitario),
				jsmath.Fijo2(jsmath.Round(float64(float64(l.Cantidad*l.PrecioUnitario)*100))/100), l.Presentacion, i); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", "", err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "presupuesto", numero, "Presupuesto "+numero+" emitido desde el mostrador para "+p.ContactoNombre, nil)
	return id, numero, nil
}

// ClienteNuevo es lo que devuelve el alta rápida.
type ClienteNuevo struct {
	ID           string  `json:"id"`
	Nombre       string  `json:"nombre"`
	RazonSocial  *string `json:"razonSocial"`
	Cuit         *string `json:"cuit"`
	CondicionIva string  `json:"condicionIva"`
	Estado       string  `json:"estado"`
	PriceListID  *string `json:"priceListId"`
	Direccion    *string `json:"direccion"`
}

// ResultadoAlta es crearClienteEnMostrador.
type ResultadoAlta struct {
	Ok        bool          `json:"ok"`
	Cliente   *ClienteNuevo `json:"cliente,omitempty"`
	Error     string        `json:"error,omitempty"`
	Existente *struct {
		ID     string `json:"id"`
		Nombre string `json:"nombre"`
	} `json:"existente,omitempty"`
}

// AltaRapida da de alta un cliente sin salir de la venta. Si el documento ya
// es de otra ficha, no la crea: ofrece la que existe.
func (s *Servicio) AltaRapida(ctx context.Context, ses *auth.Sesion, a AltaRapida) (ResultadoAlta, error) {
	doc, e := clientes.LeerDocumento(a.Documento)
	if e != "" {
		return ResultadoAlta{Error: e}, nil
	}
	if a.CondicionIva == "responsable_inscripto" && doc.Tipo != "cuit" {
		return ResultadoAlta{Error: "Un responsable inscripto necesita el CUIT para la factura A."}, nil
	}
	if doc.Tipo != "ninguno" {
		formas := []string{doc.Digitos}
		if doc.Tipo == "cuit" {
			formas = append(formas, cuit.FormatearLargo(doc.Digitos))
		}
		var ex struct{ ID, Nombre string }
		err := s.pool.QueryRow(ctx, `SELECT id, nombre FROM customers WHERE active = true AND cuit = ANY($1) LIMIT 1`, formas).Scan(&ex.ID, &ex.Nombre)
		if err == nil {
			r := ResultadoAlta{Error: "Ese documento ya es de " + ex.Nombre + "."}
			r.Existente = &struct {
				ID     string `json:"id"`
				Nombre string `json:"nombre"`
			}{ex.ID, ex.Nombre}
			return r, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return ResultadoAlta{}, err
		}
	}
	nombre := zodjs.TrimJS(a.Nombre)
	var razon, cuitDoc, tel, rubro *string
	if a.CondicionIva == "responsable_inscripto" {
		razon = &nombre
	}
	if doc.Tipo != "ninguno" {
		cuitDoc = &doc.Digitos
	}
	if a.Telefono != nil {
		if t := zodjs.TrimJS(*a.Telefono); t != "" {
			tel = &t
		}
	}
	if a.Rubro != nil && *a.Rubro != "" {
		rubro = a.Rubro
	}
	tipo := "particular"
	if rubro != nil && *rubro != "particular" {
		tipo = "profesional"
	}
	var c ClienteNuevo
	err := s.pool.QueryRow(ctx, `
		INSERT INTO customers (nombre, razon_social, cuit, condicion_iva, telefono, rubro, tipo, direccion, notas)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'Ficha creada en el mostrador.')
		RETURNING id, nombre, razon_social, cuit, condicion_iva::text, estado::text, price_list_id, direccion`,
		nombre, razon, cuitDoc, a.CondicionIva, tel, rubro, tipo).
		Scan(&c.ID, &c.Nombre, &c.RazonSocial, &c.Cuit, &c.CondicionIva, &c.Estado, &c.PriceListID, &c.Direccion)
	if err != nil {
		return ResultadoAlta{}, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCrear, "cliente", c.ID, "Dio de alta a "+c.Nombre+" desde el mostrador", nil)
	return ResultadoAlta{Ok: true, Cliente: &c}, nil
}

// CobroDeCuenta es lo que devuelve cobrarCuentaEnMostrador.
type CobroDeCuenta struct {
	Ok        string `json:"ok"`
	ReceiptID string `json:"receiptId"`
	Numero    string `json:"numero"`
}

// CobrarCuenta cobra la cuenta corriente de un cliente en el mostrador con
// cobros.EmitirRecibo (la única forma de registrar un pago): el efectivo
// entra al turno abierto de la sucursal; sin turno, no se cobra efectivo.
func (s *Servicio) CobrarCuenta(ctx context.Context, ses *auth.Sesion, cliente, sucursal, partesCrudas string) (CobroDeCuenta, error) {
	if !plataforma.UUIDValido(cliente) || !plataforma.UUIDValido(sucursal) {
		return CobroDeCuenta{}, rechazo("Falta el cliente.")
	}
	partes, e := cobros.LeerPartes(partesCrudas)
	if e != "" {
		return CobroDeCuenta{}, rechazo(e)
	}
	var r cobros.ReciboEmitido
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		hayEfectivo := false
		for _, p := range partes {
			if p.Medio == "efectivo" {
				hayEfectivo = true
			}
		}
		turno, hay, err := caja.TurnoAbiertoDe(ctx, tx, sucursal)
		if err != nil {
			return err
		}
		if hayEfectivo && !hay {
			return &cobros.ErrorDeCobro{Mensaje: "No hay caja abierta: abrila para cobrar en efectivo."}
		}
		var c *cobros.Caja
		if hay {
			c = &cobros.Caja{TurnoID: turno}
		}
		concepto := "Pago de cuenta corriente"
		if r, err = cobros.EmitirRecibo(ctx, tx, cobros.Cobro{
			CustomerID: &cliente, BranchID: &sucursal, Origen: "mostrador", Concepto: &concepto,
			Partes: partes, Caja: c, UsuarioID: &ses.UserID,
		}); err != nil {
			return err
		}
		_, err = cola.Encolar(ctx, sqlc.New(tx), cobros.TrabajoAvisoDeRecibo, map[string]string{"receiptId": r.ReceiptID}, time.Time{})
		return err
	})
	var ec *cobros.ErrorDeCobro
	if errors.As(err, &ec) {
		return CobroDeCuenta{}, rechazo(ec.Mensaje)
	}
	if err != nil {
		return CobroDeCuenta{}, err
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCobrar, "cliente", cliente,
		"Cobró la cuenta en el mostrador con el recibo "+r.Numero+" por "+jsmath.Fijo2(r.Total), map[string]any{"receiptId": r.ReceiptID})
	return CobroDeCuenta{Ok: "Recibo " + r.Numero + " por " + formato.MonedaEntera(r.Total) + ".", ReceiptID: r.ReceiptID, Numero: r.Numero}, nil
}

// CajaFisica es una caja física para elegir al vincular la máquina.
type CajaFisica struct {
	ID          string     `json:"id"`
	Codigo      string     `json:"codigo"`
	Nombre      *string    `json:"nombre"`
	UltimaVezAt *time.Time `json:"-"`
}

// CajasParaVincular son las cajas activas de la sucursal.
func (s *Servicio) CajasParaVincular(ctx context.Context, sucursal string) ([]map[string]any, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT id, codigo, nombre, ultima_vez_at FROM pos_devices
		WHERE branch_id::text = $1 AND activo = true ORDER BY codigo`, sucursal)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []map[string]any{}
	for filas.Next() {
		var c CajaFisica
		if err := filas.Scan(&c.ID, &c.Codigo, &c.Nombre, &c.UltimaVezAt); err != nil {
			return nil, err
		}
		var ultima any
		if c.UltimaVezAt != nil {
			ultima = FechaJS(*c.UltimaVezAt)
		}
		out = append(out, map[string]any{"id": c.ID, "codigo": c.Codigo, "nombre": c.Nombre, "ultimaVezAt": ultima})
	}
	return out, filas.Err()
}

// Vincular devuelve la caja con su secreto (o el error para mostrar).
func (s *Servicio) Vincular(ctx context.Context, id string) (map[string]any, error) {
	var c struct{ ID, Codigo, Secreto string }
	err := s.pool.QueryRow(ctx, `
		UPDATE pos_devices SET ultima_vez_at = now() WHERE id::text = $1 AND activo = true
		RETURNING id, codigo, secreto`, id).Scan(&c.ID, &c.Codigo, &c.Secreto)
	if errors.Is(err, pgx.ErrNoRows) {
		return map[string]any{"error": "Esa caja no existe o está dada de baja."}, nil
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"caja": map[string]any{"id": c.ID, "codigo": c.Codigo, "secreto": c.Secreto}}, nil
}

// Latido dice quién es, si sigue abierta la caja y la hora del servidor, y
// anota los pendientes de la caja física si viene con su secreto.
func (s *Servicio) Latido(ctx context.Context, ses *auth.Sesion, cuerpo map[string]any) (map[string]any, error) {
	sucursal, _ := cuerpo["branchId"].(string)
	if c, ok := cuerpo["caja"].(map[string]any); ok {
		id, ok1 := c["id"].(string)
		secreto, ok2 := c["secreto"].(string)
		pendientes, ok3 := cuerpo["pendientes"].(float64)
		if ok1 && ok2 && ok3 {
			if _, err := caja.AnotarLatido(ctx, s.pool, id, secreto, pendientes); err != nil {
				return nil, err
			}
		}
	}
	var turno any
	if sucursal != "" && plataforma.UUIDValido(sucursal) {
		t, err := caja.Abierto(ctx, s.pool, sucursal)
		if err != nil {
			return nil, err
		}
		if t != nil {
			turno = map[string]any{"id": t.ID, "abiertaAt": FechaJS(t.AbiertaAt)}
		}
	}
	var rol any
	if ses.RolStaff != nil {
		rol = string(*ses.RolStaff)
	}
	return map[string]any{
		"sesion":     map[string]any{"userId": ses.UserID, "nombre": ses.Nombre, "staffRole": rol},
		"turno":      turno,
		"servidorAt": FechaJS(s.ahora()),
	}, nil
}

var _ = strings.TrimSpace
var _ = ventas.Efectivo

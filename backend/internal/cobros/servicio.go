package cobros

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/autorizacion"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas/fragmentos"
)

// Servicio son las acciones de cobro y de cheques del panel.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
	aut  *autorizacion.Servicio
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log, aut: autorizacion.Nuevo(pool, log, "")}
}

// ConAutorizacion le da el servicio del PIN compartido con el mostrador (la
// clave de las fichas y el aviso al tercer error).
func (s *Servicio) ConAutorizacion(a *autorizacion.Servicio) *Servicio {
	s.aut = a
	return s
}

// Los avisos al cliente (correo y WhatsApp con el PDF) los atiende el worker
// (internal/notificaciones): se encolan en la misma transacción del cobro,
// así salen solo si el cobro se confirmó.
const (
	TrabajoAvisoDeRecibo   = "recibo.aviso"
	TrabajoChequeRechazado = "cheque.rechazado"
)

// comoProblema pasa un ErrorDeCobro a un 422 con su mensaje.
func comoProblema(err error) error {
	var e *ErrorDeCobro
	var sinCaja *ErrSinCaja
	switch {
	case errors.Is(err, ErrClaveDeOtroCobro):
		return plataforma.NuevoProblema(409, ErrClaveDeOtroCobro.Mensaje)
	case errors.As(err, &sinCaja):
		// La sucursal va aparte: la pantalla abre la caja ahí mismo, con el
		// fondo de cambio; sin sucursal, las opciones para elegir (en JSON:
		// los errores son texto).
		e := map[string]string{"cobro": sinCaja.Error(), "sinCaja": sinCaja.Sucursal, "fondoBase": jsmath.Fijo2(sinCaja.FondoBase)}
		if len(sinCaja.Sucursales) > 0 {
			b, _ := json.Marshal(sinCaja.Sucursales)
			e["sucursales"] = string(b)
		}
		return plataforma.Invalido(e)
	}
	if errors.As(err, &e) {
		return plataforma.Invalido(map[string]string{"cobro": e.Mensaje})
	}
	return err
}

// ResultadoDeCobro es lo que ve el panel.
type ResultadoDeCobro struct {
	Ok        string  `json:"ok"`
	Aviso     *string `json:"aviso,omitempty"`
	ReceiptID *string `json:"receiptId,omitempty"`
}

// CobrarACliente es registrarCobroDeCliente: un cobro desde la ficha, a
// cuenta o de un pedido (que queda pagado si el recibo lo cubre).
//
// `clave` la genera la pantalla al abrir el diálogo: un reintento devuelve
// el mismo recibo (EmitirRecibo) y no vuelve a avisar ni a marcar el pedido.
func (s *Servicio) CobrarACliente(ctx context.Context, ses *auth.Sesion, cliente, pedido, concepto, partesCrudas, clave string) (ResultadoDeCobro, error) {
	return s.CobrarAClienteEn(ctx, ses, cliente, pedido, concepto, partesCrudas, clave, "")
}

// CobrarAClienteEn es CobrarACliente diciendo en qué sucursal entra el
// efectivo (vacía: la del pedido, o la única caja abierta).
//
// Sin caja abierta, el efectivo no se cobra (mes simulado, H132): antes el
// recibo salía igual y recién después avisaba que el efectivo «no entró al
// arqueo», así que la plata quedaba en el recibo y en ningún cajón. Ahora
// pide abrir la caja antes, como el cobro desde el pedido.
func (s *Servicio) CobrarAClienteEn(ctx context.Context, ses *auth.Sesion, cliente, pedido, concepto, partesCrudas, clave, sucursal string) (ResultadoDeCobro, error) {
	if !plataforma.UUIDValido(cliente) || (pedido != "" && !plataforma.UUIDValido(pedido)) || plataforma.LargoJS(strings.TrimSpace(concepto)) > 200 {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"customerId": "Falta el cliente."})
	}
	partes, e := LeerPartes(partesCrudas)
	if e != "" {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"partes": e})
	}
	if ConRetencion(partes) && (ses.RolStaff == nil || *ses.RolStaff != sqlc.StaffRoleAdmin) {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"partes": "Una retención la carga un administrador, con su certificado."})
	}
	var r ReciboEmitido
	var numeroPedido string
	err := plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		var p *sqlc.PedidoParaCobrarRow
		if pedido != "" {
			fila, err := q.PedidoParaCobrar(ctx, pedido)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && (fila.CustomerID == nil || *fila.CustomerID != cliente)) {
				return errCobro("El pedido no es de este cliente.")
			}
			if err != nil {
				return err
			}
			p = &fila
		}
		c := Cobro{CustomerID: &cliente, Origen: "panel", Partes: partes, Caja: &Caja{Buscar: true}, UsuarioID: &ses.UserID, Clave: clave}
		if hayEfectivo(partes) {
			var donde *string
			if p != nil && p.BranchID != nil {
				donde = p.BranchID
			} else if plataforma.UUIDValido(sucursal) {
				donde = &sucursal
			}
			yaEsta := false
			if clave != "" {
				if err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM receipts WHERE clave = $1)`, clave).Scan(&yaEsta); err != nil {
					return err
				}
			}
			if !yaEsta {
				turno, err := turnoDelPedido(ctx, q, donde)
				if err != nil {
					return err
				}
				if turno == "" {
					return sinCaja(ctx, tx, donde)
				}
				c.Caja = &Caja{TurnoID: turno}
			}
		}
		texto := "Pago a cuenta"
		if t := strings.TrimSpace(concepto); t != "" {
			texto = t
		}
		if p != nil {
			c.BranchID = p.BranchID
			texto = "Cobro del pedido " + p.Numero
			numeroPedido = p.Numero
			c.OrderID = &p.ID
			// La deuda de un pedido de contado no está en la cuenta: el pago
			// tampoco (ver Cobro.FueraDeLaCuenta).
			if err := tx.QueryRow(ctx, `SELECT o.medio_pago IS DISTINCT FROM 'cuenta_corriente'
				AND NOT EXISTS (SELECT 1 FROM account_movements am
				                WHERE am.customer_id = o.customer_id AND am.referencia = o.numero AND am.tipo = 'compra')
				FROM orders o WHERE o.id = $1`, p.ID).Scan(&c.FueraDeLaCuenta); err != nil {
				return err
			}
		}
		c.Concepto = &texto
		var err error
		if r, err = EmitirRecibo(ctx, tx, c); err != nil {
			return err
		}
		if r.Repetido {
			return nil
		}
		// Pagado cuando lo cobrado cubre el total: este recibo, los
		// anteriores del mismo pedido y lo cobrado en línea. Mirar solo este
		// recibo contra el total empujaba a cobrar otra vez la seña.
		if p != nil {
			var pagado bool
			if err := tx.QueryRow(ctx, `SELECT `+fragmentos.CobradoDelPedido+` + 0.005 >= `+fragmentos.ACobrarDelPedido+` FROM orders o WHERE o.id = $1`, p.ID).
				Scan(&pagado); err != nil {
				return err
			}
			if pagado {
				if err := q.PedidoPagado(ctx, p.ID); err != nil {
					return err
				}
			}
		}
		_, err = cola.Encolar(ctx, q, TrabajoAvisoDeRecibo, map[string]string{"receiptId": r.ReceiptID}, time.Time{})
		return err
	})
	if err != nil {
		return ResultadoDeCobro{}, comoProblema(err)
	}
	if r.Repetido {
		return ResultadoDeCobro{Ok: "Recibo " + r.Numero + " emitido.", ReceiptID: &r.ReceiptID}, nil
	}
	// El monto con el formato del resto y el cliente: «Emitió el recibo
	// REC-0035 por 2116200.00» no decía de quién (simulación del mes, H381).
	var nombre string
	_ = s.pool.QueryRow(ctx, `SELECT coalesce(razon_social, nombre) FROM customers WHERE id = $1`, cliente).Scan(&nombre)
	desc := "Emitió el recibo " + r.Numero + " por " + formato.Importe(r.Total)
	if nombre != "" {
		desc += " a " + nombre
	}
	if numeroPedido != "" {
		desc += " (pedido " + numeroPedido + ")"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCobrar, "cliente", cliente, desc, map[string]any{"receiptId": r.ReceiptID})
	return ResultadoDeCobro{Ok: "Recibo " + r.Numero + " emitido.", Aviso: r.Aviso, ReceiptID: &r.ReceiptID}, nil
}

// cobradoPorMercadoPago dice si alguna parte del recibo es un pago de Mercado
// Pago que sigue aprobado. Ese recibo no se anula a mano: la deuda volvería
// entera con la plata todavía en MP, el cliente pagaría dos veces, el cierre
// revertiría un cobro que existió y el reintegro que llegara después se daría
// por hecho sin asentarse. La devolución se hace desde Mercado Pago y su
// aviso anula el recibo solo (pagos.Acreditar llama a AnularRecibo, no a
// esto).
//
// La transferencia del portal sí se anula: la plata no queda en ningún
// proveedor que avise, y anular es la única forma de corregir una
// conciliación equivocada o de registrar que se devolvió por el banco.
func cobradoPorMercadoPago(ctx context.Context, tx pgx.Tx, recibo string) (bool, error) {
	var si bool
	err := tx.QueryRow(ctx, `SELECT exists(SELECT 1 FROM receipt_parts x JOIN payments pay ON pay.id = x.payment_id
		WHERE x.receipt_id = $1 AND pay.estado = 'aprobado' AND pay.proveedor = 'mercado_pago')`, recibo).Scan(&si)
	return si, err
}

// Anular es anularReciboDesdeElPanel: los roles que manejan plata, salvo el
// recibo de un cobro de Mercado Pago (cobradoPorMercadoPago).
func (s *Servicio) Anular(ctx context.Context, ses *auth.Sesion, recibo, motivo string) (string, error) {
	return s.AnularConPIN(ctx, ses, recibo, motivo, "")
}

// AnularConPIN es Anular con la firma de un admin (mes simulado, H278): la
// vendedora anulaba un recibo de $1.880.100 con el motivo solo, mientras que
// anular una venta pide el PIN. Ahora pide lo mismo que anular una venta: el
// admin firma solo; el resto, con el PIN de un admin.
func (s *Servicio) AnularConPIN(ctx context.Context, ses *auth.Sesion, recibo, motivo, pin string) (string, error) {
	if strings.TrimSpace(motivo) == "" {
		return "", plataforma.Invalido(map[string]string{"motivo": "Poné el motivo de la anulación."})
	}
	// El cobro de Mercado Pago no se anula desde el panel, ni con PIN: se dice
	// eso antes de pedir el PIN de algo que igual no se puede.
	var porMP bool
	if err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) (err error) {
		porMP, err = cobradoPorMercadoPago(ctx, tx, recibo)
		return err
	}); err != nil {
		return "", err
	}
	if porMP {
		return "", comoProblema(errCobro("Este cobro entró por Mercado Pago: devolvelo desde Mercado Pago y el recibo se anula solo cuando llega el aviso."))
	}
	if !ses.Tiene(sqlc.StaffRoleAdmin) {
		var total float64
		err := s.pool.QueryRow(ctx, `SELECT total::float8 FROM receipts WHERE id::text = $1`, recibo).Scan(&total)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", plataforma.NuevoProblema(404, "No se encontró el recibo.")
		}
		if err != nil {
			return "", err
		}
		if _, err := s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Anular, Monto: total, Clave: recibo, PIN: pin}); err != nil {
			var falta *autorizacion.Falta
			if errors.As(err, &falta) {
				e := map[string]string{"pin": falta.Mensaje(), "pinMonto": jsmath.Fijo2(falta.Monto)}
				if falta.PinIncorrecto {
					e["pinIncorrecto"] = "si"
				}
				if falta.BloqueadoHasta != nil {
					e["pinHasta"] = falta.BloqueadoHasta.UTC().Format(time.RFC3339)
				}
				return "", plataforma.Invalido(e)
			}
			return "", err
		}
	}
	limpio := strings.TrimSpace(motivo)
	if r := []rune(limpio); len(r) > 300 {
		limpio = string(r[:300])
	}
	if limpio == "" {
		return "", plataforma.Invalido(map[string]string{"motivo": "Poné el motivo de la anulación."})
	}
	var numero string
	err := plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		if err := sqlc.New(tx).BloquearRecibo(ctx, recibo); err != nil {
			return err
		}
		porMP, err := cobradoPorMercadoPago(ctx, tx, recibo)
		if err != nil {
			return err
		}
		if porMP {
			return errCobro("Este cobro entró por Mercado Pago: devolvelo desde Mercado Pago y el recibo se anula solo cuando llega el aviso.")
		}
		numero, _, err = AnularRecibo(ctx, tx, recibo, limpio, &ses.UserID)
		return err
	})
	if err != nil {
		return "", comoProblema(err)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaAnular, "recibo", recibo, "Anuló el recibo "+numero+": "+limpio, nil)
	return "Recibo " + numero + " anulado. La deuda volvió a la cuenta.", nil
}

// FormCheque es la carga a mano de un cheque, como texto.
type FormCheque struct {
	Sentido, Tipo, Numero, Banco, Librador, FechaPago, Importe, CustomerID, Circuito, Notas string
}

// fechaCorta es toLocaleDateString("es-AR"): «1/11/2026».
func fechaCorta(t time.Time) string {
	l := t.In(argentina)
	return fmt.Sprintf("%d/%d/%d", l.Day(), int(l.Month()), l.Year())
}

// CargarCheque es cargarCheque: uno recibido entra a la cartera, uno
// entregado nace endosado.
func (s *Servicio) CargarCheque(ctx context.Context, ses *auth.Sesion, f FormCheque) error {
	mal := func(campo, m string) error { return plataforma.Invalido(map[string]string{campo: m}) }
	if f.Sentido == "" {
		f.Sentido = "recibido"
	}
	if f.Tipo == "" {
		f.Tipo = "fisico"
	}
	if f.Circuito == "" {
		f.Circuito = "blanco"
	}
	numero := strings.TrimSpace(f.Numero)
	banco := strings.TrimSpace(f.Banco)
	librador := strings.TrimSpace(f.Librador)
	notas := strings.TrimSpace(f.Notas)
	switch {
	case f.Sentido != "recibido" && f.Sentido != "entregado":
		return mal("sentido", `Invalid option: expected one of "recibido"|"entregado"`)
	case f.Tipo != "fisico" && f.Tipo != "echeq":
		return mal("tipo", `Invalid option: expected one of "fisico"|"echeq"`)
	case numero == "":
		return mal("numero", "Poné el número del cheque.")
	case plataforma.LargoJS(numero) > 40:
		return mal("numero", "Too big: expected string to have <=40 characters")
	case plataforma.LargoJS(banco) > 60:
		return mal("banco", "Too big: expected string to have <=60 characters")
	case plataforma.LargoJS(librador) > 120:
		return mal("librador", "Too big: expected string to have <=120 characters")
	case f.FechaPago == "":
		return mal("fechaPago", "Poné la fecha de pago: es lo que ordena la cartera.")
	case f.Importe == "":
		return mal("importe", "Poné el importe.")
	case f.CustomerID != "" && f.Sentido == "recibido":
		// Un cheque que trae un cliente para pagar se carga cobrándole
		// (EmitirRecibo): así sale el recibo y le baja la deuda. Cargado acá
		// quedaba en la cartera a su nombre sin tocar la cuenta.
		return mal("customerId", "Un cheque de un cliente se carga cobrándole: así sale el recibo y le baja la deuda.")
	case f.CustomerID != "" && !plataforma.UUIDValido(f.CustomerID):
		return mal("customerId", "Invalid UUID")
	case f.Circuito != "blanco" && f.Circuito != "negro":
		return mal("circuito", `Invalid option: expected one of "blanco"|"negro"`)
	case plataforma.LargoJS(notas) > 500:
		return mal("notas", "Too big: expected string to have <=500 characters")
	}
	if p := RevisarNumeroDeCheque(numero); p != "" {
		return mal("numero", p)
	}
	numero = NormalizarNumeroDeCheque(numero)
	importe := precios.ParsearImporte(f.Importe)
	if math.IsNaN(importe) || math.IsInf(importe, 0) || importe <= 0 {
		return mal("importe", "El importe tiene que ser mayor a cero.")
	}
	if f.Tipo == "echeq" && f.Circuito == "negro" {
		return mal("circuito", "Un e-Cheq no puede ir por el circuito B: queda registrado en el banco a nombre de la empresa.")
	}
	fecha, ok := LeerFechaDeCheque(f.FechaPago)
	if !ok {
		return mal("fechaPago", "Esa fecha no existe.")
	}
	if m := RevisarFechaDeCheque(fecha, time.Now()); m != "" {
		return mal("fechaPago", m)
	}
	if f.Sentido == "recibido" {
		if _, err := s.q.ChequeRepetido(ctx, sqlc.ChequeRepetidoParams{Numero: numero, Banco: banco}); err == nil {
			return mal("numero", NombreDelCheque(f.Tipo, nulo(banco), numero)+" ya está en la cartera.")
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	estado := sqlc.EstadoChequeEntregado
	if f.Sentido == "recibido" {
		estado = sqlc.EstadoChequeCartera
	}
	if err := s.q.CargarCheque(ctx, sqlc.CargarChequeParams{
		Sentido: sqlc.SentidoCheque(f.Sentido), Tipo: sqlc.TipoCheque(f.Tipo), Numero: numero, Banco: nulo(banco),
		Librador: nulo(librador), FechaPago: fecha, Importe: jsmath.Fijo2(importe), Estado: estado,
		CustomerID: nulo(f.CustomerID), Circuito: sqlc.Circuito(f.Circuito), Notas: nulo(notas), CreatedByUserID: &ses.UserID,
	}); err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			return mal("numero", NombreDelCheque(f.Tipo, nulo(banco), numero)+" ya está en la cartera.")
		}
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "cheque", "",
		"Cheque "+f.Sentido+" "+numero+" por "+formato.Importe(importe)+", al "+fechaCorta(fecha), nil)
	return nil
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// reabrirDeudaConElProveedor anota en la cuenta del proveedor al que se le
// pagó con el cheque que el banco rechazó un ajuste por su importe.
func reabrirDeudaConElProveedor(ctx context.Context, tx pgx.Tx, cheque sqlc.Cheque, motivo, usuario string) error {
	var proveedor string
	err := tx.QueryRow(ctx, `SELECT p.supplier_id FROM supplier_payment_parts x JOIN supplier_payments p ON p.id = x.payment_id
		WHERE x.cheque_id = $1 AND p.anulado_at IS NULL ORDER BY p.fecha DESC LIMIT 1`, cheque.ID).Scan(&proveedor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	detalle := NombreDelCheque(string(cheque.Tipo), cheque.Banco, cheque.Numero) + " rechazado por el banco"
	if motivo != "" {
		detalle += ": " + motivo
	}
	// Atado al cheque: es la deuda que Pagos ofrece reponer (mes simulado,
	// H293: los $400.000 subían la cuenta y no había dónde pagarlos).
	_, err = tx.Exec(ctx, `INSERT INTO supplier_movements (supplier_id, tipo, monto, referencia, detalle, created_by_user_id, cheque_id)
		VALUES ($1, 'ajuste', $2::numeric, $3, $4, $5, $6)`, proveedor, jsmath.Fijo2(float64(cheque.Importe)), cheque.Numero, detalle, usuario, cheque.ID)
	return err
}

// RechazablesDesdeLaFicha son los estados de un cheque recibido que el banco
// puede devolver: en la cartera (se depositó en otro lado o lo avisó el
// banco), depositado o endosado a un proveedor.
var RechazablesDesdeLaFicha = []Estado{"cartera", "depositado", "entregado"}

// RechazarConPIN registra que el banco rechazó un cheque de un cliente,
// desde su ficha (H272): quien no es admin, con el PIN de uno (motivo
// cheque, por el importe), porque vuelve la deuda. Después es el mismo
// CambiarEstado de /admin/cheques: la nota de débito, el aviso al cliente y,
// si estaba endosado, la deuda con el proveedor.
func (s *Servicio) RechazarConPIN(ctx context.Context, ses *auth.Sesion, id, motivo, pin string) (ResultadoDeCobro, error) {
	if strings.TrimSpace(motivo) == "" {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"motivo": "Poné el motivo del rechazo: lo lee el cliente."})
	}
	var estado, sentido string
	var importe float64
	err := s.pool.QueryRow(ctx, `SELECT estado::text, sentido::text, importe::float8 FROM cheques WHERE id::text = $1`, id).Scan(&estado, &sentido, &importe)
	if errors.Is(err, pgx.ErrNoRows) {
		return ResultadoDeCobro{}, plataforma.NuevoProblema(404, "Ese cheque no está.")
	}
	if err != nil {
		return ResultadoDeCobro{}, err
	}
	if sentido != "recibido" {
		return ResultadoDeCobro{}, comoProblema(errCobro("Ese cheque no es de un cliente."))
	}
	if !slices.Contains(RechazablesDesdeLaFicha, Estado(estado)) {
		return ResultadoDeCobro{}, comoProblema(errCobro("Un cheque " + strings.ToLower(ParaElCliente[Estado(estado)]) + " no se puede rechazar."))
	}
	if !ses.Tiene(sqlc.StaffRoleAdmin) {
		if _, err := s.aut.Exigir(ctx, ses, autorizacion.Pedido{Motivo: autorizacion.Cheque, Monto: importe, Clave: id, PIN: pin}); err != nil {
			var falta *autorizacion.Falta
			if errors.As(err, &falta) {
				e := map[string]string{"pin": falta.Mensaje(), "pinMonto": jsmath.Fijo2(falta.Monto)}
				if falta.PinIncorrecto {
					e["pinIncorrecto"] = "si"
				}
				if falta.ConClave {
					e["pinConClave"] = "si"
				}
				if falta.SinAdmins && !falta.ConClave {
					e["pinSinAdmins"] = "si"
				}
				if falta.BloqueadoHasta != nil {
					e["pinHasta"] = falta.BloqueadoHasta.UTC().Format(time.RFC3339)
				}
				return ResultadoDeCobro{}, plataforma.Invalido(e)
			}
			return ResultadoDeCobro{}, err
		}
	}
	return s.CambiarEstado(ctx, ses, id, "rechazado", motivo)
}

// CambiarEstado es cambiarEstadoDeCheque: aceptar uno informado emite el
// recibo; rechazar uno que ya contaba devuelve la deuda con una nota de
// débito; los dos avisan al cliente.
func (s *Servicio) CambiarEstado(ctx context.Context, ses *auth.Sesion, id, nuevo, motivo string) (ResultadoDeCobro, error) {
	hacia := Estado(nuevo)
	m := strings.TrimSpace(motivo)
	if r := []rune(m); len(r) > 300 {
		m = string(r[:300])
	}
	if hacia == "rechazado" && m == "" {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"motivo": "Poné el motivo del rechazo: lo lee el cliente."})
	}
	var desde Estado
	var cheque sqlc.Cheque
	var recibo ReciboEmitido
	debitado := false
	err := plataforma.EnTransaccion(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		// Quién: lo lee el trigger que anota el cambio en cheque_estados.
		if _, err := tx.Exec(ctx, `SELECT set_config('mjbj.usuario', $1, true)`, ses.UserID); err != nil {
			return err
		}
		if err := q.BloquearCheque(ctx, id); err != nil {
			return err
		}
		var err error
		cheque, err = q.ChequeCompleto(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return errCobro("Ese cheque no está.")
		}
		if err != nil {
			return err
		}
		desde = Estado(cheque.Estado)
		if !PuedePasar(desde, hacia) {
			nombre := ParaElCliente[hacia]
			if nombre == "" {
				nombre = string(hacia)
			}
			return errCobro("Un cheque " + strings.ToLower(ParaElCliente[desde]) + " no puede pasar a " + strings.ToLower(nombre) + ".")
		}
		// Un cheque que entró con un recibo emitido no se anula suelto: el
		// recibo ya bajó la deuda, y anular solo el cheque la dejaba pagada
		// con plata que no entró nunca. Anular el recibo devuelve la deuda y
		// anula el cheque en el mismo acto (AnularRecibo).
		if hacia == "anulado" && cheque.ReceiptID != nil {
			var numero, estado string
			if err := tx.QueryRow(ctx, `SELECT numero, estado::text FROM receipts WHERE id = $1`, *cheque.ReceiptID).Scan(&numero, &estado); err != nil {
				return err
			}
			if estado != "anulado" {
				return errCobro("Este cheque entró con el recibo " + numero + ": anulá el recibo " + numero +
					", que devuelve la deuda del cliente y anula el cheque.")
			}
		}
		// Lo mismo con el cheque que pagó una venta del mostrador: no tiene
		// recibo, pero la venta quedó cobrada con él. Anularlo suelto dejaba la
		// venta pagada y la mercadería entregada con un cheque que ya no
		// cuenta. Anular la venta desde el mostrador revierte todo junto.
		if hacia == "anulado" && cheque.ReceiptID == nil && cheque.OrderPaymentID != nil {
			var numero, estado string
			err := tx.QueryRow(ctx, `SELECT o.numero, o.estado::text FROM order_payments p JOIN orders o ON o.id = p.order_id
				WHERE p.id = $1`, *cheque.OrderPaymentID).Scan(&numero, &estado)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if err == nil && estado != "cancelado" {
				return errCobro("Este cheque pagó la venta " + numero + " del mostrador: anulá la venta " + numero +
					" desde el mostrador, que devuelve la plata o la deuda y anula el cheque.")
			}
		}
		// Un diferido no se deposita antes de su fecha: el banco lo rechaza
		// (mes simulado, H405: el 55500901 del 20/12 se depositó y acreditó
		// el 26/11 con dos clics).
		if hacia == "depositado" {
			if m := RevisarDeposito(cheque.FechaPago, time.Now()); m != "" {
				return errCobro(m)
			}
		}
		efecto := "nada"
		if cheque.Sentido == sqlc.SentidoChequeRecibido {
			efecto = Efecto(desde, hacia)
		}
		// Rechazar devuelve la deuda solo si el cheque la había bajado: entró
		// con un recibo, pagó una venta del mostrador o tiene un pago en la
		// cuenta (los de antes de los recibos). Uno cargado a mano en la
		// cartera nunca tocó la cuenta, y rechazarlo le sumaba al cliente una
		// nota de débito por plata que no debía.
		if efecto == "debitar" && cheque.ReceiptID == nil && cheque.OrderPaymentID == nil {
			var bajoLaDeuda bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM account_movements WHERE cheque_id = $1 AND monto < 0)`, id).Scan(&bajoLaDeuda); err != nil {
				return err
			}
			if !bajoLaDeuda {
				efecto = "nada"
			}
		}
		if efecto == "acreditar" {
			medio := Medio("cheque")
			if cheque.Tipo == sqlc.TipoChequeEcheq {
				medio = "echeq"
			}
			concepto := "Pago de cuenta corriente"
			recibo, err = EmitirRecibo(ctx, tx, Cobro{
				CustomerID: cheque.CustomerID, Origen: "portal", Concepto: &concepto, Circuito: string(cheque.Circuito),
				Partes: []Parte{{Medio: medio, Importe: float64(cheque.Importe), ChequeID: &cheque.ID}}, UsuarioID: &ses.UserID,
			})
			if err != nil {
				return err
			}
			if _, err := cola.Encolar(ctx, q, TrabajoAvisoDeRecibo, map[string]string{"receiptId": recibo.ReceiptID}, time.Time{}); err != nil {
				return err
			}
		} else {
			motivoRechazo := cheque.MotivoRechazo
			if hacia == "rechazado" {
				motivoRechazo = nulo(m)
			}
			if err := q.CambiarEstadoDelCheque(ctx, sqlc.CambiarEstadoDelChequeParams{ID: id, Estado: sqlc.EstadoCheque(hacia), MotivoRechazo: motivoRechazo}); err != nil {
				return err
			}
		}
		if efecto == "debitar" && cheque.CustomerID != nil {
			detalle := NombreDelCheque(string(cheque.Tipo), cheque.Banco, cheque.Numero) + " rechazado por el banco"
			if m != "" {
				detalle += ": " + m
			}
			if _, err := q.AsentarMovimiento(ctx, sqlc.AsentarMovimientoParams{
				CustomerID: *cheque.CustomerID, Tipo: sqlc.TipoMovimientoCuentaNotaDebito, Monto: jsmath.Fijo2(float64(cheque.Importe)),
				Detalle: &detalle, Referencia: &cheque.Numero, ChequeID: &cheque.ID, ReceiptID: cheque.ReceiptID, CreatedByUserID: &ses.UserID,
			}); err != nil {
				return err
			}
			debitado = true
		}
		// El cheque que le dimos a un proveedor (uno propio o uno de la
		// cartera endosado) y rebotó: le volvemos a deber. La deuda se
		// reabre en su libro, así el libro y el mayor de Proveedores dicen
		// lo mismo (el cierre asienta el rechazo contra Proveedores).
		if hacia == "rechazado" && desde == "entregado" {
			if err := reabrirDeudaConElProveedor(ctx, tx, cheque, m, ses.UserID); err != nil {
				return err
			}
		}
		if hacia == "rechazado" && cheque.Sentido == sqlc.SentidoChequeRecibido {
			if _, err := cola.Encolar(ctx, q, TrabajoChequeRechazado, map[string]any{"chequeId": id, "porElBanco": desde != "informado"}, time.Time{}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return ResultadoDeCobro{}, comoProblema(err)
	}
	desc := "Cheque " + cheque.Numero + ": " + string(desde) + " → " + string(hacia)
	if m != "" {
		desc += " (" + m + ")"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "cheque", id, desc, nil)
	switch {
	case recibo.Numero != "":
		return ResultadoDeCobro{Ok: "Cheque aceptado. Se emitió el recibo " + recibo.Numero + ".", ReceiptID: &recibo.ReceiptID}, nil
	case debitado && desde == "entregado":
		return ResultadoDeCobro{Ok: "Rechazado: la deuda volvió a la cuenta del cliente. El cheque estaba endosado: hay que reponérselo al proveedor."}, nil
	case debitado:
		return ResultadoDeCobro{Ok: "Rechazado: la deuda volvió a la cuenta del cliente y se le avisó."}, nil
	case hacia == "rechazado" && cheque.Sentido == sqlc.SentidoChequeRecibido:
		return ResultadoDeCobro{Ok: "Rechazado. La cuenta del cliente no cambió y se le avisó."}, nil
	}
	return ResultadoDeCobro{Ok: "Estado actualizado."}, nil
}

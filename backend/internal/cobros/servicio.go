package cobros

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cola"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
)

// Servicio son las acciones de cobro y de cheques del panel.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
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
func (s *Servicio) CobrarACliente(ctx context.Context, ses *auth.Sesion, cliente, pedido, concepto, partesCrudas string) (ResultadoDeCobro, error) {
	if !plataforma.UUIDValido(cliente) || (pedido != "" && !plataforma.UUIDValido(pedido)) || plataforma.LargoJS(strings.TrimSpace(concepto)) > 200 {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"customerId": "Falta el cliente."})
	}
	partes, e := LeerPartes(partesCrudas)
	if e != "" {
		return ResultadoDeCobro{}, plataforma.Invalido(map[string]string{"partes": e})
	}
	var r ReciboEmitido
	var numeroPedido string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
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
		c := Cobro{CustomerID: &cliente, Origen: "panel", Partes: partes, Caja: &Caja{Buscar: true}, UsuarioID: &ses.UserID}
		texto := "Pago a cuenta"
		if t := strings.TrimSpace(concepto); t != "" {
			texto = t
		}
		if p != nil {
			c.BranchID = p.BranchID
			texto = "Cobro del pedido " + p.Numero
			numeroPedido = p.Numero
		}
		c.Concepto = &texto
		var err error
		if r, err = EmitirRecibo(ctx, tx, c); err != nil {
			return err
		}
		if p != nil && r.Total+0.005 >= p.Total {
			if err := q.PedidoPagado(ctx, p.ID); err != nil {
				return err
			}
		}
		_, err = cola.Encolar(ctx, q, TrabajoAvisoDeRecibo, map[string]string{"receiptId": r.ReceiptID}, time.Time{})
		return err
	})
	if err != nil {
		return ResultadoDeCobro{}, comoProblema(err)
	}
	desc := "Emitió el recibo " + r.Numero + " por " + jsmath.Fijo2(r.Total)
	if numeroPedido != "" {
		desc += " (pedido " + numeroPedido + ")"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCobrar, "cliente", cliente, desc, map[string]any{"receiptId": r.ReceiptID})
	return ResultadoDeCobro{Ok: "Recibo " + r.Numero + " emitido.", Aviso: r.Aviso, ReceiptID: &r.ReceiptID}, nil
}

// Anular es anularReciboDesdeElPanel (solo el admin).
func (s *Servicio) Anular(ctx context.Context, ses *auth.Sesion, recibo, motivo string) (string, error) {
	limpio := strings.TrimSpace(motivo)
	if r := []rune(limpio); len(r) > 300 {
		limpio = string(r[:300])
	}
	if limpio == "" {
		return "", plataforma.Invalido(map[string]string{"motivo": "Poné el motivo de la anulación."})
	}
	var numero string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
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
	fecha, err := time.ParseInLocation("2006-01-02T15:04:05", f.FechaPago+"T12:00:00", argentina)
	if err != nil {
		return mal("fechaPago", "Poné la fecha de pago: es lo que ordena la cartera.")
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
		"Cheque "+f.Sentido+" "+numero+" por $"+jsmath.Fijo2(importe)+", al "+fechaCorta(fecha), nil)
	return nil
}

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
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
		efecto := "nada"
		if cheque.Sentido == sqlc.SentidoChequeRecibido {
			efecto = Efecto(desde, hacia)
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

package cobros

import (
	"context"
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"mjbj/internal/formato"
	"mjbj/internal/sqlc"
)

// MovimientoDelCliente es un renglón del historial que ven el panel y el
// cliente: el libro de la cuenta corriente, las compras de contado (que no
// mueven la cuenta), las transferencias informadas y los cheques que todavía
// no son plata (lib/dal/historial-cliente.ts).
type MovimientoDelCliente struct {
	ID                 string     `json:"id"`
	Fecha              time.Time  `json:"fecha"`
	Clase              string     `json:"clase"`
	Titulo             string     `json:"titulo"`
	Detalle            *string    `json:"detalle"`
	Importe            *float64   `json:"importe"`
	ImporteInformativo *float64   `json:"importeInformativo"`
	Pedido             *RefPedido `json:"pedido"`
	Recibo             *RefRecibo `json:"recibo"`
	// Cheques son los cheques del renglón que el banco todavía puede
	// rechazar (en la cartera, depositados o endosados): la ficha ofrece
	// registrar el rechazo desde ahí (H272).
	Cheques []RefCheque `json:"cheques,omitempty"`
}

// RefCheque es un cheque que se puede rechazar desde la ficha.
type RefCheque struct {
	ID      string  `json:"id"`
	Nombre  string  `json:"nombre"`
	Importe float64 `json:"importe"`
}

// RefPedido es el pedido de un renglón.
type RefPedido struct {
	ID     string `json:"id"`
	Numero string `json:"numero"`
}

// RefRecibo es el recibo de un renglón.
type RefRecibo struct {
	ID      string `json:"id"`
	Numero  string `json:"numero"`
	Anulado bool   `json:"anulado"`
	// PorMercadoPago: una parte es un cobro de Mercado Pago que sigue
	// aprobado. Ese recibo no se anula desde el panel (Servicio.Anular): se
	// devuelve desde MP y el aviso lo anula.
	PorMercadoPago bool `json:"porMercadoPago"`
	// ChequeRechazado: el banco rechazó un cheque de este recibo y volvió a
	// la cuenta con una nota de débito. El recibo emitido no cambia (lo
	// emitido no se edita), pero el pago no puede verse entero (H303).
	ChequeRechazado bool `json:"chequeRechazado,omitempty"`
}

// DetalleParaElCliente saca de un asiento lo que se escribió para la casa.
// La anulación de una venta guarda su motivo («…: se cargó a la Mueblería y
// era de la Constructora»), y el cliente se enteraba de lo que había
// comprado otro (H386). La cancelación de un pedido desde el panel lo
// guarda igual («Cancelación del pedido PED-1219: se cargó a la
// Constructora…», tercera prueba). El motivo sigue en el pedido y en la
// bitácora.
//
// La anulación de un recibo también: el cliente leía «Anulación del recibo
// REC-0006: Sim: se cargó por error» (mes simulado, M2S1-153).
func DetalleParaElCliente(detalle *string) *string {
	if detalle == nil || !(strings.HasPrefix(*detalle, "Anulación de la venta ") || strings.HasPrefix(*detalle, "Cancelación del pedido ") ||
		strings.HasPrefix(*detalle, PrefijoAnulacionDeRecibo)) {
		return detalle
	}
	if i := strings.Index(*detalle, ": "); i > 0 {
		t := (*detalle)[:i]
		return &t
	}
	return detalle
}

// PrefijoAnulacionDeRecibo es cómo empieza el asiento que deshace un recibo.
const PrefijoAnulacionDeRecibo = "Anulación del recibo "

// HistorialParaElCliente es el historial como lo lee el cliente en Mi cuenta.
//
// El pago de un recibo anulado y el ajuste que lo deshace se compensan: al
// cliente le queda un solo renglón, «Recibo REC-0006 anulado», sin importe
// que sume (M2S1-153). El panel los sigue viendo por separado.
func HistorialParaElCliente(movs []MovimientoDelCliente) []MovimientoDelCliente {
	anulados := map[string]bool{}
	for _, m := range movs {
		if m.Clase == "pago" && m.Recibo != nil && m.Recibo.Anulado && m.Recibo.Numero != "" {
			anulados[m.Recibo.Numero] = true
		}
	}
	out := movs[:0]
	for _, m := range movs {
		m.Detalle = DetalleParaElCliente(m.Detalle)
		if m.Clase != "pago" && m.Detalle != nil && strings.HasPrefix(*m.Detalle, PrefijoAnulacionDeRecibo) &&
			anulados[strings.TrimPrefix(*m.Detalle, PrefijoAnulacionDeRecibo)] {
			continue
		}
		if m.Clase == "pago" && m.Recibo != nil && anulados[m.Recibo.Numero] {
			m.Titulo = "Recibo " + m.Recibo.Numero + " anulado"
			m.Detalle = nil
			m.ImporteInformativo = m.Importe
			m.Importe = nil
			m.Cheques = nil
		}
		out = append(out, m)
	}
	return out
}

// ClasesPorFiltro son las clases que muestra cada filtro (nil: todas).
var ClasesPorFiltro = map[string][]string{
	"todo":    nil,
	"compras": {"compra", "compra_contado"},
	"pagos":   {"pago", "pago_en_revision", "pago_rechazado"},
	"cheques": {"cheque_por_recibir", "cheque", "cheque_rechazado", "cheque_no_tomado", "nota_debito"},
	"ajustes": {"ajuste", "nota_credito", "nota_debito"},
}

var tituloDelLibro = map[string]string{"compra": "Compra a cuenta", "pago": "Pago", "nota_credito": "Nota de crédito", "nota_debito": "Nota de débito", "ajuste": "Ajuste"}

// estadoDelCheque es cómo se dice el estado de un cheque que ya se tomó.
var estadoDelCheque = map[string]string{"cartera": "En cartera", "entregado": "Endosado", "depositado": "Depositado", "acreditado": "Acreditado"}

var medioInformado = map[string]string{"transferencia": "Transferencia", "deposito": "Depósito"}

func f64(v float64) *float64 { return &v }

// conceptoDelPago saca «— recibo REC-0001» del detalle: el número ya va en
// el renglón.
func conceptoDelPago(detalle, recibo *string) string {
	if detalle == nil || *detalle == "" {
		return "Pago"
	}
	s := *detalle
	if recibo != nil {
		s = strings.Replace(s, " — recibo "+*recibo, "", 1)
		s = strings.Replace(s, "Recibo "+*recibo, "", 1)
	}
	if t := strings.TrimSpace(s); t != "" {
		return t
	}
	return "Pago"
}

// Historial es historialDelCliente: desde una fecha (o todo), con un filtro
// y un tope de 200; hayMas dice si quedó algo afuera.
func Historial(ctx context.Context, q *sqlc.Queries, cliente string, desde *time.Time, filtro string, tope int) ([]MovimientoDelCliente, bool, error) {
	if tope <= 0 {
		tope = 200
	}
	if filtro == "" {
		filtro = "todo"
	}
	d := pgtype.Timestamptz{Valid: desde != nil}
	if desde != nil {
		d.Time = *desde
	}
	libro, err := q.LibroDelCliente(ctx, sqlc.LibroDelClienteParams{CustomerID: cliente, Desde: d, Limit: int32(tope + 1)})
	if err != nil {
		return nil, false, err
	}
	contado, err := q.ComprasDeContado(ctx, sqlc.ComprasDeContadoParams{CustomerID: &cliente, Desde: d, Limit: int32(tope + 1)})
	if err != nil {
		return nil, false, err
	}
	informados, err := q.PagosInformados(ctx, sqlc.PagosInformadosParams{CustomerID: &cliente, Desde: d})
	if err != nil {
		return nil, false, err
	}
	sueltos, err := q.ChequesSueltos(ctx, sqlc.ChequesSueltosParams{CustomerID: &cliente, Desde: d})
	if err != nil {
		return nil, false, err
	}
	devueltas, err := q.DevolucionesFueraDeLaCuenta(ctx, sqlc.DevolucionesFueraDeLaCuentaParams{CustomerID: &cliente, Desde: d})
	if err != nil {
		return nil, false, err
	}

	var recibos []string
	vistos := map[string]bool{}
	for _, m := range libro {
		if m.ReciboID != nil && !vistos[*m.ReciboID] {
			vistos[*m.ReciboID] = true
			recibos = append(recibos, *m.ReciboID)
		}
	}
	medios := map[string]string{}
	porMP := map[string]bool{}
	chequesDe := map[string][]RefCheque{}
	if len(recibos) > 0 {
		partes, err := q.PartesDeRecibos(ctx, recibos)
		if err != nil {
			return nil, false, err
		}
		for _, p := range partes {
			if p.PorMercadoPago {
				porMP[p.ReceiptID] = true
			}
			// Con centavos cuando los hay: «Transferencia $ 46.691» de un recibo de
			// $ 46.690,50 no cerraba (mes simulado, H034).
			var t string
			if p.Numero != nil {
				tipo := ""
				if p.Tipo != nil {
					tipo = string(*p.Tipo)
				}
				t = NombreDelCheque(tipo, p.Banco, *p.Numero) + " " + formato.Importe(p.Importe)
				if p.ChequeID != nil && p.ChequeEstado != nil && slices.Contains(RechazablesDesdeLaFicha, Estado(string(*p.ChequeEstado))) {
					chequesDe[p.ReceiptID] = append(chequesDe[p.ReceiptID], RefCheque{*p.ChequeID, NombreDelCheque(tipo, p.Banco, *p.Numero), p.Importe})
				}
			} else {
				t = NombreDelMedio[Medio(p.Medio)] + " " + formato.Importe(p.Importe)
			}
			if previo, ok := medios[p.ReceiptID]; ok {
				medios[p.ReceiptID] = previo + " · " + t
			} else {
				medios[p.ReceiptID] = t
			}
		}
	}

	// Los recibos con un cheque que rebotó: la nota de débito lleva el
	// recibo con el que había entrado.
	rebotados := map[string]bool{}
	for _, m := range libro {
		if m.Tipo == "nota_debito" && m.ReciboID != nil {
			rebotados[*m.ReciboID] = true
		}
	}

	var movs []MovimientoDelCliente
	for i, m := range libro {
		if i >= tope {
			break
		}
		x := MovimientoDelCliente{ID: m.ID, Fecha: m.CreatedAt, Clase: m.Tipo, Detalle: m.Detalle, Importe: f64(m.Monto)}
		if t, ok := tituloDelLibro[m.Tipo]; ok {
			x.Titulo = t
		} else {
			x.Titulo = m.Tipo
		}
		if m.Tipo == "pago" && m.ReciboID != nil {
			x.Titulo = conceptoDelPago(m.Detalle, m.ReciboNumero)
			if t, ok := medios[*m.ReciboID]; ok {
				x.Detalle = &t
			} else {
				x.Detalle = nil
			}
		}
		if m.PedidoID != nil && m.Referencia != nil {
			x.Pedido = &RefPedido{*m.PedidoID, *m.Referencia}
		}
		if m.ReciboID != nil {
			x.Recibo = &RefRecibo{*m.ReciboID, deref(m.ReciboNumero), m.ReciboEstado != nil && *m.ReciboEstado == sqlc.EstadoReciboAnulado, porMP[*m.ReciboID],
				rebotados[*m.ReciboID]}
			if m.Tipo == "pago" && !x.Recibo.Anulado {
				x.Cheques = chequesDe[*m.ReciboID]
			}
		}
		movs = append(movs, x)
	}
	for i, p := range contado {
		if i >= tope {
			break
		}
		detalle := "Pago pendiente"
		var recibo *RefRecibo
		switch {
		case p.ReciboID != nil:
			detalle = "Pagada con recibo"
			recibo = &RefRecibo{ID: *p.ReciboID, Numero: deref(p.ReciboNumero)}
		case p.EstadoPago == "pagado":
			detalle = "Pagada en el momento"
		}
		movs = append(movs, MovimientoDelCliente{ID: p.ID, Fecha: p.CreatedAt, Clase: "compra_contado", Titulo: "Compra",
			Detalle: &detalle, ImporteInformativo: f64(p.Total), Pedido: &RefPedido{p.ID, p.Numero}, Recibo: recibo})
	}
	for _, p := range informados {
		clase, detalle := "pago_en_revision", "La estamos verificando en el banco"
		if p.Estado == "rechazado" {
			clase, detalle = "pago_rechazado", "No se acreditó"
			if p.MotivoRechazo != nil && *p.MotivoRechazo != "" {
				detalle += ": " + *p.MotivoRechazo
			}
		}
		titulo := "Transferencia"
		if p.Medio != nil {
			if t, ok := medioInformado[*p.Medio]; ok {
				titulo = t
			}
		}
		// «Depósito informado», no «informada» (M2S1-157).
		informado := " informada"
		if titulo == "Depósito" {
			informado = " informado"
		}
		movs = append(movs, MovimientoDelCliente{ID: p.ID, Fecha: p.CreatedAt, Clase: clase, Titulo: titulo + informado,
			Detalle: &detalle, ImporteInformativo: f64(p.Monto)})
	}
	if filtro == "cheques" {
		conRecibo, err := q.ChequesDeRecibos(ctx, sqlc.ChequesDeRecibosParams{CustomerID: &cliente, Desde: d})
		if err != nil {
			return nil, false, err
		}
		for _, c := range conRecibo {
			detalle := estadoDelCheque[c.Estado] + " · al " + fechaCorta(c.FechaPago)
			titulo := NombreDelCheque(c.Tipo, c.Banco, c.Numero)
			movs = append(movs, MovimientoDelCliente{ID: c.ID, Fecha: c.UpdatedAt, Clase: "cheque", Titulo: titulo,
				Detalle: &detalle, ImporteInformativo: f64(c.Importe),
				Recibo:  &RefRecibo{ID: c.ReciboID, Numero: c.ReciboNumero},
				Cheques: []RefCheque{{c.ID, titulo, c.Importe}}})
		}
	}
	// Las devoluciones de lo pagado de contado: no mueven la cuenta (el
	// reintegro fue aparte), pero el cliente las tiene que ver (M2S3-030).
	for _, v := range devueltas {
		var detalle *string
		if v.NotaTipo != "" && v.NotaPv != nil && v.NotaNumero != nil {
			letra := strings.ToUpper(v.NotaTipo[len(v.NotaTipo)-1:])
			t := fmt.Sprintf("Nota de crédito %s %04d-%08d", letra, *v.NotaPv, *v.NotaNumero)
			detalle = &t
		}
		movs = append(movs, MovimientoDelCliente{ID: v.ID, Fecha: v.CreatedAt.Time, Clase: "nota_credito", Titulo: "Devolución",
			Detalle: detalle, ImporteInformativo: f64(-v.Importe), Pedido: &RefPedido{v.PedidoID, v.PedidoNumero}})
	}
	for _, c := range sueltos {
		// El que no se tomó (no mueve la cuenta) no es el que rebotó en el
		// banco: llevaban el mismo «Cheque rechazado» (M3S2-052).
		clase := "cheque_no_tomado"
		detalle := "No lo pudimos tomar"
		if c.DeUnaVenta {
			clase = "cheque_rechazado"
			// Se tomó con la venta y después lo rechazó el banco: la nota de
			// débito del renglón de al lado es la que lo vuelve a cobrar.
			detalle = "Rechazado por el banco"
		} else if c.MotivoRechazo != nil && *c.MotivoRechazo != "" {
			detalle += ": " + *c.MotivoRechazo
		}
		switch {
		case c.Estado == "informado":
			clase, detalle = "cheque_por_recibir", "Por recibir · al "+fechaCorta(c.FechaPago)
		case c.Estado != "rechazado":
			// El de una venta del mostrador, mientras está en la cartera o
			// en el banco: no mueve la cuenta (la venta ya se pagó con él).
			clase, detalle = "cheque", estadoDelCheque[c.Estado]+" · al "+fechaCorta(c.FechaPago)
		}
		x := MovimientoDelCliente{ID: c.ID, Fecha: c.UpdatedAt, Clase: clase, Titulo: NombreDelCheque(c.Tipo, c.Banco, c.Numero),
			Detalle: &detalle, ImporteInformativo: f64(c.Importe)}
		if slices.Contains(RechazablesDesdeLaFicha, Estado(c.Estado)) {
			x.Cheques = []RefCheque{{c.ID, x.Titulo, c.Importe}}
		}
		movs = append(movs, x)
	}

	filtrados := movs
	if clases := ClasesPorFiltro[filtro]; clases != nil {
		filtrados = nil
		for _, m := range movs {
			if slices.Contains(clases, m.Clase) {
				filtrados = append(filtrados, m)
			}
		}
	}
	sort.SliceStable(filtrados, func(i, j int) bool { return filtrados[i].Fecha.UnixMilli() > filtrados[j].Fecha.UnixMilli() })
	hayMas := len(libro) > tope || len(contado) > tope || len(filtrados) > tope
	if len(filtrados) > tope {
		filtrados = filtrados[:tope]
	}
	if filtrados == nil {
		filtrados = []MovimientoDelCliente{}
	}
	return filtrados, hayMas, nil
}

// DesdeDelPeriodo es desdeDelPeriodo: 3, 6 o 12 meses para atrás (o todo).
func DesdeDelPeriodo(periodo string, hoy time.Time) *time.Time {
	if periodo == "todo" {
		return nil
	}
	meses := 12
	switch periodo {
	case "3m":
		meses = 3
	case "6m":
		meses = 6
	}
	d := hoy.AddDate(0, -meses, 0)
	return &d
}

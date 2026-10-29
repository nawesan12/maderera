package whatsapp

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
)

// Los datos del botón «Avisar por WhatsApp» (lib/whatsapp/aviso-manual-datos.ts):
// busca lo que el texto necesita y el teléfono del cliente, arma el enlace de
// wa.me y le suma la historia (si ya se avisó a mano, si salió el automático,
// si no salió por el tope). Los papeles no viajan por wa.me: el botón avisa
// que hay que adjuntar el PDF y ofrece descargarlo.

// TiposEntidad son las cosas de las que se avisa.
var TiposEntidad = []string{"order", "cutting_order", "quote", "receipt", "cheque", "customer", "invoice", "delivery"}

// HistoriaDelAviso es lo último de un canal para este aviso.
type HistoriaDelAviso struct {
	Canal    string `json:"canal"`
	Estado   string `json:"estado"`
	Texto    string `json:"texto"`
	Atencion bool   `json:"atencion"`
}

// AvisoManualListo es todo lo que necesita el botón.
type AvisoManualListo struct {
	Evento             string             `json:"evento"`
	EntidadTipo        string             `json:"entidadTipo"`
	EntidadID          string             `json:"entidadId"`
	Titulo             string             `json:"titulo"`
	Texto              string             `json:"texto"`
	Href               *string            `json:"href"`
	Motivo             *string            `json:"motivo"`
	Telefono           *string            `json:"telefono"`
	Para               *string            `json:"para"`
	Referencia         *string            `json:"referencia"`
	PDF                *string            `json:"pdf"`
	Historia           []HistoriaDelAviso `json:"historia"`
	YaAvisado          bool               `json:"yaAvisado"`
	AutomaticoPrendido bool               `json:"automaticoPrendido"`
	CostoAutomatico    string             `json:"costoAutomatico"`
}

type baseAviso struct {
	nombre, telefono *string
	valores          map[string]string
	enlace           *Enlace
	pdf              *string
}

func (s *Servicio) urlBase() string { return s.cfg.URLBase }

func encodePath(s string) string { return encodeURIComponent(s) }

// cargarAviso trae el cliente, el texto y el teléfono de cada cosa que se avisa.
func (s *Servicio) cargarAviso(ctx context.Context, evento, tipo, id string) (*baseAviso, error) {
	fila := func(sql string, dst ...any) (bool, error) {
		err := s.pool.QueryRow(ctx, sql, id).Scan(dst...)
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return err == nil, err
	}
	switch tipo {
	case "order":
		var numero, token string
		var cNombre, cTel, clNombre, clTel, suc, slug *string
		ok, err := fila(`select o.numero, o.public_token::text, o.contacto_nombre, o.contacto_telefono, c.nombre, c.telefono, b.name, b.slug
			from orders o left join customers c on c.id = o.customer_id left join branches b on b.id = o.branch_id where o.id = $1`,
			&numero, &token, &cNombre, &cTel, &clNombre, &clTel, &suc, &slug)
		if !ok {
			return nil, err
		}
		v := DatosDeSucursal(suc, slug)
		v["pedido"] = numero
		return &baseAviso{nombre: primero(clNombre, cNombre), telefono: primero(clTel, cTel), valores: v,
			enlace: &Enlace{"Lo seguís acá", s.urlBase() + "/pedido/" + encodePath(numero) + "?t=" + token}}, nil
	case "cutting_order":
		var numero string
		var cNombre, clNombre, clTel, pTel, suc, slug *string
		ok, err := fila(`select co.numero, co.contacto_nombre, c.nombre, c.telefono, o.contacto_telefono, b.name, b.slug
			from cutting_orders co left join customers c on c.id = co.customer_id left join orders o on o.id = co.order_id
			left join branches b on b.id = co.branch_id where co.id = $1`, &numero, &cNombre, &clNombre, &clTel, &pTel, &suc, &slug)
		if !ok {
			return nil, err
		}
		var pdf *string
		if evento == "documento" {
			pdf = ptr("/api/cortes/" + id + "/pdf")
		}
		return &baseAviso{nombre: primero(clNombre, cNombre), telefono: primero(clTel, pTel),
			valores: map[string]string{"corte": numero, "sucursal": DatosDeSucursal(suc, slug)["sucursal"]}, pdf: pdf}, nil
	case "quote":
		var numero string
		var total float64
		var valido *time.Time
		var cNombre, cTel, clTel *string
		ok, err := fila(`select q.numero, q.total::float8, q.valido_hasta, q.contacto_nombre, q.contacto_telefono, c.telefono
			from quotes q left join customers c on c.id = q.customer_id where q.id = $1`, &numero, &total, &valido, &cNombre, &cTel, &clTel)
		if !ok {
			return nil, err
		}
		vence := ""
		if valido != nil {
			vence = FechaCorta(*valido)
		}
		return &baseAviso{nombre: cNombre, telefono: primero(cTel, clTel), valores: map[string]string{"presupuesto": numero, "total": Moneda(total),
			"vence": vence, "documento": "el presupuesto " + numero}, pdf: ptr("/api/presupuestos/" + id + "/pdf")}, nil
	case "receipt":
		var numero string
		var total, saldo float64
		var nombre, tel *string
		ok, err := fila(`select r.numero, r.total::float8,
				coalesce((select sum(m.monto) from account_movements m where m.customer_id = r.customer_id
					and m.created_at <= (select created_at from account_movements where id = r.account_movement_id)), 0)::float8,
				c.nombre, c.telefono
			from receipts r join customers c on c.id = r.customer_id where r.id = $1`, &numero, &total, &saldo, &nombre, &tel)
		if !ok {
			return nil, err
		}
		return &baseAviso{nombre: nombre, telefono: tel, valores: map[string]string{"importe": Moneda(total), "recibo": numero,
			"saldo": Moneda(saldo), "documento": "el recibo " + numero}, pdf: ptr("/api/recibos/" + id + "/pdf")}, nil
	case "cheque":
		var tipoCheque, numero string
		var banco, motivo, nombre, tel *string
		var importe float64
		ok, err := fila(`select ch.tipo::text, ch.numero, ch.banco, ch.importe::float8, ch.motivo_rechazo, c.nombre, c.telefono
			from cheques ch left join customers c on c.id = ch.customer_id where ch.id = $1`, &tipoCheque, &numero, &banco, &importe, &motivo, &nombre, &tel)
		if !ok {
			return nil, err
		}
		m := trimJS(oTexto(motivo, ""))
		if m == "" {
			m = "lo rechazó el banco"
		}
		return &baseAviso{nombre: nombre, telefono: tel, valores: map[string]string{"cheque": NombreDelCheque(tipoCheque, banco, numero),
			"importe": Moneda(importe), "motivo": m}}, nil
	case "customer":
		var nombre string
		var tel *string
		ok, err := fila(`select nombre, telefono from customers where id = $1`, &nombre, &tel)
		if !ok {
			return nil, err
		}
		var pdf *string
		if evento == "documento" {
			pdf = ptr("/api/cuenta/" + id + "/pdf")
		}
		return &baseAviso{nombre: &nombre, telefono: tel, valores: map[string]string{"fecha": FechaCorta(s.ahora()),
			"documento": "el resumen de tu cuenta corriente"}, pdf: pdf}, nil
	case "invoice":
		var pv, n int32
		var nombre, tel *string
		ok, err := fila(`select f.punto_venta, f.numero, c.nombre, c.telefono from invoices f left join customers c on c.id = f.customer_id
			where f.id = $1`, &pv, &n, &nombre, &tel)
		if !ok {
			return nil, err
		}
		return &baseAviso{nombre: nombre, telefono: tel, valores: map[string]string{"documento": "la factura " + numeroFormateado(pv, n)},
			pdf: ptr("/api/comprobantes/" + id + "/pdf")}, nil
	case "delivery":
		var numero string
		var token, cNombre, cTel, clNombre, clTel *string
		var firmado *time.Time
		ok, err := fila(`select d.numero, d.firma_token, d.firmado_at, o.contacto_nombre, o.contacto_telefono, c.nombre, c.telefono
			from deliveries d join orders o on o.id = d.order_id left join customers c on c.id = o.customer_id where d.id = $1`,
			&numero, &token, &firmado, &cNombre, &cTel, &clNombre, &clTel)
		if !ok {
			return nil, err
		}
		b := &baseAviso{nombre: primero(clNombre, cNombre), telefono: primero(clTel, cTel), valores: map[string]string{"documento": "el remito " + numero},
			pdf: ptr("/api/remitos/" + id + "/pdf")}
		// El enlace para firmarlo es público a propósito y lo autoriza su token.
		if !vacio(token) && firmado == nil {
			b.enlace = &Enlace{"Para firmarlo con el dedo", s.urlBase() + "/firmar/" + *token}
		}
		return b, nil
	}
	return nil, nil
}

// NombreDelCheque es nombreDelCheque de lib/cheques/numero.ts.
func NombreDelCheque(tipo string, banco *string, numero string) string {
	clase := "Cheque"
	if tipo == "echeq" {
		clase = "e-Cheq"
	}
	if !vacio(banco) {
		clase += " " + *banco
	}
	return clase + " N° " + numero
}

func (s *Servicio) historiaDelAviso(ctx context.Context, evento, entidadID string) ([]HistoriaDelAviso, bool, error) {
	r, err := s.pool.Query(ctx, `select n.canal::text, n.estado::text, n.error, n.created_at, u.name
		from notifications_log n left join "user" u on u.id = n.usuario_id
		where n.evento = $1 and n.entidad_id = $2 and n.canal in ('whatsapp', 'whatsapp_manual', 'email')
		order by n.created_at desc limit 20`, evento, entidadID)
	if err != nil {
		return nil, false, err
	}
	defer r.Close()
	type fila struct {
		canal, estado string
		error, quien  *string
		creado        time.Time
	}
	primeras := map[string]fila{}
	manual := false
	for r.Next() {
		var f fila
		if err := r.Scan(&f.canal, &f.estado, &f.error, &f.creado, &f.quien); err != nil {
			return nil, false, err
		}
		if _, ya := primeras[f.canal]; !ya {
			primeras[f.canal] = f
		}
		manual = manual || f.canal == "whatsapp_manual"
	}
	if err := r.Err(); err != nil {
		return nil, false, err
	}
	out := []HistoriaDelAviso{}
	for _, canal := range []string{"whatsapp_manual", "whatsapp", "email"} {
		f, ok := primeras[canal]
		if !ok {
			continue
		}
		cuando := FechaHora(f.creado)
		salio := f.estado == "enviada" || f.estado == "simulada"
		switch canal {
		case "whatsapp_manual":
			t := "Avisado a mano el " + cuando
			if !vacio(f.quien) {
				t += " por " + strings.SplitN(*f.quien, " ", 2)[0]
			}
			out = append(out, HistoriaDelAviso{canal, f.estado, t + ".", false})
		case "whatsapp":
			var t string
			switch {
			case salio:
				t = "El aviso automático salió el " + cuando
				if f.estado == "simulada" {
					t += " (en demostración: no llegó)"
				}
				t += "."
			case oTexto(f.error, "") == MotivoTope:
				t = "El aviso automático no salió (" + cuando + "): se llegó al tope del mes."
			default:
				t = "El aviso automático no salió (" + cuando + "): " + oTexto(f.error, "sin detalle")
			}
			out = append(out, HistoriaDelAviso{canal, f.estado, t, !salio})
		default:
			t := "El correo no salió (" + cuando + ")."
			if salio {
				t = "El correo salió el " + cuando + "."
			}
			out = append(out, HistoriaDelAviso{canal, f.estado, t, !salio})
		}
	}
	return out, manual, nil
}

// AvisoManual arma el botón para un aviso; nil si la entidad no existe.
// `extra` son valores que la página ya tiene (el saldo de la cuenta).
func (s *Servicio) AvisoManual(ctx context.Context, evento, tipo, id string, extra map[string]string) (*AvisoManualListo, error) {
	if !plataforma.UUIDValido(id) {
		return nil, nil
	}
	am, ok := AvisosManuales[evento]
	if !ok || !contiene(TiposEntidad, tipo) {
		return nil, nil
	}
	datos, err := s.cargarAviso(ctx, evento, tipo, id)
	if err != nil || datos == nil {
		return nil, err
	}
	historia, manual, err := s.historiaDelAviso(ctx, evento, id)
	if err != nil {
		return nil, err
	}
	var activo bool
	if err := s.pool.QueryRow(ctx, `select activo from whatsapp_avisos where evento = $1 limit 1`, evento).Scan(&activo); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	cfg, err := s.ConfigDeGasto(ctx)
	if err != nil {
		return nil, err
	}
	valores := map[string]string{}
	for k, v := range datos.valores {
		valores[k] = v
	}
	for k, v := range extra {
		valores[k] = v
	}
	a := ArmarAvisoManual(evento, datos.nombre, datos.telefono, valores, datos.enlace)
	return &AvisoManualListo{
		Evento: evento, EntidadTipo: tipo, EntidadID: id, Titulo: am.Titulo, Texto: a.Texto, Href: a.Href, Motivo: a.Motivo, Telefono: a.Telefono,
		Para: datos.nombre,
		Referencia: primero(textoDeMapa(datos.valores, "pedido"), textoDeMapa(datos.valores, "corte"), textoDeMapa(datos.valores, "presupuesto"),
			textoDeMapa(datos.valores, "recibo"), textoDeMapa(datos.valores, "cheque")),
		PDF: datos.pdf, Historia: historia, YaAvisado: manual,
		// En demostración el automático no cuesta nada: no hay a quién avisarle.
		AutomaticoPrendido: activo && s.prov.ID() != "demo",
		CostoAutomatico:    TarifaLegible(cfg.Tarifas["utility"]),
	}, nil
}

// AvisosManualesDe es para un tablero: los que no existen se descartan.
func (s *Servicio) AvisosManualesDe(ctx context.Context, evento, tipo string, ids []string) (map[string]*AvisoManualListo, error) {
	out := map[string]*AvisoManualListo{}
	for _, id := range ids {
		a, err := s.AvisoManual(ctx, evento, tipo, id, nil)
		if err != nil {
			return nil, err
		}
		if a != nil {
			out[a.EntidadID] = a
		}
	}
	return out, nil
}

// AvisoDelUltimoRecibo es el recibo de los últimos tres días, para avisarle
// desde la ficha del cliente.
func (s *Servicio) AvisoDelUltimoRecibo(ctx context.Context, customerID string) (*AvisoManualListo, error) {
	if !plataforma.UUIDValido(customerID) {
		return nil, nil
	}
	var id string
	err := s.pool.QueryRow(ctx, `select id from receipts where customer_id = $1 and estado = 'emitido' and created_at >= $2
		order by created_at desc limit 1`, customerID, s.ahora().Add(-3*24*time.Hour)).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.AvisoManual(ctx, "recibo_emitido", "receipt", id, nil)
}

// RegistrarAvisoManual deja constancia de que alguien avisó desde la app del
// teléfono (app/admin/aviso-manual-actions.ts). Un doble clic no deja dos
// filas: lo mismo de la misma persona en dos minutos no se repite.
func (s *Servicio) RegistrarAvisoManual(ctx context.Context, ses *auth.Sesion, evento, entidadTipo, entidadID string, telefono *string) (Resultado, error) {
	am, ok := AvisosManuales[evento]
	if !ok || !contiene(TiposEntidad, entidadTipo) || !plataforma.UUIDValido(entidadID) || (telefono != nil && largoJS(*telefono) > 40) {
		return conError("No se pudo registrar el aviso."), nil
	}
	var hay bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from notifications_log where canal = 'whatsapp_manual' and evento = $1
		and entidad_id = $2 and usuario_id = $3 and created_at >= $4)`, evento, entidadID, ses.UserID, s.ahora().Add(-2*time.Minute)).Scan(&hay); err != nil {
		return Resultado{}, err
	}
	if hay {
		return Resultado{Ok: "ok"}, nil
	}
	destinatario := "-"
	if telefono != nil && *telefono != "" {
		if w := AWaId(*telefono); w != "" {
			destinatario = w
		}
	}
	if _, err := s.pool.Exec(ctx, `insert into notifications_log (canal, evento, destinatario, asunto, entidad_tipo, entidad_id, estado, usuario_id)
		values ('whatsapp_manual', $1, $2, $3, $4, $5, 'enviada', $6)`, evento, destinatario, am.Titulo, entidadTipo, entidadID, ses.UserID); err != nil {
		return Resultado{}, err
	}
	return Resultado{Ok: "ok"}, nil
}

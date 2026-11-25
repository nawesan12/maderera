package pagos

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

func jsonDe(v any) ([]byte, error) { return json.Marshal(v) }

func parsearURL(crudo string) (url.Values, error) {
	u, err := url.Parse(crudo)
	if err != nil {
		return nil, err
	}
	return u.Query(), nil
}

// EnlaceDeSeguimiento es enlaceDeSeguimiento (lib/seguimiento.ts).
func EnlaceDeSeguimiento(numero, token string) string {
	return "/pedido/" + encodeURIComponent(numero) + "?t=" + token
}

// encodeURIComponent de JS.
func encodeURIComponent(s string) string {
	const sinEscapar = "-_.!~*'()"
	var b []byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || indexByte(sinEscapar, c) {
			b = append(b, c)
			continue
		}
		b = append(b, '%', "0123456789ABCDEF"[c>>4], "0123456789ABCDEF"[c&15])
	}
	return string(b)
}

func indexByte(s string, c byte) bool {
	for i := 0; i < len(s); i++ {
		if s[i] == c {
			return true
		}
	}
	return false
}

// CobroAbierto es a dónde mandar a pagar.
type CobroAbierto struct {
	PagoID  string `json:"pagoId"`
	URLPago string `json:"urlPago"`
	Real    bool   `json:"real"`
}

// abrir crea la fila de payments **antes** de pedirle nada al proveedor (su
// id es la referencia que vuelve en el aviso) y guarda la preferencia.
func (s *Servicio) abrir(ctx context.Context, insertar func(prov string) (string, error), sol func(id string) SolicitudPreferencia) (*CobroAbierto, error) {
	prov := s.elegido()
	if prov == nil {
		// Antes de insertar la fila: un cobro sin proveedor no se abre.
		return nil, sinPagoOnline()
	}
	if s.Proveedor != nil {
		if p := s.Proveedor(prov.Nombre()); p != nil {
			prov = p
		}
	}
	id, err := insertar(prov.Nombre())
	if err != nil {
		return nil, err
	}
	pref, err := prov.CrearPreferencia(ctx, sol(id))
	if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `UPDATE payments SET preferencia_id = $2, updated_at = now() WHERE id = $1`, id, pref.ID); err != nil {
		return nil, err
	}
	return &CobroAbierto{PagoID: id, URLPago: pref.URL, Real: prov.Real()}, nil
}

// IniciarPagoDePedido es iniciarPagoDePedido: el checkout de un pedido.
func (s *Servicio) IniciarPagoDePedido(ctx context.Context, pedido string, usuario *string) (*CobroAbierto, error) {
	var numero, token, estadoPago string
	var total jsmath.Num
	var cliente, nombre, email *string
	err := s.pool.QueryRow(ctx, `
		SELECT numero, public_token, total, estado_pago::text, customer_id, contacto_nombre, contacto_email
		FROM orders WHERE id = $1`, pedido).Scan(&numero, &token, &total, &estadoPago, &cliente, &nombre, &email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fallo("El pedido no existe.")
	}
	if err != nil {
		return nil, err
	}
	if estadoPago == "pagado" {
		return nil, fallo("Este pedido ya está pagado.")
	}
	monto := float64(total)
	if !(monto > 0) {
		return nil, fallo("El pedido no tiene importe a cobrar.")
	}
	filas, err := s.pool.Query(ctx, `SELECT descripcion, cantidad::float8, precio_unitario::float8 FROM order_items WHERE order_id = $1`, pedido)
	if err != nil {
		return nil, err
	}
	lineas, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (ItemPreferencia, error) {
		var i ItemPreferencia
		return i, r.Scan(&i.Titulo, &i.Cantidad, &i.PrecioUnitario)
	})
	if err != nil {
		return nil, err
	}
	if len(lineas) == 0 {
		lineas = []ItemPreferencia{{Titulo: "Pedido " + numero, Cantidad: 1, PrecioUnitario: monto}}
	}
	return s.abrir(ctx, func(prov string) (string, error) {
		var id string
		err := s.pool.QueryRow(ctx, `
			INSERT INTO payments (order_id, customer_id, tipo, proveedor, monto, estado, created_by_user_id)
			VALUES ($1, $2, 'pedido', $3::proveedor_pago, $4::numeric, 'iniciado', $5) RETURNING id`,
			pedido, cliente, prov, jsmath.Fijo2(monto), usuario).Scan(&id)
		return id, err
	}, func(id string) SolicitudPreferencia {
		return SolicitudPreferencia{
			Referencia: id, Descripcion: "Pedido " + numero, Monto: monto, Items: lineas,
			Pagador: &Pagador{Nombre: nombre, Email: email},
			// Con token: quien vuelve de Mercado Pago puede no tener sesión.
			URLRetorno: s.cfg.URLBase() + EnlaceDeSeguimiento(numero, token), URLWebhook: s.cfg.URLWebhook(),
		}
	})
}

// IniciarPagoDeInscripcion es iniciarPagoDeInscripcion: la inscripción ya
// está reservada (ocupa lugar) y se confirma cuando se acredita el pago.
func (s *Servicio) IniciarPagoDeInscripcion(ctx context.Context, inscripcion string, usuario *string) (*CobroAbierto, error) {
	if !plataforma.UUIDValido(inscripcion) {
		return nil, fallo("La inscripción no existe.")
	}
	var estado, evento, slug string
	var nombre, email string
	var cliente *string
	var precio *jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT r.nombre, r.email, r.customer_id, r.estado::text, e.titulo, e.slug, e.precio
		FROM event_registrations r JOIN events e ON e.id = r.event_id WHERE r.id = $1`, inscripcion).
		Scan(&nombre, &email, &cliente, &estado, &evento, &slug, &precio)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fallo("La inscripción no existe.")
	}
	if err != nil {
		return nil, err
	}
	if estado == "confirmada" {
		return nil, fallo("Esta inscripción ya está paga.")
	}
	monto := 0.0
	if precio != nil {
		monto = float64(*precio)
	}
	if !(monto > 0) {
		return nil, fallo("Este evento no tiene costo.")
	}
	return s.abrir(ctx, func(prov string) (string, error) {
		var id string
		err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
			if err := tx.QueryRow(ctx, `
				INSERT INTO payments (customer_id, tipo, proveedor, monto, estado, created_by_user_id)
				VALUES ($1, 'inscripcion', $2::proveedor_pago, $3::numeric, 'iniciado', $4) RETURNING id`,
				cliente, prov, jsmath.Fijo2(monto), usuario).Scan(&id); err != nil {
				return err
			}
			// La inscripción guarda el pago antes de mandar a nadie a pagar.
			_, err := tx.Exec(ctx, `UPDATE event_registrations SET payment_id = $2, updated_at = now() WHERE id = $1`, inscripcion, id)
			return err
		})
		return id, err
	}, func(id string) SolicitudPreferencia {
		return SolicitudPreferencia{
			Referencia: id, Descripcion: evento, Monto: monto,
			Items:      []ItemPreferencia{{Titulo: evento, Cantidad: 1, PrecioUnitario: monto}},
			Pagador:    &Pagador{Nombre: &nombre, Email: &email},
			URLRetorno: s.cfg.URLBase() + "/eventos/" + slug, URLWebhook: s.cfg.URLWebhook(),
		}
	})
}

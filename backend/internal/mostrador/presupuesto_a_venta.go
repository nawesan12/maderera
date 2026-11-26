package mostrador

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/precios"
)

// El presupuesto que se trae a la venta del mostrador (mes simulado,
// 26/11/2026). La clienta venía con P-2026-0020 a pagar y llevárselo: desde
// el mostrador no había forma de cargarlo, eran doce clics en dos pantallas
// (pasar a pedido, cobrar, preparar, listo, entregar), y el cobro no entraba
// en el turno ni se podía facturar. Tipeando el número en el buscador, la
// venta se arma con sus renglones y su cliente, y se cobra con Ctrl+Enter
// como cualquier otra; al cobrar, el presupuesto queda aceptado y atado al
// pedido.

// PresupuestoParaVender es lo que la pantalla necesita para armar la venta.
type PresupuestoParaVender struct {
	ID               string                  `json:"id"`
	Numero           string                  `json:"numero"`
	CustomerID       *string                 `json:"customerId"`
	ContactoNombre   string                  `json:"contactoNombre"`
	ContactoTelefono *string                 `json:"contactoTelefono"`
	Vencido          bool                    `json:"vencido"`
	Lineas           []RenglonDelPresupuesto `json:"lineas"`
}

// RenglonDelPresupuesto es una línea de la venta, como la arma el buscador.
type RenglonDelPresupuesto struct {
	VariantID      *string  `json:"variantId"`
	Descripcion    string   `json:"descripcion"`
	Unidad         string   `json:"unidad"`
	Cantidad       float64  `json:"cantidad"`
	PrecioUnitario float64  `json:"precioUnitario"`
	Presentacion   *string  `json:"presentacion"`
	PrecioLista    *float64 `json:"precioLista"`
}

// ErrPresupuesto es lo que se le dice al mostrador cuando no se puede traer.
type ErrPresupuesto struct{ Msj string }

func (e *ErrPresupuesto) Error() string { return e.Msj }

// NumeroDePresupuesto normaliza lo tipeado: «p-2026-20» es P-2026-0020.
func NumeroDePresupuesto(texto string) (string, bool) {
	t := strings.ToUpper(strings.TrimSpace(texto))
	t = strings.TrimPrefix(t, "P-")
	t = strings.TrimPrefix(t, "P")
	partes := strings.Split(t, "-")
	if len(partes) != 2 || len(partes[0]) != 4 || len(partes[1]) == 0 || len(partes[1]) > 6 {
		return "", false
	}
	for _, p := range partes {
		for _, r := range p {
			if r < '0' || r > '9' {
				return "", false
			}
		}
	}
	n := partes[1]
	for len(n) < 4 {
		n = "0" + n
	}
	return "P-" + partes[0] + "-" + n, true
}

// PresupuestoParaElMostrador busca el presupuesto por su número. Uno
// vencido trae los precios de hoy (lo mismo que «Actualizar» al pasarlo a
// pedido; respetarlos se hace desde Presupuestos, con el PIN).
func (s *Servicio) PresupuestoParaElMostrador(ctx context.Context, numero string) (*PresupuestoParaVender, error) {
	n, ok := NumeroDePresupuesto(numero)
	if !ok {
		return nil, &ErrPresupuesto{"Ese número no es de un presupuesto."}
	}
	var p PresupuestoParaVender
	var estado string
	var pedido *string
	err := s.pool.QueryRow(ctx, `
		SELECT q.id::text, q.numero, q.customer_id::text, q.contacto_nombre, q.contacto_telefono, q.estado::text,
		       (SELECT o.numero FROM orders o WHERE o.quote_id = q.id ORDER BY o.created_at LIMIT 1),
		       q.estado = 'vencido' OR (q.estado <> 'aceptado' AND q.valido_hasta IS NOT NULL
		         AND q.valido_hasta < (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date)
		FROM quotes q WHERE q.numero = $1`, n).Scan(&p.ID, &p.Numero, &p.CustomerID, &p.ContactoNombre, &p.ContactoTelefono, &estado, &pedido, &p.Vencido)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, &ErrPresupuesto{"No hay un presupuesto " + n + "."}
	}
	if err != nil {
		return nil, err
	}
	if pedido != nil {
		return nil, &ErrPresupuesto{n + " ya se pasó al pedido " + *pedido + "."}
	}
	if estado == "rechazado" {
		return nil, &ErrPresupuesto{n + " está rechazado."}
	}
	filas, err := s.pool.Query(ctx, `
		SELECT variant_id::text, descripcion, unidad, cantidad::float8, precio_unitario::float8, presentacion, precio_lista::float8
		FROM quote_items WHERE quote_id = $1 ORDER BY orden, id`, p.ID)
	if err != nil {
		return nil, err
	}
	p.Lineas, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (RenglonDelPresupuesto, error) {
		var l RenglonDelPresupuesto
		err := r.Scan(&l.VariantID, &l.Descripcion, &l.Unidad, &l.Cantidad, &l.PrecioUnitario, &l.Presentacion, &l.PrecioLista)
		return l, err
	})
	if err != nil {
		return nil, err
	}
	if len(p.Lineas) == 0 {
		return nil, &ErrPresupuesto{n + " no tiene renglones."}
	}
	if p.Vencido {
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		conVariante := make([]precios.RenglonConVariante, len(p.Lineas))
		for i, l := range p.Lineas {
			conVariante[i] = precios.RenglonConVariante{VariantID: l.VariantID, Presentacion: l.Presentacion}
		}
		lista, err := precios.ListaDelCliente(ctx, tx, p.CustomerID)
		if err != nil {
			return nil, err
		}
		deHoy, err := precios.PreciosDeLista(ctx, tx, conVariante, lista)
		if err != nil {
			return nil, err
		}
		for i := range p.Lineas {
			if deHoy[i] != nil {
				p.Lineas[i].PrecioUnitario, p.Lineas[i].PrecioLista = *deHoy[i], deHoy[i]
			}
		}
	}
	return &p, nil
}

// atarAlPresupuesto ata la venta recién hecha al presupuesto que la armó y
// lo da por aceptado. Con la fila del presupuesto bloqueada: el mismo
// presupuesto no se cobra dos veces ni se pasa a pedido mientras tanto.
func atarAlPresupuesto(ctx context.Context, tx pgx.Tx, pedido, presupuesto string) error {
	var numero, estado string
	err := tx.QueryRow(ctx, `SELECT numero, estado::text FROM quotes WHERE id = $1 FOR UPDATE`, presupuesto).Scan(&numero, &estado)
	if errors.Is(err, pgx.ErrNoRows) {
		return &ErrPresupuesto{"El presupuesto ya no existe."}
	}
	if err != nil {
		return err
	}
	var ya string
	err = tx.QueryRow(ctx, `SELECT numero FROM orders WHERE quote_id = $1 AND id <> $2 LIMIT 1`, presupuesto, pedido).Scan(&ya)
	if err == nil {
		return &ErrPresupuesto{numero + " ya se pasó al pedido " + ya + "."}
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if estado == "rechazado" {
		return &ErrPresupuesto{numero + " está rechazado."}
	}
	if _, err := tx.Exec(ctx, `UPDATE orders SET quote_id = $2 WHERE id = $1`, pedido, presupuesto); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE quotes SET estado = 'aceptado', updated_at = now() WHERE id = $1`, presupuesto)
	return err
}

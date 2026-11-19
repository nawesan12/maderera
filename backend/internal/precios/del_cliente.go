package precios

import (
	"context"
	"errors"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"mjbj/internal/catalogo"
	"mjbj/internal/jsmath"
)

// El precio de lista que le toca a un cliente. Vivía en el mostrador; se
// mudó acá en T3 (18/11/2026) porque ahora lo usan también los pedidos (un
// presupuesto vencido se pasa a pedido con los precios de hoy) y el
// mostrador ya importa pedidos.

// Consultador es un pool o una transacción.
type Consultador interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Lista es la lista de precios que le toca a un cliente (listaDelCliente).
type Lista struct {
	ID             *string `json:"id"`
	GeneralID      *string `json:"generalId"`
	FactorDerivado float64 `json:"factorDerivado"`
}

// Diferenciada: el cliente tiene una lista propia, que no es la general.
func (l Lista) Diferenciada() bool {
	return l.ID != nil && (l.GeneralID == nil || *l.ID != *l.GeneralID)
}

// ListaDelCliente: sin cliente, la general; con cliente, la suya si tiene.
func ListaDelCliente(ctx context.Context, c Consultador, cliente *string) (Lista, error) {
	var general *string
	err := c.QueryRow(ctx, `SELECT id FROM price_lists WHERE is_default = true AND active = true LIMIT 1`).Scan(&general)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Lista{}, err
	}
	if cliente == nil {
		return Lista{ID: general, GeneralID: general, FactorDerivado: 1}, nil
	}
	var propia *string
	var pct *jsmath.Num
	err = c.QueryRow(ctx, `
		SELECT c.price_list_id, l.porcentaje_sobre_general
		FROM customers c LEFT JOIN price_lists l ON l.id = c.price_list_id
		WHERE c.id = $1 LIMIT 1`, *cliente).Scan(&propia, &pct)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Lista{}, err
	}
	l := Lista{ID: general, GeneralID: general, FactorDerivado: 1}
	if propia != nil {
		l.ID = propia
		l.FactorDerivado = catalogo.FactorDeLista(pct)
	}
	return l, nil
}

// RenglonConVariante es lo que hace falta para saber el precio de lista de
// un renglón: la variante y si es media placa.
type RenglonConVariante struct {
	VariantID    *string
	Presentacion *string
}

// PreciosDeLista es el precio de lista de cada renglón para esa lista: el
// propio de la lista o el general por el factor de la derivada, y en media
// placa el porcentaje del producto. nil donde no hay variante o la variante
// no tiene precio: un flete o un ítem cargado a mano no tienen contra qué
// compararse.
//
// La media placa es ventas.PrecioDeMedia (que admite media: una placa que se
// vende «entera_o_media»), escrita acá porque ventas importa cobros, que
// importa este paquete. La prueba de mostrador compara las dos.
func PreciosDeLista(ctx context.Context, c Consultador, renglones []RenglonConVariante, l Lista) ([]*float64, error) {
	out := make([]*float64, len(renglones))
	var ids []string
	for _, r := range renglones {
		if r.VariantID != nil {
			ids = append(ids, *r.VariantID)
		}
	}
	if len(ids) == 0 {
		return out, nil
	}
	filas, err := c.Query(ctx, `
		SELECT v.id::text, coalesce(pr.price, round((ge.price * $3::numeric)::numeric, 2)),
		       p.unit, p.forma_de_venta::text, p.precio_media_pct
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		LEFT JOIN price_list_items pr ON pr.variant_id = v.id AND pr.price_list_id = $1
		LEFT JOIN price_list_items ge ON ge.variant_id = v.id AND ge.price_list_id = $2
		WHERE v.id = ANY($4::uuid[])`, l.ID, l.GeneralID, jsmath.Texto(l.FactorDerivado), ids)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	type dato struct {
		precio      *float64
		admiteMedia bool
		pctMedia    float64
	}
	datos := map[string]dato{}
	for filas.Next() {
		var id, unidad, forma string
		var precio *jsmath.Num
		var media jsmath.Num
		if err := filas.Scan(&id, &precio, &unidad, &forma, &media); err != nil {
			return nil, err
		}
		d := dato{admiteMedia: unidad == "placa" && forma == "entera_o_media", pctMedia: media.F()}
		if precio != nil {
			p := precio.F()
			d.precio = &p
		}
		datos[id] = d
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}
	for i, r := range renglones {
		if r.VariantID == nil {
			continue
		}
		d, ok := datos[*r.VariantID]
		if !ok || d.precio == nil {
			continue
		}
		p := *d.precio
		if r.Presentacion != nil && (*r.Presentacion == "media_largo" || *r.Presentacion == "media_ancho") && d.admiteMedia {
			p = jsmath.Round(float64(p*d.pctMedia) / 100) // al peso
		}
		out[i] = &p
	}
	return out, nil
}

// PorcentajeLibreDeArranque es el de la migración 00141, por si la fila no
// está (una base de pruebas sin datos).
const PorcentajeLibreDeArranque = 5

// PorcentajeLibre es lo que se puede dejar de cobrar en una venta sin el PIN
// de un admin: una regla del negocio (/admin/reglas), 0, 5 o 10. Lo usan el
// mostrador y el presupuesto vencido que se pasa a pedido respetando los
// precios: una sola regla.
func PorcentajeLibre(ctx context.Context, c Consultador) (float64, error) {
	var valor string
	err := c.QueryRow(ctx, `SELECT valor FROM site_settings WHERE clave = 'descuento_sin_autorizacion_pct'`).Scan(&valor)
	if errors.Is(err, pgx.ErrNoRows) {
		return PorcentajeLibreDeArranque, nil
	}
	if err != nil {
		return 0, err
	}
	switch valor {
	case "0", "5", "10":
		n, _ := strconv.Atoi(valor)
		return float64(n), nil
	}
	return PorcentajeLibreDeArranque, nil
}

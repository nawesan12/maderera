package reportes

import (
	"context"
	"sort"
	"time"

	"mjbj/internal/autorizacion"
	"mjbj/internal/jsmath"
)

// Los controles sobre la plata del personal, a la vista del dueño (T3,
// 18/11/2026). Todo quedaba en la bitácora, y el dueño no lee la bitácora:
// lo dejado de cobrar, las anulaciones, las ventas sin conexión bajo la
// lista y los retiros tardíos o bajo la base, por persona y con su monto, en
// los últimos siete días (como las anuladas). Un control que no se ve no
// controla nada.

// ControlDePersona es lo de una persona del mostrador.
type ControlDePersona struct {
	Nombre string `json:"nombre"`
	// DejadoDeCobrar: lo que sus ventas quedaron bajo la lista más los
	// descuentos tipeados; Autorizado, la parte que firmó un admin.
	DejadoDeCobrar float64 `json:"dejadoDeCobrar"`
	Autorizado     float64 `json:"autorizado"`
	// SinConexion: ventas sin conexión que pasaron lo libre sin PIN.
	SinConexion Monto `json:"sinConexion"`
	// CreditoSinAutorizar: ventas sin conexión que cargaron a cuenta pasado
	// el límite o con mora, sin PIN: deuda nueva que nadie firmó.
	CreditoSinAutorizar Monto `json:"creditoSinAutorizar"`
	// Anuladas por esta persona; SinFirma, las que anuló sin PIN de nadie
	// (hoy solo las propias con tarjeta o transferencia de hace un rato);
	// SinDevolver, las que «se la llevó».
	Anuladas         Monto `json:"anuladas"`
	AnuladasSinFirma Monto `json:"anuladasSinFirma"`
	SinDevolver      int   `json:"sinDevolver"`
	// Retiros que llegaron con la caja cerrada o dejaron el cajón bajo la base.
	Retiros Monto `json:"retiros"`
	// AMano: los renglones de sus ventas del mostrador cargados a mano, sin
	// producto del catálogo (ni pasadas ni tapacanto de un corte). Entran a
	// su propio precio y no tienen lista contra la cual medirse: es el
	// camino para esquivar el control de precio (comité final, M12). Por
	// ahora se muestran; un tope con PIN lo decide el dueño.
	AMano Monto `json:"aMano"`
	// Firmo: lo que este admin autorizó con su PIN o su sesión (lo dejado de
	// cobrar de las ventas y lo anulado). Un PIN aprendido firma a nombre del
	// dueño: acá se ve cuántas firmas lleva, para poder decir «esas no fui
	// yo».
	Firmo Monto `json:"firmo"`
}

// Controles es el bloque entero.
type Controles struct {
	// SinPIN: ningún admin cargó su PIN y todo lo que lo pide queda trabado.
	SinPIN   bool               `json:"sinPin"`
	Personas []ControlDePersona `json:"personas"`
}

// ControlesDelPersonal arma el bloque de los últimos siete días argentinos.
func (s *Servicio) ControlesDelPersonal(ctx context.Context, ahora time.Time) (Controles, error) {
	c := Controles{Personas: []ControlDePersona{}}
	hay, err := autorizacion.HayAdminConPIN(ctx, s.pool)
	if err != nil {
		return c, err
	}
	c.SinPIN = !hay
	desde := InicioDelDia(ahora).AddDate(0, 0, -6)
	hasta := InicioDelDia(ahora).AddDate(0, 0, 1)

	porID := map[string]*ControlDePersona{}
	de := func(id, nombre string) *ControlDePersona {
		p, ok := porID[id]
		if !ok {
			p = &ControlDePersona{Nombre: nombre}
			porID[id] = p
		}
		return p
	}
	// Las ventas: lo dejado de cobrar, de quien vendió.
	filas, err := s.pool.Query(ctx, `
		SELECT o.created_by_user_id, coalesce(u.name, 'Sin nombre'),
		       coalesce(sum(o.dejado_de_cobrar), 0), coalesce(sum(o.dejado_de_cobrar) FILTER (WHERE o.autorizado_por IS NOT NULL), 0),
		       (count(*) FILTER (WHERE o.bajo_lista_sin_autorizar))::int, coalesce(sum(o.dejado_de_cobrar) FILTER (WHERE o.bajo_lista_sin_autorizar), 0),
		       (count(*) FILTER (WHERE o.credito_sin_autorizar > 0))::int, coalesce(sum(o.credito_sin_autorizar), 0)
		FROM orders o LEFT JOIN "user" u ON u.id = o.created_by_user_id
		WHERE o.created_at >= $1 AND o.created_at < $2 AND o.estado <> 'cancelado'
		  AND (o.dejado_de_cobrar > 0 OR o.bajo_lista_sin_autorizar OR o.credito_sin_autorizar > 0) AND o.created_by_user_id IS NOT NULL
		GROUP BY 1, 2`, desde, hasta)
	if err != nil {
		return c, err
	}
	for filas.Next() {
		var id, nombre string
		var dejado, autorizado, sinConexion, credito jsmath.Num
		var n, nc int
		if err := filas.Scan(&id, &nombre, &dejado, &autorizado, &n, &sinConexion, &nc, &credito); err != nil {
			filas.Close()
			return c, err
		}
		p := de(id, nombre)
		p.DejadoDeCobrar, p.Autorizado = dejado.F(), autorizado.F()
		p.SinConexion = Monto{Total: sinConexion.F(), Cantidad: n}
		p.CreditoSinAutorizar = Monto{Total: credito.F(), Cantidad: nc}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}
	// Los renglones a mano: de quien vendió.
	filas, err = s.pool.Query(ctx, `
		SELECT o.created_by_user_id, coalesce(u.name, 'Sin nombre'), count(*)::int, coalesce(sum(oi.subtotal), 0)
		FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN "user" u ON u.id = o.created_by_user_id
		WHERE o.origen = 'mostrador' AND o.estado <> 'cancelado' AND o.created_at >= $1 AND o.created_at < $2
		  AND o.created_by_user_id IS NOT NULL AND oi.variant_id IS NULL
		  AND oi.unidad <> 'pasada' AND NOT (oi.unidad = 'm' AND oi.descripcion LIKE 'Tapacanto%')
		GROUP BY 1, 2`, desde, hasta)
	if err != nil {
		return c, err
	}
	for filas.Next() {
		var id, nombre string
		var n int
		var total jsmath.Num
		if err := filas.Scan(&id, &nombre, &n, &total); err != nil {
			filas.Close()
			return c, err
		}
		de(id, nombre).AMano = Monto{Total: total.F(), Cantidad: n}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}
	// Las anulaciones: de quien anuló.
	filas, err = s.pool.Query(ctx, `
		SELECT a.quien_id, coalesce(a.quien, 'Sin nombre'), count(*)::int, coalesce(sum(o.total), 0),
		       (count(*) FILTER (WHERE o.mercaderia_no_volvio))::int,
		       (count(*) FILTER (WHERE o.anulacion_autorizada_por IS NULL))::int,
		       coalesce(sum(o.total) FILTER (WHERE o.anulacion_autorizada_por IS NULL), 0)
		FROM orders o
		JOIN LATERAL (SELECT h.created_at, h.created_by_user_id AS quien_id, hu.name AS quien FROM order_status_history h
		              LEFT JOIN "user" hu ON hu.id = h.created_by_user_id
		              WHERE h.order_id = o.id AND h.estado = 'cancelado'
		              ORDER BY h.created_at DESC LIMIT 1) a ON true
		WHERE o.origen = 'mostrador' AND o.estado = 'cancelado' AND a.created_at >= $1 AND a.created_at < $2 AND a.quien_id IS NOT NULL
		GROUP BY 1, 2`, desde, hasta)
	if err != nil {
		return c, err
	}
	for filas.Next() {
		var id, nombre string
		var n, sinDevolver, sinFirma int
		var total, totalSinFirma jsmath.Num
		if err := filas.Scan(&id, &nombre, &n, &total, &sinDevolver, &sinFirma, &totalSinFirma); err != nil {
			filas.Close()
			return c, err
		}
		p := de(id, nombre)
		p.Anuladas, p.SinDevolver = Monto{Total: total.F(), Cantidad: n}, sinDevolver
		p.AnuladasSinFirma = Monto{Total: totalSinFirma.F(), Cantidad: sinFirma}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}
	// Los retiros tardíos o bajo la base: de quien los hizo.
	filas, err = s.pool.Query(ctx, `
		SELECT m.creado_por, coalesce(u.name, 'Sin nombre'), count(*)::int, coalesce(-sum(m.monto), 0)
		FROM cash_movements m LEFT JOIN "user" u ON u.id = m.creado_por
		WHERE m.tipo = 'retiro' AND (m.declarado_at IS NOT NULL OR m.bajo_la_base)
		  AND m.created_at >= $1 AND m.created_at < $2 AND m.creado_por IS NOT NULL
		GROUP BY 1, 2`, desde, hasta)
	if err != nil {
		return c, err
	}
	for filas.Next() {
		var id, nombre string
		var n int
		var total jsmath.Num
		if err := filas.Scan(&id, &nombre, &n, &total); err != nil {
			filas.Close()
			return c, err
		}
		de(id, nombre).Retiros = Monto{Total: total.F(), Cantidad: n}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}
	// Las firmas de cada admin: las ventas que autorizó (lo dejado de cobrar)
	// y las anulaciones que firmó (su total), sin contar las propias.
	filas, err = s.pool.Query(ctx, `
		SELECT f.quien, coalesce(u.name, 'Sin nombre'), count(*)::int, coalesce(sum(f.monto), 0)
		FROM (
		  SELECT o.autorizado_por AS quien, o.dejado_de_cobrar AS monto FROM orders o
		  WHERE o.autorizado_por IS NOT NULL AND o.autorizado_por IS DISTINCT FROM o.created_by_user_id
		    AND o.created_at >= $1 AND o.created_at < $2
		  UNION ALL
		  SELECT o.anulacion_autorizada_por, o.total FROM orders o
		  JOIN LATERAL (SELECT h.created_at, h.created_by_user_id FROM order_status_history h
		                WHERE h.order_id = o.id AND h.estado = 'cancelado' ORDER BY h.created_at DESC LIMIT 1) a ON true
		  WHERE o.anulacion_autorizada_por IS NOT NULL AND o.anulacion_autorizada_por IS DISTINCT FROM a.created_by_user_id
		    AND a.created_at >= $1 AND a.created_at < $2
		) f LEFT JOIN "user" u ON u.id = f.quien
		GROUP BY 1, 2`, desde, hasta)
	if err != nil {
		return c, err
	}
	for filas.Next() {
		var id, nombre string
		var n int
		var total jsmath.Num
		if err := filas.Scan(&id, &nombre, &n, &total); err != nil {
			filas.Close()
			return c, err
		}
		de(id, nombre).Firmo = Monto{Total: total.F(), Cantidad: n}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return c, err
	}
	for _, p := range porID {
		c.Personas = append(c.Personas, *p)
	}
	// Primero lo que no firmó nadie: sin conexión (precio y crédito), «se la
	// llevó», retiros.
	sort.Slice(c.Personas, func(i, j int) bool {
		a, b := c.Personas[i], c.Personas[j]
		pa := a.SinConexion.Total + a.CreditoSinAutorizar.Total + a.Retiros.Total + float64(a.SinDevolver)*1e9 + (a.DejadoDeCobrar - a.Autorizado)
		pb := b.SinConexion.Total + b.CreditoSinAutorizar.Total + b.Retiros.Total + float64(b.SinDevolver)*1e9 + (b.DejadoDeCobrar - b.Autorizado)
		if pa != pb {
			return pa > pb
		}
		return a.Nombre < b.Nombre
	})
	return c, nil
}

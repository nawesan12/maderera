package precios

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Las ofertas de un producto (M2S2-030): el precio baja hasta una fecha y el
// de antes se muestra tachado. El catálogo y el mostrador ya las leían
// (price_list_items.precio_anterior y oferta_hasta), pero solo las escribía
// una migración. Al vencer, el precio vuelve solo (VencerOfertas).

var zonaArgentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// Ofertar pone un precio de oferta hasta un día (AAAA-MM-DD, inclusive). El
// precio de antes queda guardado; si ya había una oferta, se mantiene el de
// antes de la primera.
func (s *Servicio) Ofertar(ctx context.Context, ses *auth.Sesion, variante, lista, precio, hasta string, ahora time.Time) error {
	if !plataforma.UUIDValido(variante) || !plataforma.UUIDValido(lista) {
		return plataforma.Invalido(map[string]string{"precio": "Invalid UUID"})
	}
	n := jsmath.Numero(precio)
	if !(n > 0) || n != n || n > 1e300 {
		return plataforma.Invalido(map[string]string{"precio": "El precio tiene que ser un número positivo."})
	}
	dia, err := time.ParseInLocation("2006-01-02", hasta, zonaArgentina)
	if err != nil {
		return plataforma.Invalido(map[string]string{"hasta": "Revisá la fecha."})
	}
	hoy := ahora.In(zonaArgentina)
	hoyDia := time.Date(hoy.Year(), hoy.Month(), hoy.Day(), 0, 0, 0, 0, zonaArgentina)
	switch {
	case dia.Before(hoyDia):
		return plataforma.Invalido(map[string]string{"hasta": "La oferta tiene que terminar hoy o más adelante."})
	case dia.After(hoyDia.AddDate(1, 0, 0)):
		return plataforma.Invalido(map[string]string{"hasta": "Una oferta dura un año como mucho."})
	}
	fin := dia.AddDate(0, 0, 1) // termina al empezar el día siguiente
	valor := jsmath.Fijo2(n)
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var actual string
		var anterior *string
		var vence *time.Time
		err := tx.QueryRow(ctx, `SELECT price::text, precio_anterior::text, oferta_hasta FROM price_list_items
			WHERE variant_id = $1 AND price_list_id = $2 FOR UPDATE`, variante, lista).Scan(&actual, &anterior, &vence)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.Invalido(map[string]string{"precio": "Cargale el precio antes de ponerlo en oferta."})
		}
		if err != nil {
			return err
		}
		base := actual
		if anterior != nil && vence != nil && vence.After(ahora) {
			base = *anterior
		}
		if !(n < jsmath.Numero(base)) {
			return plataforma.Invalido(map[string]string{"precio": "La oferta tiene que ser menor que el precio de antes."})
		}
		if _, err := tx.Exec(ctx, `UPDATE price_list_items SET price = $3::numeric, precio_anterior = $4::numeric, oferta_hasta = $5, updated_at = now()
			WHERE variant_id = $1 AND price_list_id = $2`, variante, lista, valor, base, fin); err != nil {
			return err
		}
		motivo := "Oferta hasta el " + dia.Format("02/01/2006")
		if err := sqlc.New(tx).AnotarPrecio(ctx, sqlc.AnotarPrecioParams{VariantID: variante, PriceListID: lista, Anterior: &actual,
			Nuevo: valor, Origen: sqlc.PriceChangeSourceManual, Motivo: &motivo, CreatedByUserID: &ses.UserID}); err != nil {
			return err
		}
		bitacora.Anotar(ctx, sqlc.New(tx), s.log, ses, sqlc.AccionAuditoriaEditar, "precio", variante, motivo+" a "+valor,
			map[string]any{"antes": base, "oferta": valor})
		return nil
	})
}

// TerminarOferta vuelve al precio de antes en el momento.
func (s *Servicio) TerminarOferta(ctx context.Context, ses *auth.Sesion, variante, lista string) error {
	if !plataforma.UUIDValido(variante) || !plataforma.UUIDValido(lista) {
		return plataforma.Invalido(map[string]string{"precio": "Invalid UUID"})
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		n, err := volverDeOfertas(ctx, tx, `variant_id = $1 AND price_list_id = $2`, &ses.UserID, "Terminó la oferta", variante, lista)
		if err != nil {
			return err
		}
		if n == 0 {
			return plataforma.Invalido(map[string]string{"precio": "No tiene una oferta."})
		}
		bitacora.Anotar(ctx, sqlc.New(tx), s.log, ses, sqlc.AccionAuditoriaEditar, "precio", variante, "Terminó la oferta", nil)
		return nil
	})
}

// VencerOfertas devuelve el precio de antes a las ofertas que ya vencieron.
// Lo corre el worker cada hora.
func (s *Servicio) VencerOfertas(ctx context.Context) (int, error) {
	var n int
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		n, err = volverDeOfertas(ctx, tx, `oferta_hasta <= now()`, nil, "Venció la oferta")
		return err
	})
	return n, err
}

// volverDeOfertas restituye el precio de antes donde `donde`, y lo anota en
// el historial.
func volverDeOfertas(ctx context.Context, tx pgx.Tx, donde string, usuario *string, motivo string, args ...any) (int, error) {
	base := len(args)
	filas, err := tx.Query(ctx, `
		WITH volver AS (
		  SELECT variant_id, price_list_id, price AS ahora, precio_anterior AS antes FROM price_list_items
		  WHERE precio_anterior IS NOT NULL AND oferta_hasta IS NOT NULL AND `+donde+` FOR UPDATE
		), hecho AS (
		  UPDATE price_list_items p SET price = v.antes, precio_anterior = NULL, oferta_hasta = NULL, updated_at = now()
		  FROM volver v WHERE p.variant_id = v.variant_id AND p.price_list_id = v.price_list_id
		  RETURNING p.variant_id, p.price_list_id
		)
		INSERT INTO price_history (variant_id, price_list_id, precio_anterior, precio_nuevo, origen, motivo, created_by_user_id)
		SELECT v.variant_id, v.price_list_id, v.ahora, v.antes, 'manual', $`+itoa(base+1)+`, $`+itoa(base+2)+`
		FROM volver v JOIN hecho h ON h.variant_id = v.variant_id AND h.price_list_id = v.price_list_id
		RETURNING 1`, append(args, motivo, usuario)...)
	if err != nil {
		return 0, err
	}
	defer filas.Close()
	n := 0
	for filas.Next() {
		n++
	}
	return n, filas.Err()
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return string(rune('0'+n/10)) + string(rune('0'+n%10))
}

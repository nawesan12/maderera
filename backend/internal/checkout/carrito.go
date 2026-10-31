// Package checkout es el carrito del sitio, el pedido de presupuesto y la
// compra: lib/dal/carrito.ts, app/(public)/carrito-actions.ts,
// app/(public)/carrito/actions.ts, app/(public)/carrito/confirmar/actions.ts
// y la escritura de cart_cortes de app/(public)/corte/actions.ts (tanda 6).
//
// El carrito se encuentra por la sesión (user_id) o, sin sesión, por la
// cookie `mjbj_carrito`, que pone Go cuando lo crea (Next la copia al
// navegador). Leer no crea nada: solo las acciones que agregan.
package checkout

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/catalogo"
	"mjbj/internal/cortes"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/productos"
	"mjbj/internal/sqlc"
	"mjbj/internal/ventas"
)

// CookieCarrito es la cookie del carrito sin sesión.
const CookieCarrito = "mjbj_carrito"

// Servicio es el carrito y la compra.
type Servicio struct {
	pool   *pgxpool.Pool
	cat    *catalogo.Servicio
	cortes *cortes.Servicio
	lim    *limites.Limitador
	log    *slog.Logger
	ahora  func() time.Time
	// SinCandado apaga el bloqueo del carrito al confirmar (solo para ver
	// fallar la prueba de concurrencia).
	SinCandado bool
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, cat: catalogo.Nuevo(pool), cortes: cortes.Nuevo(pool, log), lim: limites.Nuevo(sqlc.New(pool), log), log: log, ahora: time.Now}
}

// Quien es quien pide: la sesión (o nil) y el token de la cookie.
type Quien struct {
	Ses   *auth.Sesion
	Token string
}

// Resultado es el { ok, error } de las acciones del carrito, más la cookie
// nueva si se creó el carrito.
type Resultado struct {
	Ok    string `json:"ok,omitempty"`
	Error string `json:"error,omitempty"`
	// TokenNuevo es el token del carrito recién creado sin sesión: va en la
	// cookie.
	TokenNuevo string `json:"-"`
}

func fallo(m string) error { return plataforma.NuevoProblema(http.StatusUnprocessableEntity, m) }

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// idDelCarrito busca el carrito activo de quien pide, sin crearlo.
func idDelCarrito(ctx context.Context, db consultor, q Quien) (string, error) {
	var id string
	var err error
	switch {
	case q.Ses != nil:
		err = db.QueryRow(ctx, `SELECT id FROM carts WHERE activo AND user_id = $1 LIMIT 1`, q.Ses.UserID).Scan(&id)
	case q.Token != "":
		err = db.QueryRow(ctx, `SELECT id FROM carts WHERE activo AND token = $1 LIMIT 1`, q.Token).Scan(&id)
	default:
		return "", nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// ObtenerOCrear es obtenerOCrearCarrito: el de la sesión, el anónimo de la
// cookie (que se adopta si ahora hay sesión) o uno nuevo. Con sesión va con
// un candado por usuario (hashtext('carrito:' || user_id)): el TS no lo
// tomaba y dos primeros «agregar» a la vez dejaban dos carritos activos.
func (s *Servicio) ObtenerOCrear(ctx context.Context, q Quien) (id, tokenNuevo string, err error) {
	if q.Ses == nil {
		if q.Token != "" {
			if id, err = idDelCarrito(ctx, s.pool, q); id != "" || err != nil {
				return id, "", err
			}
		}
		// Un carrito anónimo nuevo cuenta contra la IP: un navegador lo crea
		// una vez y después manda la cookie; quien no la guarda, crea uno por
		// pedido.
		if r := plataforma.PedidoDe(ctx); r != nil {
			if v := s.lim.Permitido(ctx, limites.Carrito, "ip:"+plataforma.IPDelCliente(r)); !v.Permitido {
				return "", "", espera(v)
			}
		}
		tokenNuevo = uuid()
		err = s.pool.QueryRow(ctx, `INSERT INTO carts (token) VALUES ($1) RETURNING id`, tokenNuevo).Scan(&id)
		return id, tokenNuevo, err
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('carrito:' || $1::text))`, q.Ses.UserID); err != nil {
			return err
		}
		if id, err = idDelCarrito(ctx, tx, Quien{Ses: q.Ses}); id != "" || err != nil {
			return err
		}
		if q.Token != "" {
			if id, err = idDelCarrito(ctx, tx, Quien{Token: q.Token}); err != nil {
				return err
			}
			if id != "" {
				_, err = tx.Exec(ctx, `UPDATE carts SET user_id = $2, updated_at = now() WHERE id = $1`, id, q.Ses.UserID)
				return err
			}
		}
		return tx.QueryRow(ctx, `INSERT INTO carts (token, user_id) VALUES ($1, $2) RETURNING id`, uuid(), q.Ses.UserID).Scan(&id)
	})
	return id, "", err
}

// Adoptar es adoptarCarritoAnonimo: el carrito armado sin sesión pasa a la
// cuenta de quien acaba de entrar; si ya tenía uno, se juntan (lo repetido
// suma cantidad).
func (s *Servicio) Adoptar(ctx context.Context, userID, token string) error {
	if token == "" || userID == "" {
		return nil
	}
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('carrito:' || $1::text))`, userID); err != nil {
			return err
		}
		anonimo, err := idDelCarrito(ctx, tx, Quien{Token: token})
		if err != nil || anonimo == "" {
			return err
		}
		propio, err := idDelCarrito(ctx, tx, Quien{Ses: &auth.Sesion{UserID: userID}})
		if err != nil {
			return err
		}
		if propio == "" {
			_, err = tx.Exec(ctx, `UPDATE carts SET user_id = $2, updated_at = now() WHERE id = $1`, anonimo, userID)
			return err
		}
		if propio == anonimo {
			return nil
		}
		type item struct {
			id       string
			variante *string
			cantidad jsmath.Num
		}
		leer := func(cart string) ([]item, error) {
			filas, _ := tx.Query(ctx, `SELECT id, variant_id, cantidad FROM cart_items WHERE cart_id = $1`, cart)
			return pgx.CollectRows(filas, func(r pgx.CollectableRow) (item, error) {
				var i item
				return i, r.Scan(&i.id, &i.variante, &i.cantidad)
			})
		}
		entrantes, err := leer(anonimo)
		if err != nil {
			return err
		}
		existentes, err := leer(propio)
		if err != nil {
			return err
		}
		for _, e := range entrantes {
			var repetido *item
			if e.variante != nil {
				for i := range existentes {
					if existentes[i].variante != nil && *existentes[i].variante == *e.variante {
						repetido = &existentes[i]
						break
					}
				}
			}
			if repetido != nil {
				_, err = tx.Exec(ctx, `UPDATE cart_items SET cantidad = $2::numeric WHERE id = $1`, repetido.id,
					jsmath.ToFixed(float64(repetido.cantidad)+float64(e.cantidad), 2))
			} else {
				_, err = tx.Exec(ctx, `UPDATE cart_items SET cart_id = $2 WHERE id = $1`, e.id, propio)
			}
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `DELETE FROM carts WHERE id = $1`, anonimo)
		return err
	})
}

// Obtener es obtenerCarrito: los renglones con el precio de la lista de
// quien mira, los descuentos por volumen y los cortes. No crea nada.
func (s *Servicio) Obtener(ctx context.Context, q Quien) (Carrito, error) {
	id, err := idDelCarrito(ctx, s.pool, q)
	if err != nil || id == "" {
		return CarritoVacio(), err
	}
	lista, err := s.cat.Vigente(ctx, q.Ses)
	if err != nil {
		return Carrito{}, err
	}
	return s.leer(ctx, s.pool, id, lista)
}

type lector interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func (s *Servicio) leer(ctx context.Context, db lector, id string, lista catalogo.Lista) (Carrito, error) {
	escalas := []EscalaDeVolumen{}
	if lista.ID != nil {
		filas, err := db.Query(ctx, `
			SELECT id, variant_id, category_id, desde_cantidad::float8, porcentaje::float8
			FROM volume_discounts WHERE price_list_id = $1 AND activo`, *lista.ID)
		if err != nil {
			return Carrito{}, err
		}
		escalas, err = pgx.CollectRows(filas, func(r pgx.CollectableRow) (EscalaDeVolumen, error) {
			var e EscalaDeVolumen
			return e, r.Scan(&e.ID, &e.VariantID, &e.CategoryID, &e.DesdeCantidad, &e.Porcentaje)
		})
		if err != nil {
			return Carrito{}, err
		}
	}
	filas, err := db.Query(ctx, `
		SELECT id::text, variant_id::text, material_descripcion, placa_largo_mm, placa_ancho_mm, mitad, canto_descripcion,
		       piezas, placas, pasadas, total::text
		FROM cart_cortes WHERE cart_id = $1 ORDER BY created_at ASC`, id)
	if err != nil {
		return Carrito{}, err
	}
	cortesDelCarrito, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaDeCorte, error) {
		var c FilaDeCorte
		var largo, ancho, placas, pasadas int32
		err := r.Scan(&c.ID, &c.VariantID, &c.MaterialDescripcion, &largo, &ancho, &c.Mitad, &c.CantoDescripcion,
			&c.Piezas, &placas, &pasadas, &c.Total)
		c.PlacaLargoMm, c.PlacaAnchoMm, c.Placas, c.Pasadas = int(largo), int(ancho), int(placas), int(pasadas)
		return c, err
	})
	if err != nil {
		return Carrito{}, err
	}
	// Mismo respaldo que el catálogo: la lista propia manda y la general (con
	// el factor de una lista derivada) cubre lo que no tenga cargado.
	filas, err = db.Query(ctx, `
		SELECT ci.id::text, ci.variant_id::text, ci.descripcion, ci.unidad, ci.cantidad::text, ci.precio_unitario::text,
		       ci.origen, ci.notas, ci.presentacion, p.unit::text, p.forma_de_venta::text, p.precio_media_pct::float8, p.slug,
		       p.category_id::text,
		       coalesce(propia.price, round((general.price * $4::numeric)::numeric, 2))::text
		FROM cart_items ci
		LEFT JOIN product_variants v ON v.id = ci.variant_id
		LEFT JOIN products p ON p.id = v.product_id
		LEFT JOIN price_list_items propia ON propia.variant_id = ci.variant_id AND propia.price_list_id = $2
		LEFT JOIN price_list_items general ON general.variant_id = ci.variant_id AND general.price_list_id = $3
		WHERE ci.cart_id = $1 ORDER BY ci.created_at ASC`, id, lista.ID, lista.GeneralID, jsmath.Texto(lista.FactorDerivado))
	if err != nil {
		return Carrito{}, err
	}
	items, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaDelCarrito, error) {
		var f FilaDelCarrito
		return f, r.Scan(&f.ID, &f.VariantID, &f.Descripcion, &f.Unidad, &f.Cantidad, &f.PrecioUnitario, &f.Origen, &f.Notas,
			&f.Presentacion, &f.Unit, &f.FormaDeVenta, &f.PrecioMediaPct, &f.Slug, &f.CategoryID, &f.PrecioActual)
	})
	if err != nil {
		return Carrito{}, err
	}
	var nombre *string
	if lista.EsDiferenciada {
		nombre = lista.Nombre
	}
	return ArmarCarrito(id, items, cortesDelCarrito, escalas, nombre), nil
}

// --- app/(public)/carrito-actions.ts ---

// MaximoPorTanda es cuántas líneas se pueden mandar juntas.
const MaximoPorTanda = 40

// Agregar es agregarAlCarrito: si la misma medida ya estaba, suma la
// cantidad. Bloquea la fila del carrito: dos «agregar» a la vez de lo mismo
// repetían el renglón en el TS.
func (s *Servicio) Agregar(ctx context.Context, q Quien, m map[string]any) (Resultado, error) {
	item, e := LeerAgregado(m)
	if e != nil {
		return Resultado{Error: e.Mensaje}, nil
	}
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	r := Resultado{TokenNuevo: token}
	var precio *string
	if item.VariantID != nil {
		var p ventas.ProductoQueSeVende
		var pct jsmath.Num
		err := s.pool.QueryRow(ctx, `
			SELECT p.unit::text, p.forma_de_venta::text, p.precio_media_pct
			FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1 LIMIT 1`, *item.VariantID).
			Scan(&p.Unit, &p.FormaDeVenta, &pct)
		if errors.Is(err, pgx.ErrNoRows) {
			r.Error = "Ese producto ya no está disponible."
			return r, nil
		}
		if err != nil {
			return r, err
		}
		p.PrecioMediaPct = float64(pct)
		if !ventas.AdmiteMedia(p) {
			item.Presentacion = nil
		}
		unidad := p.Unit
		if ventas.SeVendePorM2(p) {
			unidad = "metro_cuadrado"
		}
		fraccionable := productos.AdmiteDecimales(unidad) && unidad != "placa"
		if !fraccionable && item.Cantidad != float64(int64(item.Cantidad)) {
			r.Error = "Este producto se vende por unidad entera."
			return r, nil
		}
		// El precio de la lista de quien compra, como lo lee el carrito: con
		// el de la general, a un profesional el aviso de «cambió el precio»
		// le salía siempre.
		vigente, err := s.cat.Vigente(ctx, q.Ses)
		if err != nil {
			return r, err
		}
		var lista *jsmath.Num
		err = s.pool.QueryRow(ctx, `
			SELECT coalesce(propia.price, round((general.price * $4::numeric)::numeric, 2))
			FROM product_variants v
			LEFT JOIN price_list_items propia ON propia.variant_id = v.id AND propia.price_list_id = $2
			LEFT JOIN price_list_items general ON general.variant_id = v.id AND general.price_list_id = $3
			WHERE v.id = $1`, *item.VariantID, vigente.ID, vigente.GeneralID, jsmath.Texto(vigente.FactorDerivado)).Scan(&lista)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return r, err
		}
		if lista != nil {
			v := float64(*lista)
			if item.Presentacion != nil && ventas.AdmiteMedia(p) {
				v = ventas.PrecioDeMedia(v, p.PrecioMediaPct)
			}
			t := jsmath.Fijo2(v)
			precio = &t
		}
	}
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT 1 FROM carts WHERE id = $1 FOR UPDATE`, cart); err != nil {
			return err
		}
		if item.VariantID != nil {
			var existente string
			var cantidad jsmath.Num
			err := tx.QueryRow(ctx, `
				SELECT id, cantidad FROM cart_items
				WHERE cart_id = $1 AND variant_id = $2 AND presentacion IS NOT DISTINCT FROM $3 LIMIT 1`,
				cart, *item.VariantID, item.Presentacion).Scan(&existente, &cantidad)
			if err == nil {
				if _, err := tx.Exec(ctx, `UPDATE cart_items SET cantidad = $2::numeric WHERE id = $1`, existente,
					jsmath.Fijo2(float64(cantidad)+item.Cantidad)); err != nil {
					return err
				}
				r.Ok = "Sumaste " + formato.Cantidad(item.Cantidad) + " a " + item.Descripcion + "."
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO cart_items (cart_id, variant_id, descripcion, unidad, cantidad, presentacion, precio_unitario, origen, notas)
			VALUES ($1, $2, $3, $4, $5::numeric, $6, $7::numeric, $8, $9)`,
			cart, item.VariantID, item.Descripcion, item.Unidad, jsmath.Fijo2(item.Cantidad), item.Presentacion, precio,
			item.Origen, item.Notas)
		r.Ok = item.Descripcion + " va al presupuesto."
		return err
	})
	return r, err
}

// AgregarVarios es agregarVarios: la calculadora manda todo junto.
func (s *Servicio) AgregarVarios(ctx context.Context, q Quien, items []any) (Resultado, error) {
	if len(items) == 0 {
		return Resultado{Error: "No hay nada para agregar."}, nil
	}
	if len(items) > MaximoPorTanda {
		return Resultado{Error: fmt.Sprintf("Son demasiadas líneas juntas (%d). Agregalas en tandas de %d.", len(items), MaximoPorTanda)}, nil
	}
	token := ""
	for _, x := range items {
		m, _ := x.(map[string]any)
		if m == nil {
			m = map[string]any{}
		}
		r, err := s.Agregar(ctx, q, m)
		if r.TokenNuevo != "" {
			token, q.Token = r.TokenNuevo, r.TokenNuevo
		}
		if err != nil {
			return Resultado{TokenNuevo: token}, err
		}
		if r.Error != "" {
			r.TokenNuevo = token
			return r, nil
		}
	}
	return Resultado{Ok: fmt.Sprintf("Se agregaron %d productos al presupuesto.", len(items)), TokenNuevo: token}, nil
}

// CambiarCantidad es cambiarCantidad: cero o menos quita el renglón. Filtra
// por el carrito de quien pide, además de por el id.
func (s *Servicio) CambiarCantidad(ctx context.Context, q Quien, item string, cantidad float64) (Resultado, error) {
	if !(cantidad > 0) || cantidad > 1e300 {
		return s.Quitar(ctx, q, item)
	}
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	_, err = s.pool.Exec(ctx, `UPDATE cart_items SET cantidad = $3::numeric WHERE id = $1 AND cart_id = $2`, item, cart, jsmath.Fijo2(cantidad))
	return Resultado{TokenNuevo: token}, err
}

// Quitar es quitarDelCarrito.
func (s *Servicio) Quitar(ctx context.Context, q Quien, item string) (Resultado, error) {
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM cart_items WHERE id = $1 AND cart_id = $2`, item, cart)
	return Resultado{Ok: "Lo sacamos del presupuesto.", TokenNuevo: token}, err
}

// Vaciar es vaciarCarrito.
func (s *Servicio) Vaciar(ctx context.Context, q Quien) (Resultado, error) {
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1`, cart)
	return Resultado{Ok: "Presupuesto vaciado.", TokenNuevo: token}, err
}

// ActualizarPrecios pone los renglones al precio de hoy de la lista de quien
// compra. **Con la media placa**: el TS guardaba el precio de la entera y el
// aviso de «cambió el precio» no se iba nunca de un renglón de media.
func (s *Servicio) ActualizarPrecios(ctx context.Context, q Quien) (Resultado, error) {
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	r := Resultado{TokenNuevo: token}
	lista, err := s.cat.Vigente(ctx, q.Ses)
	if err != nil {
		return r, err
	}
	if lista.GeneralID == nil {
		r.Error = "No hay lista de precios configurada."
		return r, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT ci.id::text, coalesce(propia.price, round((general.price * $4::numeric)::numeric, 2))::text,
		       ci.presentacion, p.unit::text, p.forma_de_venta::text, p.precio_media_pct::float8
		FROM cart_items ci
		JOIN product_variants v ON v.id = ci.variant_id JOIN products p ON p.id = v.product_id
		LEFT JOIN price_list_items propia ON propia.variant_id = ci.variant_id AND propia.price_list_id = $2
		LEFT JOIN price_list_items general ON general.variant_id = ci.variant_id AND general.price_list_id = $3
		WHERE ci.cart_id = $1 AND coalesce(propia.price, general.price) IS NOT NULL`, cart, lista.ID, lista.GeneralID, jsmath.Texto(lista.FactorDerivado))
	if err != nil {
		return r, err
	}
	type fila struct {
		id, precio  string
		pres        *string
		unit, forma string
		pct         float64
	}
	lineas, err := pgx.CollectRows(filas, func(f pgx.CollectableRow) (fila, error) {
		var x fila
		return x, f.Scan(&x.id, &x.precio, &x.pres, &x.unit, &x.forma, &x.pct)
	})
	if err != nil {
		return r, err
	}
	for _, l := range lineas {
		precio := l.precio
		if p := (ventas.ProductoQueSeVende{Unit: l.unit, FormaDeVenta: l.forma}); ventas.EsPresentacion(l.pres) && ventas.AdmiteMedia(p) {
			precio = jsmath.Fijo2(ventas.PrecioDeMedia(jsmath.Numero(l.precio), l.pct))
		}
		if _, err := s.pool.Exec(ctx, `UPDATE cart_items SET precio_unitario = $2::numeric WHERE id = $1`, l.id, precio); err != nil {
			return r, err
		}
	}
	r.Ok = fmt.Sprintf("Se actualizaron %d precios.", len(lineas))
	return r, nil
}

// AgregarCorte guarda en el carrito un corte armado en el sitio: todo se
// vuelve a calcular con la lista de quien compra (el precio nunca viaja en
// el formulario).
func (s *Servicio) AgregarCorte(ctx context.Context, q Quien, m map[string]any) (Resultado, error) {
	lista, err := s.cat.Vigente(ctx, q.Ses)
	if err != nil {
		return Resultado{}, err
	}
	c, err := s.cortes.CotizarParaElCarrito(ctx, lista, m)
	if err != nil {
		return Resultado{}, err
	}
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	piezas, err := json.Marshal(c.Piezas)
	if err != nil {
		return Resultado{}, err
	}
	_, err = s.pool.Exec(ctx, `
		INSERT INTO cart_cortes (cart_id, variant_id, material_descripcion, placa_largo_mm, placa_ancho_mm, mitad, canto_descripcion,
		                         piezas, placas, pasadas, total)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric)`,
		cart, c.VariantID, c.MaterialDescripcion, int32(c.PlacaLargoMm), int32(c.PlacaAnchoMm), c.Mitad, c.CantoDescripcion,
		string(piezas), int32(c.Placas), int32(c.Pasadas), c.Total)
	return Resultado{Ok: "El corte quedó en tu carrito.", TokenNuevo: token}, err
}

// QuitarCorte saca un corte del carrito de quien pide.
func (s *Servicio) QuitarCorte(ctx context.Context, q Quien, id string) (Resultado, error) {
	if !plataforma.UUIDValido(id) {
		return Resultado{Error: "No se pudo quitar."}, nil
	}
	cart, token, err := s.ObtenerOCrear(ctx, q)
	if err != nil {
		return Resultado{}, err
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM cart_cortes WHERE id = $1 AND cart_id = $2`, id, cart)
	return Resultado{Ok: "Corte quitado.", TokenNuevo: token}, err
}

// QuitarLosQueSeCotizan saca los productos sin precio cargado.
func (s *Servicio) QuitarLosQueSeCotizan(ctx context.Context, q Quien) error {
	c, err := s.Obtener(ctx, q)
	if err != nil || c.ID == nil {
		return err
	}
	var ids []string
	for _, i := range c.Items {
		if precioDelItem(i) <= 0 {
			ids = append(ids, i.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	_, err = s.pool.Exec(ctx, `DELETE FROM cart_items WHERE cart_id = $1 AND id = ANY($2::uuid[])`, *c.ID, ids)
	return err
}

// precioDelItem es `precioActual ?? precioUnitario ?? 0`.
func precioDelItem(i ItemCarrito) float64 {
	switch {
	case i.PrecioActual != nil:
		return *i.PrecioActual
	case i.PrecioUnitario != nil:
		return *i.PrecioUnitario
	}
	return 0
}

package stock

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/catalogo"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// El traslado entre sucursales: un remito interno con varios renglones, que
// sale de una sucursal y queda «en camino» hasta que quien recibe lo
// confirma (mes simulado, H009 y H112). Era una transferencia de a una
// medida por vez, instantánea y sin comprobante: cuatro diálogos para un solo
// viaje del camión, y nada que firmar en destino.
//
// La salida baja el origen en el acto —la mercadería ya no está en el
// estante—, y la entrada sube el destino al recibir. Mientras tanto, la
// grilla la muestra «llegando» en el destino. Los dos movimientos llevan el
// id del traslado en transfer_group.

// RenglonDeTraslado es una medida y cuánto se manda, como texto («2,5»).
type RenglonDeTraslado struct{ VariantID, Cantidad string }

// FormTraslado es lo que manda la pantalla.
type FormTraslado struct {
	OrigenID, DestinoID, Nota string
	Renglones                 []RenglonDeTraslado
}

// MaxRenglonesDeTraslado: un camión, no el inventario entero.
const MaxRenglonesDeTraslado = 100

// CodigoDeTraslado es el número a la vista: TRA-0012.
func CodigoDeTraslado(n int32) string { return fmt.Sprintf("TRA-%04d", n) }

type renglonValido struct {
	variante string
	cantidad float64
}

func (s *Servicio) validarTraslado(ctx context.Context, f FormTraslado) ([]renglonValido, string, error) {
	mal := func(campo, m string) ([]renglonValido, string, error) {
		return nil, "", plataforma.Invalido(map[string]string{campo: m})
	}
	if !plataforma.UUIDValido(f.OrigenID) {
		return mal("origenId", "Elegí la sucursal de origen.")
	}
	if !plataforma.UUIDValido(f.DestinoID) {
		return mal("destinoId", "Elegí la sucursal de destino.")
	}
	if f.OrigenID == f.DestinoID {
		return mal("destinoId", "El origen y el destino tienen que ser distintos.")
	}
	nota := strings.TrimSpace(f.Nota)
	if plataforma.LargoJS(nota) > 300 {
		return mal("nota", "La nota va en 300 letras o menos.")
	}
	if len(f.Renglones) == 0 {
		return mal("renglones", "Agregá al menos una medida.")
	}
	if len(f.Renglones) > MaxRenglonesDeTraslado {
		return mal("renglones", fmt.Sprintf("Un traslado lleva hasta %d medidas.", MaxRenglonesDeTraslado))
	}
	// La misma medida dos veces se suma: es lo que se carga en el camión.
	suma := map[string]float64{}
	var orden []string
	for i, r := range f.Renglones {
		campo := fmt.Sprintf("renglones.%d", i)
		if !plataforma.UUIDValido(r.VariantID) {
			return mal(campo, "Elegí un producto.")
		}
		c := Cantidad(LeerCantidad(r.Cantidad))
		if math.IsNaN(c) || math.IsInf(c, 0) {
			return mal(campo, "La cantidad tiene que ser un número.")
		}
		if c <= 0 {
			return mal(campo, "La cantidad tiene que ser mayor a cero.")
		}
		if err := s.revisarCantidad(ctx, r.VariantID, c); err != nil {
			return nil, "", err
		}
		if _, ya := suma[r.VariantID]; !ya {
			orden = append(orden, r.VariantID)
		}
		suma[r.VariantID] = Cantidad(suma[r.VariantID] + c)
	}
	out := make([]renglonValido, len(orden))
	for i, v := range orden {
		out[i] = renglonValido{v, suma[v]}
	}
	return out, nota, nil
}

// TrasladoCreado es lo que vuelve al registrarlo.
type TrasladoCreado struct {
	ID     string `json:"id"`
	Codigo string `json:"codigo"`
}

// CrearTraslado saca la mercadería del origen y deja el traslado en camino.
// Controla contra lo disponible del origen (físico − reservado), con el
// candado de cada medida, tomados en un orden fijo.
func (s *Servicio) CrearTraslado(ctx context.Context, ses *auth.Sesion, f FormTraslado) (TrasladoCreado, error) {
	var out TrasladoCreado
	renglones, nota, err := s.validarTraslado(ctx, f)
	if err != nil {
		return out, err
	}
	var origen, destino string
	if err := s.pool.QueryRow(ctx, `SELECT
		(SELECT name FROM branches WHERE id = $1 AND active), (SELECT name FROM branches WHERE id = $2 AND active)`,
		f.OrigenID, f.DestinoID).Scan(&origen, &destino); err != nil {
		return out, plataforma.Invalido(map[string]string{"origenId": "No se encontró la sucursal."})
	}
	var notaP *string
	if nota != "" {
		notaP = &nota
	}
	var numero int32
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		candados := make([]string, len(renglones))
		for i, r := range renglones {
			candados[i] = r.variante
		}
		sort.Strings(candados)
		for _, v := range candados {
			if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: v, Sucursal: f.OrigenID}); err != nil {
				return err
			}
		}
		// Primero se revisa todo: un renglón que no alcanza no gasta un número.
		fisicos := make([]float64, len(renglones))
		for i, r := range renglones {
			fisico, reservado := 0.0, 0.0
			if a, err := q.StockYReservado(ctx, sqlc.StockYReservadoParams{VariantID: r.variante, BranchID: f.OrigenID}); err == nil {
				fisico, reservado = float64(a.Qty), float64(a.Reservado)
			} else if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if disponible := catalogo.Disponible(fisico, reservado); disponible < r.cantidad {
				var nombre string
				_ = tx.QueryRow(ctx, `SELECT p.name || ' ' || v.label FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, r.variante).Scan(&nombre)
				m := nombre + ": en " + origen + " hay " + formato.Cantidad(disponible) + " para mover"
				if reservado > 0 {
					m += " (" + formato.Cantidad(reservado) + " reservado" + plural(reservado) + " para clientes)"
				}
				return plataforma.Invalido(map[string]string{fmt.Sprintf("renglones.%d", i): m + "."})
			}
			fisicos[i] = fisico
		}
		if err := tx.QueryRow(ctx, `INSERT INTO stock_traslados (origen_id, destino_id, nota, created_by_user_id)
			VALUES ($1, $2, $3, $4) RETURNING id, numero`, f.OrigenID, f.DestinoID, notaP, ses.UserID).Scan(&out.ID, &numero); err != nil {
			return err
		}
		out.Codigo = CodigoDeTraslado(numero)
		movimiento := "Traslado " + out.Codigo + " a " + destino
		if nota != "" {
			movimiento += " · " + nota
		}
		for i, r := range renglones {
			if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: r.variante, BranchID: f.OrigenID, Qty: jsmath.Num(Cantidad(fisicos[i] - r.cantidad))}); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO stock_traslado_items (traslado_id, variant_id, cantidad, orden) VALUES ($1, $2, $3::numeric, $4)`,
				out.ID, r.variante, jsmath.Texto(r.cantidad), i); err != nil {
				return err
			}
			if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: r.variante, BranchID: f.OrigenID,
				Type: sqlc.MovementTypeTransferenciaSalida, Qty: jsmath.Num(-r.cantidad), Note: &movimiento, CreatedByUserID: &ses.UserID,
				TransferGroup: &out.ID}); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return TrasladoCreado{}, err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "traslado", out.ID,
		fmt.Sprintf("Mandó el traslado %s de %s a %s (%d medidas)", out.Codigo, origen, destino, len(renglones)),
		map[string]any{"origenId": f.OrigenID, "destinoId": f.DestinoID, "renglones": len(renglones)})
	return out, nil
}

// RecibirTraslado suma al destino lo que llegó. Una sola vez: dos toques a
// la vez no lo suman dos veces.
func (s *Servicio) RecibirTraslado(ctx context.Context, ses *auth.Sesion, id string) error {
	if !plataforma.UUIDValido(id) {
		return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
	}
	var codigo string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		var numero int32
		var destino, origen, estado string
		err := tx.QueryRow(ctx, `SELECT t.numero, t.destino_id, b.name, t.estado FROM stock_traslados t JOIN branches b ON b.id = t.origen_id
			WHERE t.id = $1 FOR UPDATE OF t`, id).Scan(&numero, &destino, &origen, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
		}
		if err != nil {
			return err
		}
		codigo = CodigoDeTraslado(numero)
		if estado != "en-camino" {
			return plataforma.Invalido(map[string]string{"estado": codigo + " ya se recibió."})
		}
		rs, err := tx.Query(ctx, `SELECT variant_id, cantidad::float8 FROM stock_traslado_items WHERE traslado_id = $1 ORDER BY variant_id`, id)
		if err != nil {
			return err
		}
		type item struct {
			variante string
			cantidad float64
		}
		var items []item
		var it item
		if _, err := pgx.ForEachRow(rs, []any{&it.variante, &it.cantidad}, func() error {
			items = append(items, it)
			return nil
		}); err != nil {
			return err
		}
		nota := "Traslado " + codigo + " de " + origen
		for _, x := range items {
			if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: x.variante, Sucursal: destino}); err != nil {
				return err
			}
			if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: x.variante, BranchID: destino, Qty: jsmath.Num(x.cantidad)}); err != nil {
				return err
			}
			if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: x.variante, BranchID: destino,
				Type: sqlc.MovementTypeTransferenciaEntrada, Qty: jsmath.Num(x.cantidad), Note: &nota, CreatedByUserID: &ses.UserID,
				TransferGroup: &id}); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE stock_traslados SET estado = 'recibido', recibido_at = now(), recibido_por_user_id = $2 WHERE id = $1`, id, ses.UserID)
		return err
	})
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "traslado", id, "Recibió el traslado "+codigo, nil)
	return nil
}

// RenglonDeTrasladoVisto es un renglón del comprobante.
type RenglonDeTrasladoVisto struct {
	VariantID string  `json:"variantId"`
	Producto  string  `json:"producto"`
	Medida    string  `json:"medida"`
	SKU       string  `json:"sku"`
	Unidad    string  `json:"unidad"`
	Cantidad  float64 `json:"cantidad"`
}

// Traslado es el comprobante.
type Traslado struct {
	ID          string                   `json:"id"`
	Codigo      string                   `json:"codigo"`
	Origen      string                   `json:"origen"`
	Destino     string                   `json:"destino"`
	Nota        *string                  `json:"nota"`
	Estado      string                   `json:"estado"`
	CreadoPor   *string                  `json:"creadoPor"`
	CreatedAt   time.Time                `json:"createdAt"`
	RecibidoPor *string                  `json:"recibidoPor"`
	RecibidoAt  *time.Time               `json:"recibidoAt"`
	Renglones   []RenglonDeTrasladoVisto `json:"renglones"`
}

const columnasDeTraslado = `t.id, t.numero, o.name, d.name, t.nota, t.estado, uc.name, t.created_at, ur.name, t.recibido_at`
const desdeTraslados = ` FROM stock_traslados t
	JOIN branches o ON o.id = t.origen_id
	JOIN branches d ON d.id = t.destino_id
	LEFT JOIN "user" uc ON uc.id = t.created_by_user_id
	LEFT JOIN "user" ur ON ur.id = t.recibido_por_user_id`

func leerTraslado(r pgx.Row) (Traslado, error) {
	var t Traslado
	var numero int32
	err := r.Scan(&t.ID, &numero, &t.Origen, &t.Destino, &t.Nota, &t.Estado, &t.CreadoPor, &t.CreatedAt, &t.RecibidoPor, &t.RecibidoAt)
	t.Codigo = CodigoDeTraslado(numero)
	t.Renglones = []RenglonDeTrasladoVisto{}
	return t, err
}

// VerTraslado es el comprobante con sus renglones.
func (s *Servicio) VerTraslado(ctx context.Context, id string) (Traslado, error) {
	if !plataforma.UUIDValido(id) {
		return Traslado{}, plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
	}
	t, err := leerTraslado(s.pool.QueryRow(ctx, `SELECT `+columnasDeTraslado+desdeTraslados+` WHERE t.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return t, plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
	}
	if err != nil {
		return t, err
	}
	rs, err := s.pool.Query(ctx, `SELECT v.id, p.name, v.label, v.sku, p.unit::text, it.cantidad::float8
		FROM stock_traslado_items it JOIN product_variants v ON v.id = it.variant_id JOIN products p ON p.id = v.product_id
		WHERE it.traslado_id = $1 ORDER BY it.orden, it.id`, id)
	if err != nil {
		return t, err
	}
	t.Renglones, err = pgx.CollectRows(rs, func(r pgx.CollectableRow) (RenglonDeTrasladoVisto, error) {
		var x RenglonDeTrasladoVisto
		return x, r.Scan(&x.VariantID, &x.Producto, &x.Medida, &x.SKU, &x.Unidad, &x.Cantidad)
	})
	return t, err
}

// TrasladosEnCamino son los que esperan que alguien los reciba, los más
// viejos primero: un traslado que no se recibe es mercadería que no figura
// en ninguna sucursal.
func (s *Servicio) TrasladosEnCamino(ctx context.Context) ([]Traslado, error) {
	rs, err := s.pool.Query(ctx, `SELECT `+columnasDeTraslado+desdeTraslados+` WHERE t.estado = 'en-camino' ORDER BY t.created_at, t.numero LIMIT 50`)
	if err != nil {
		return nil, err
	}
	out := []Traslado{}
	for rs.Next() {
		t, err := leerTraslado(rs)
		if err != nil {
			rs.Close()
			return nil, err
		}
		out = append(out, t)
	}
	rs.Close()
	return out, rs.Err()
}

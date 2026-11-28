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
type RenglonDeTraslado struct {
	VariantID, Cantidad string
	// Faltante: qué pasa con lo que no llegó de esta medida, al recibir
	// (vacío: el de todo el traslado).
	Faltante string
}

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

// Lo que no llegó de un traslado: vuelve al origen (se quedó en el galpón,
// se cargó de más) o se da por perdido (se rompió o se perdió en el viaje).
const (
	FaltanteAlOrigen = "origen"
	FaltantePerdido  = "perdido"
)

// RecepcionDeTraslado es lo que llegó, renglón por renglón (mes simulado,
// M2S4-021): un solo botón daba por llegado todo lo que se mandó, y no había
// cómo anotar 38 de 40 ni que vino otra medida (M3S3-016). Sin renglones,
// llegó todo lo que dice el comprobante.
type RecepcionDeTraslado struct {
	Renglones []RenglonDeTraslado
	Faltante  string
}

// RecibirTraslado suma al destino lo que llegó. Una sola vez: dos toques a
// la vez no lo suman dos veces.
//
// Lo que se mandó y no llegó vuelve al origen o, si se perdió, vuelve y sale
// como faltante: así la baja queda en el libro con su costo (y su asiento)
// en vez de esfumarse. Una medida que llegó y no figuraba (o que llegó de
// más) sale del origen en el acto, con su candado y contra lo disponible.
func (s *Servicio) RecibirTraslado(ctx context.Context, ses *auth.Sesion, id string, rec RecepcionDeTraslado) error {
	if !plataforma.UUIDValido(id) {
		return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
	}
	faltante := rec.Faltante
	if faltante == "" {
		faltante = FaltanteAlOrigen
	}
	if faltante != FaltanteAlOrigen && faltante != FaltantePerdido {
		return plataforma.Invalido(map[string]string{"faltante": "Elegí qué pasa con lo que no llegó."})
	}
	// Lo que llegó, sumado por medida, y qué pasa con lo que no llegó de
	// cada una (mes 23: una sola elección para todas).
	var llegado map[string]float64
	var ordenLlegado []string
	faltantePor := map[string]string{}
	if rec.Renglones != nil {
		if len(rec.Renglones) > MaxRenglonesDeTraslado {
			return plataforma.Invalido(map[string]string{"renglones": fmt.Sprintf("Un traslado lleva hasta %d medidas.", MaxRenglonesDeTraslado)})
		}
		llegado = map[string]float64{}
		for i, r := range rec.Renglones {
			campo := fmt.Sprintf("renglones.%d", i)
			if !plataforma.UUIDValido(r.VariantID) {
				return plataforma.Invalido(map[string]string{campo: "Elegí un producto."})
			}
			c := Cantidad(LeerCantidad(r.Cantidad))
			if math.IsNaN(c) || math.IsInf(c, 0) || c < 0 {
				return plataforma.Invalido(map[string]string{campo: "La cantidad tiene que ser un número."})
			}
			if c > 0 {
				if err := s.revisarCantidad(ctx, r.VariantID, c); err != nil {
					return err
				}
			}
			if r.Faltante != "" {
				if r.Faltante != FaltanteAlOrigen && r.Faltante != FaltantePerdido {
					return plataforma.Invalido(map[string]string{campo: "Elegí qué pasa con lo que no llegó."})
				}
				faltantePor[r.VariantID] = r.Faltante
			}
			if _, ya := llegado[r.VariantID]; !ya {
				ordenLlegado = append(ordenLlegado, r.VariantID)
			}
			llegado[r.VariantID] = Cantidad(llegado[r.VariantID] + c)
		}
	}
	var codigo string
	var diferencias []string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		var numero int32
		var origenID, destino, origen, destinoNombre, estado string
		err := tx.QueryRow(ctx, `SELECT t.numero, t.origen_id, t.destino_id, b.name, d.name, t.estado FROM stock_traslados t
			JOIN branches b ON b.id = t.origen_id JOIN branches d ON d.id = t.destino_id
			WHERE t.id = $1 FOR UPDATE OF t`, id).Scan(&numero, &origenID, &destino, &origen, &destinoNombre, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
		}
		if err != nil {
			return err
		}
		codigo = CodigoDeTraslado(numero)
		switch estado {
		case "recibido":
			return plataforma.Invalido(map[string]string{"estado": codigo + " ya se recibió."})
		case "anulado":
			return plataforma.Invalido(map[string]string{"estado": codigo + " está anulado."})
		}
		mandado, ordenMandado, err := itemsDelTraslado(ctx, tx, id)
		if err != nil {
			return err
		}
		if llegado == nil {
			llegado = mandado
			ordenLlegado = ordenMandado
		}
		// Todas las medidas, las del comprobante primero.
		todas := append([]string{}, ordenMandado...)
		for _, v := range ordenLlegado {
			if _, ok := mandado[v]; !ok {
				todas = append(todas, v)
			}
		}
		// Los candados, en un orden fijo: el destino de lo que llegó y el
		// origen de lo que no coincide.
		var candados []Stock
		for _, v := range todas {
			if llegado[v] > 0 {
				candados = append(candados, Stock{v, destino})
			}
			if Cantidad(mandado[v]-llegado[v]) != 0 {
				candados = append(candados, Stock{v, origenID})
			}
		}
		sort.Slice(candados, func(i, j int) bool {
			if candados[i].Variante != candados[j].Variante {
				return candados[i].Variante < candados[j].Variante
			}
			return candados[i].Sucursal < candados[j].Sucursal
		})
		for _, c := range candados {
			if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: c.Variante, Sucursal: c.Sucursal}); err != nil {
				return err
			}
		}
		entra := "Traslado " + codigo + " de " + origen
		usados := map[string]bool{}
		for i, v := range todas {
			faltante := faltante
			if f, ok := faltantePor[v]; ok {
				faltante = f
			}
			llego, salio := llegado[v], mandado[v]
			diferencia := Cantidad(salio - llego)
			if diferencia < 0 {
				// Llegó de más u otra medida: sale ahora del origen.
				extra := -diferencia
				fisico, reservado := 0.0, 0.0
				if a, err := q.StockYReservado(ctx, sqlc.StockYReservadoParams{VariantID: v, BranchID: origenID}); err == nil {
					fisico, reservado = float64(a.Qty), float64(a.Reservado)
				} else if !errors.Is(err, pgx.ErrNoRows) {
					return err
				}
				if disponible := catalogo.Disponible(fisico, reservado); disponible < extra {
					return plataforma.Invalido(map[string]string{fmt.Sprintf("renglones.%d", i): nombreDeMedida(ctx, tx, v) + ": en " + origen +
						" hay " + formato.Cantidad(disponible) + " para mover. Corregí primero el stock de " + origen + "."})
				}
				if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: v, BranchID: origenID, Qty: jsmath.Num(Cantidad(fisico - extra))}); err != nil {
					return err
				}
				nota := "Traslado " + codigo + " a " + destinoNombre + " · llegó de más"
				if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: v, BranchID: origenID,
					Type: sqlc.MovementTypeTransferenciaSalida, Qty: jsmath.Num(-extra), Note: &nota, CreatedByUserID: &ses.UserID,
					TransferGroup: &id}); err != nil {
					return err
				}
			}
			if diferencia > 0 {
				// No llegó: vuelve al origen, y si se perdió, sale como faltante.
				vuelve := "Traslado " + codigo + ": no llegó, vuelve a " + origen
				if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: v, BranchID: origenID, Qty: jsmath.Num(diferencia)}); err != nil {
					return err
				}
				if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: v, BranchID: origenID,
					Type: sqlc.MovementTypeTransferenciaEntrada, Qty: jsmath.Num(diferencia), Note: &vuelve, CreatedByUserID: &ses.UserID,
					TransferGroup: &id}); err != nil {
					return err
				}
				if faltante == FaltantePerdido {
					var previo float64
					if err := tx.QueryRow(ctx, `SELECT qty::float8 FROM inventory WHERE variant_id = $1 AND branch_id = $2`, v, origenID).Scan(&previo); err != nil {
						return err
					}
					nuevo := Cantidad(previo - diferencia)
					if err := q.FijarCantidad(ctx, sqlc.FijarCantidadParams{VariantID: v, BranchID: origenID, Qty: jsmath.Num(nuevo)}); err != nil {
						return err
					}
					nota := "Faltante desde Stock (" + formato.Cantidad(previo) + " → " + formato.Cantidad(nuevo) + ") · " + codigo
					if _, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id, transfer_group, costo_unitario)
						VALUES ($1, $2, 'egreso', $3::numeric, $4, $5, $6, `+catalogo.CostoDeAjuste("$1")+`)`,
						v, origenID, jsmath.Texto(-diferencia), nota, ses.UserID, id); err != nil {
						return err
					}
				}
				usados[faltante] = true
				que := "vuelve a " + origen
				if faltante == FaltantePerdido {
					que = "se perdió"
				}
				diferencias = append(diferencias, fmt.Sprintf("%s: llegó %s de %s, %s", nombreDeMedida(ctx, tx, v), formato.Cantidad(llego), formato.Cantidad(salio), que))
			} else if diferencia < 0 {
				diferencias = append(diferencias, fmt.Sprintf("%s: llegó %s de %s", nombreDeMedida(ctx, tx, v), formato.Cantidad(llego), formato.Cantidad(salio)))
			}
			if llego > 0 {
				if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: v, BranchID: destino, Qty: jsmath.Num(llego)}); err != nil {
					return err
				}
				if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: v, BranchID: destino,
					Type: sqlc.MovementTypeTransferenciaEntrada, Qty: jsmath.Num(llego), Note: &entra, CreatedByUserID: &ses.UserID,
					TransferGroup: &id}); err != nil {
					return err
				}
			}
			if _, ok := mandado[v]; ok {
				var suyo *string
				if diferencia > 0 {
					suyo = &faltante
				}
				if _, err := tx.Exec(ctx, `UPDATE stock_traslado_items SET recibido = CASE WHEN id = (SELECT id FROM stock_traslado_items
					WHERE traslado_id = $1 AND variant_id = $2 ORDER BY orden, id LIMIT 1) THEN $3::numeric ELSE 0 END, faltante = $4
					WHERE traslado_id = $1 AND variant_id = $2`, id, v, jsmath.Texto(llego), suyo); err != nil {
					return err
				}
			} else if _, err := tx.Exec(ctx, `INSERT INTO stock_traslado_items (traslado_id, variant_id, cantidad, recibido, orden)
				VALUES ($1, $2, 0, $3::numeric, $4)`, id, v, jsmath.Texto(llego), i); err != nil {
				return err
			}
		}
		// El del traslado, si todo lo que faltó fue por el mismo lado; mezclado,
		// lo dice cada renglón.
		var falta *string
		switch {
		case usados[FaltanteAlOrigen] && usados[FaltantePerdido]:
		case usados[FaltantePerdido]:
			p := FaltantePerdido
			falta = &p
		case len(diferencias) > 0:
			o := FaltanteAlOrigen
			falta = &o
		}
		_, err = tx.Exec(ctx, `UPDATE stock_traslados SET estado = 'recibido', recibido_at = now(), recibido_por_user_id = $2, faltante = $3 WHERE id = $1`,
			id, ses.UserID, falta)
		return err
	})
	if err != nil {
		return err
	}
	desc := "Recibió el traslado " + codigo
	if len(diferencias) > 0 {
		desc += " con diferencias: " + strings.Join(diferencias, "; ")
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "traslado", id, desc, nil)
	return nil
}

// AnularTraslado deshace un traslado que todavía no se recibió: todo vuelve
// al origen (M3S3-016, M3S3-022). Se mandó MDF de 3 mm en vez de 18 y la
// única salida era recibirlo y corregir con cuatro ajustes sueltos.
func (s *Servicio) AnularTraslado(ctx context.Context, ses *auth.Sesion, id string) error {
	if !plataforma.UUIDValido(id) {
		return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
	}
	var codigo string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		var numero int32
		var origenID, estado string
		err := tx.QueryRow(ctx, `SELECT numero, origen_id, estado FROM stock_traslados WHERE id = $1 FOR UPDATE`, id).Scan(&numero, &origenID, &estado)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.NuevoProblema(http.StatusNotFound, "No se encontró el traslado.")
		}
		if err != nil {
			return err
		}
		codigo = CodigoDeTraslado(numero)
		switch estado {
		case "recibido":
			return plataforma.Invalido(map[string]string{"estado": codigo + " ya se recibió: corregilo con un traslado de vuelta."})
		case "anulado":
			return plataforma.Invalido(map[string]string{"estado": codigo + " ya está anulado."})
		}
		mandado, orden, err := itemsDelTraslado(ctx, tx, id)
		if err != nil {
			return err
		}
		candados := append([]string{}, orden...)
		sort.Strings(candados)
		for _, v := range candados {
			if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: v, Sucursal: origenID}); err != nil {
				return err
			}
		}
		nota := "Anulación del traslado " + codigo
		for _, v := range orden {
			if mandado[v] <= 0 {
				continue
			}
			if err := q.SumarCantidad(ctx, sqlc.SumarCantidadParams{VariantID: v, BranchID: origenID, Qty: jsmath.Num(mandado[v])}); err != nil {
				return err
			}
			if err := q.RegistrarMovimiento(ctx, sqlc.RegistrarMovimientoParams{VariantID: v, BranchID: origenID,
				Type: sqlc.MovementTypeTransferenciaEntrada, Qty: jsmath.Num(mandado[v]), Note: &nota, CreatedByUserID: &ses.UserID,
				TransferGroup: &id}); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE stock_traslados SET estado = 'anulado', anulado_at = now(), anulado_por_user_id = $2 WHERE id = $1`, id, ses.UserID)
		return err
	})
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "traslado", id, "Anuló el traslado "+codigo, nil)
	return nil
}

// Stock es una medida en una sucursal: la clave de un candado.
type Stock struct{ Variante, Sucursal string }

// itemsDelTraslado es lo que dice el comprobante, sumado por medida y en su
// orden.
func itemsDelTraslado(ctx context.Context, tx pgx.Tx, id string) (map[string]float64, []string, error) {
	rs, err := tx.Query(ctx, `SELECT variant_id, cantidad::float8 FROM stock_traslado_items WHERE traslado_id = $1 ORDER BY orden, id`, id)
	if err != nil {
		return nil, nil, err
	}
	suma := map[string]float64{}
	var orden []string
	var v string
	var c float64
	if _, err := pgx.ForEachRow(rs, []any{&v, &c}, func() error {
		if _, ya := suma[v]; !ya {
			orden = append(orden, v)
		}
		suma[v] = Cantidad(suma[v] + c)
		return nil
	}); err != nil {
		return nil, nil, err
	}
	return suma, orden, nil
}

func nombreDeMedida(ctx context.Context, tx pgx.Tx, variante string) string {
	var nombre string
	_ = tx.QueryRow(ctx, `SELECT p.name || ' ' || v.label FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`, variante).Scan(&nombre)
	return nombre
}

// RenglonDeTrasladoVisto es un renglón del comprobante. Cantidad es lo que
// se mandó (0 si llegó una medida que no figuraba) y Recibido lo que llegó,
// una vez recibido.
type RenglonDeTrasladoVisto struct {
	VariantID string   `json:"variantId"`
	Producto  string   `json:"producto"`
	Medida    string   `json:"medida"`
	SKU       string   `json:"sku"`
	Unidad    string   `json:"unidad"`
	Cantidad  float64  `json:"cantidad"`
	Recibido  *float64 `json:"recibido"`
	// Faltante: qué pasó con lo que no llegó de esta medida.
	Faltante *string `json:"faltante"`
}

// Traslado es el comprobante.
type Traslado struct {
	ID          string                   `json:"id"`
	Codigo      string                   `json:"codigo"`
	OrigenID    string                   `json:"origenId"`
	Origen      string                   `json:"origen"`
	Destino     string                   `json:"destino"`
	Nota        *string                  `json:"nota"`
	Estado      string                   `json:"estado"`
	CreadoPor   *string                  `json:"creadoPor"`
	CreatedAt   time.Time                `json:"createdAt"`
	RecibidoPor *string                  `json:"recibidoPor"`
	RecibidoAt  *time.Time               `json:"recibidoAt"`
	Faltante    *string                  `json:"faltante"`
	AnuladoPor  *string                  `json:"anuladoPor"`
	AnuladoAt   *time.Time               `json:"anuladoAt"`
	Renglones   []RenglonDeTrasladoVisto `json:"renglones"`
}

const columnasDeTraslado = `t.id, t.numero, t.origen_id, o.name, d.name, t.nota, t.estado, uc.name, t.created_at, ur.name, t.recibido_at,
	t.faltante, ua.name, t.anulado_at`
const desdeTraslados = ` FROM stock_traslados t
	JOIN branches o ON o.id = t.origen_id
	JOIN branches d ON d.id = t.destino_id
	LEFT JOIN "user" uc ON uc.id = t.created_by_user_id
	LEFT JOIN "user" ur ON ur.id = t.recibido_por_user_id
	LEFT JOIN "user" ua ON ua.id = t.anulado_por_user_id`

func leerTraslado(r pgx.Row) (Traslado, error) {
	var t Traslado
	var numero int32
	err := r.Scan(&t.ID, &numero, &t.OrigenID, &t.Origen, &t.Destino, &t.Nota, &t.Estado, &t.CreadoPor, &t.CreatedAt, &t.RecibidoPor, &t.RecibidoAt,
		&t.Faltante, &t.AnuladoPor, &t.AnuladoAt)
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
	rs, err := s.pool.Query(ctx, `SELECT v.id, p.name, v.label, v.sku, p.unit::text, it.cantidad::float8, it.recibido::float8, it.faltante
		FROM stock_traslado_items it JOIN product_variants v ON v.id = it.variant_id JOIN products p ON p.id = v.product_id
		WHERE it.traslado_id = $1 ORDER BY it.orden, it.id`, id)
	if err != nil {
		return t, err
	}
	t.Renglones, err = pgx.CollectRows(rs, func(r pgx.CollectableRow) (RenglonDeTrasladoVisto, error) {
		var x RenglonDeTrasladoVisto
		return x, r.Scan(&x.VariantID, &x.Producto, &x.Medida, &x.SKU, &x.Unidad, &x.Cantidad, &x.Recibido, &x.Faltante)
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

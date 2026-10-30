package compras

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/caja"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Los gastos del negocio (lib/dal/admin/gastos.ts). Un gasto en efectivo
// también sale de la caja del turno que lo contiene (caja.TurnoQueContiene,
// la misma regla que una venta sin conexión).

// etiquetaDeCircuito es la de lib/circuito.ts.
func etiquetaDeCircuito(c string) string {
	switch c {
	case "blanco":
		return "Facturas"
	case "negro":
		return "B"
	}
	return c
}

// CargarGasto es cargarGasto + registrarGasto. Devuelve el mensaje y el aviso
// (si era efectivo y no había turno donde cargarlo).
func (s *Servicio) CargarGasto(ctx context.Context, ses *auth.Sesion, m map[string]any) (string, string, error) {
	d, err := leerGasto(m)
	if err != nil {
		return "", "", err
	}
	fecha, ok := LeerFecha(d.Fecha)
	if !ok {
		return "", "", plataforma.Invalido(map[string]string{"fecha": "La fecha no es válida."})
	}
	for _, id := range []*string{d.BranchID, d.SupplierID} {
		if id != nil && !plataforma.UUIDValido(*id) {
			return "", "", fallo("La sucursal o el proveedor no existen.")
		}
	}
	descripcion := trimJS(d.Descripcion)
	sinCaja := false
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var gasto string
		if err := tx.QueryRow(ctx, `
			INSERT INTO expenses (fecha, categoria, descripcion, importe, medio, circuito, branch_id, supplier_id, notas, created_by_user_id)
			VALUES ($1, $2::categoria_gasto, $3, $4::numeric, $5::medio_gasto, $6::circuito, $7, $8, $9, $10) RETURNING id`,
			fecha, d.Categoria, descripcion, jsmath.Fijo2(d.Importe), d.Medio, d.Circuito, d.BranchID, d.SupplierID, d.Notas, ses.UserID).Scan(&gasto); err != nil {
			return err
		}
		// Solo el efectivo toca la caja.
		if d.Medio != "efectivo" || d.BranchID == nil {
			return nil
		}
		turno, momento, hay, err := turnoDelGasto(ctx, tx, *d.BranchID, d.Fecha, time.Now())
		if err != nil {
			return err
		}
		if !hay {
			sinCaja = true
			return nil
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO cash_movements (session_id, tipo, monto, motivo, expense_id, creado_por, created_at)
			VALUES ($1, 'gasto', $2::numeric, $3, $4, $5, $6)`, turno, jsmath.Fijo2(-d.Importe), descripcion, gasto, ses.UserID, momento)
		return err
	})
	if err != nil {
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "gasto", "",
		"Anotó un gasto de "+Monto(d.Importe)+" en "+d.Categoria+" ("+etiquetaDeCircuito(d.Circuito)+"): "+d.Descripcion, nil)
	aviso := ""
	if sinCaja {
		aviso = "No había caja abierta en ese momento, así que no salió del turno. La plata igual se fue: el arqueo va a mostrar la diferencia."
	}
	return "Gasto anotado por " + Monto(d.Importe) + ".", aviso, nil
}

// turnoDelGasto es el turno de la sucursal del que sale un gasto en efectivo
// del día `dia` (aaaa-mm-dd, un día argentino), y el momento en que se anota
// el movimiento de caja.
//
// Bug arreglado: el turno se buscaba con la fecha del formulario, que es la
// medianoche UTC (las 21 del día anterior en Argentina). Un gasto de hoy
// nunca caía en el turno abierto a la mañana, no salía de la caja y el
// arqueo mostraba un faltante. Ahora, si el día es hoy, sale del turno que
// está abierto ahora; si es otro día, del último turno que estuvo abierto
// en algún momento de ese día argentino.
func turnoDelGasto(ctx context.Context, tx pgx.Tx, sucursal, dia string, ahora time.Time) (string, time.Time, bool, error) {
	d, err := time.ParseInLocation("2006-01-02", dia, caja.Argentina)
	if err != nil {
		// Vino con hora (un instante): se busca el turno de ese instante.
		f, ok := LeerFecha(dia)
		if !ok {
			return "", time.Time{}, false, nil
		}
		id, hay, err := caja.TurnoQueContiene(ctx, tx, sucursal, f)
		return id, f, hay, err
	}
	if d.Equal(caja.InicioDelDia(ahora)) {
		id, hay, err := caja.TurnoQueContiene(ctx, tx, sucursal, ahora)
		return id, ahora, hay, err
	}
	fin := d.AddDate(0, 0, 1)
	var id string
	var abierta time.Time
	err = tx.QueryRow(ctx, `
		SELECT id, abierta_at FROM cash_sessions
		WHERE branch_id = $1 AND abierta_at < $3 AND (cerrada_at IS NULL OR cerrada_at >= $2)
		ORDER BY abierta_at DESC LIMIT 1`, sucursal, d, fin).Scan(&id, &abierta)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", time.Time{}, false, nil
	}
	if err != nil {
		return "", time.Time{}, false, err
	}
	// El movimiento se fecha adentro del turno y del día.
	momento := d
	if abierta.After(momento) {
		momento = abierta
	}
	return id, momento, true, nil
}

// Gasto es una fila del listado.
type Gasto struct {
	ID          string    `json:"id"`
	Fecha       time.Time `json:"fecha"`
	Categoria   string    `json:"categoria"`
	Descripcion string    `json:"descripcion"`
	Importe     string    `json:"importe"`
	Medio       string    `json:"medio"`
	Circuito    string    `json:"circuito"`
	ConFactura  bool      `json:"conFactura"`
	Sucursal    *string   `json:"sucursal"`
	Proveedor   *string   `json:"proveedor"`
	SupplierID  *string   `json:"supplierId"`
	Notas       *string   `json:"notas"`
	EnCaja      bool      `json:"enCaja"`
}

// ListarGastos es listarGastos: los del período, los más nuevos primero.
func (s *Servicio) ListarGastos(ctx context.Context, desde, hasta time.Time, limite int) ([]Gasto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT e.id, e.fecha, e.categoria::text, e.descripcion, e.importe::text, e.medio::text, e.circuito::text, e.purchase_invoice_id IS NOT NULL,
		  b.name, s.nombre, e.supplier_id, e.notas, EXISTS (SELECT 1 FROM cash_movements m WHERE m.expense_id = e.id)
		FROM expenses e LEFT JOIN branches b ON b.id = e.branch_id LEFT JOIN suppliers s ON s.id = e.supplier_id
		WHERE e.fecha >= $1 AND e.fecha <= $2 ORDER BY e.fecha DESC LIMIT $3`, desde, hasta, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[Gasto])
}

// TotalDeGastos es cuánto se gastó en una categoría o un circuito.
type TotalDeGastos struct {
	Clave    string `json:"clave"`
	Cantidad int    `json:"cantidad"`
	Total    string `json:"total"`
}

// GastosPorCategoria es gastosPorCategoria (lo más gastado primero).
func (s *Servicio) GastosPorCategoria(ctx context.Context, desde, hasta time.Time) ([]TotalDeGastos, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT categoria::text, count(*)::int, sum(importe)::text FROM expenses WHERE fecha >= $1 AND fecha <= $2
		GROUP BY categoria ORDER BY sum(importe) DESC`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[TotalDeGastos])
}

// GastosPorCircuito es gastosPorCircuito.
func (s *Servicio) GastosPorCircuito(ctx context.Context, desde, hasta time.Time) ([]TotalDeGastos, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT circuito::text, count(*)::int, sum(importe)::text FROM expenses WHERE fecha >= $1 AND fecha <= $2 GROUP BY circuito`, desde, hasta)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[TotalDeGastos])
}

// SucursalParaGasto es una sucursal activa con su turno abierto, si hay.
type SucursalParaGasto struct {
	ID           string  `json:"id"`
	Nombre       string  `json:"nombre"`
	TurnoAbierto *string `json:"turnoAbierto"`
}

// SucursalesParaGasto es sucursalesParaGasto.
func (s *Servicio) SucursalesParaGasto(ctx context.Context) ([]SucursalParaGasto, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT b.id, b.name, c.id FROM branches b
		LEFT JOIN cash_sessions c ON c.branch_id = b.id AND c.estado = 'abierta'
		WHERE b.active ORDER BY b.sort_order`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(filas, pgx.RowToStructByPos[SucursalParaGasto])
}

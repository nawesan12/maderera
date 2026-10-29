package migracion

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/sqlc"
)

// Servicio son las corridas de migración contra la base.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

// Corrida es una corrida del historial.
type Corrida struct {
	ID           string     `json:"id"`
	Entidad      string     `json:"entidad"`
	Archivo      string     `json:"archivo"`
	Estado       string     `json:"estado"`
	FilasTotales int        `json:"filasTotales"`
	Creados      int        `json:"creados"`
	Actualizados int        `json:"actualizados"`
	Omitidos     int        `json:"omitidos"`
	ConError     int        `json:"conError"`
	Rechazos     []Rechazo  `json:"rechazos"`
	CreatedAt    time.Time  `json:"createdAt"`
	FinishedAt   *time.Time `json:"finishedAt"`
}

// Historial son las últimas corridas: qué se migró y qué quedó afuera.
func (s *Servicio) Historial(ctx context.Context, limite int) ([]Corrida, error) {
	rows, err := s.pool.Query(ctx, `SELECT id::text, entidad::text, archivo, estado::text, filas_totales, creados, actualizados,
		omitidos, con_error, rechazos, created_at, finished_at FROM migration_runs ORDER BY created_at DESC LIMIT $1`, limite)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Corrida, error) {
		var c Corrida
		var rechazos []byte
		err := r.Scan(&c.ID, &c.Entidad, &c.Archivo, &c.Estado, &c.FilasTotales, &c.Creados, &c.Actualizados, &c.Omitidos,
			&c.ConError, &rechazos, &c.CreatedAt, &c.FinishedAt)
		if err == nil {
			_ = json.Unmarshal(rechazos, &c.Rechazos)
		}
		if c.Rechazos == nil {
			c.Rechazos = []Rechazo{}
		}
		return c, err
	})
}

// Estado es lo que ya hay cargado, para contestar «¿esto ya lo corrí?» sin
// abrir el historial.
type Estado struct {
	Clientes         int `json:"clientes"`
	ClientesMigrados int `json:"clientesMigrados"`
	Medidas          int `json:"medidas"`
	ConExistencia    int `json:"conExistencia"`
	SaldosMigrados   int `json:"saldosMigrados"`
}

// EstadoDelSistema cuenta lo cargado.
func (s *Servicio) EstadoDelSistema(ctx context.Context) (Estado, error) {
	var e Estado
	err := s.pool.QueryRow(ctx, `SELECT
		(SELECT count(*)::int FROM customers),
		(SELECT count(*)::int FROM customers WHERE codigo_legacy IS NOT NULL),
		(SELECT count(*)::int FROM product_variants),
		(SELECT count(*)::int FROM inventory WHERE qty > 0),
		(SELECT count(*)::int FROM account_movements WHERE referencia = $1)`, ReferenciaSaldo).
		Scan(&e.Clientes, &e.ClientesMigrados, &e.Medidas, &e.ConExistencia, &e.SaldosMigrados)
	return e, err
}

// PedidoDeCorrida abre una corrida.
type PedidoDeCorrida struct {
	Entidad      string
	Archivo      string
	Codificacion string
	Mapeo        Mapeo
	FilasTotales int
}

// Iniciar abre la corrida: cada lote se suma sobre esta fila.
func (s *Servicio) Iniciar(ctx context.Context, ses *auth.Sesion, p PedidoDeCorrida) (string, error) {
	mapeo, err := json.Marshal(p.Mapeo)
	if err != nil {
		return "", err
	}
	var id string
	err = s.pool.QueryRow(ctx, `INSERT INTO migration_runs (entidad, archivo, codificacion, mapeo, filas_totales, created_by_user_id)
		VALUES ($1::entidad_migracion, $2, $3, $4::jsonb, $5, $6) RETURNING id::text`,
		p.Entidad, p.Archivo, p.Codificacion, mapeo, p.FilasTotales, ses.UserID).Scan(&id)
	return id, err
}

// LoteAplicado es lo que contesta un lote (o el error, dicho para mostrar).
type LoteAplicado struct {
	Error string `json:"error,omitempty"`
	*Resultado
}

// Lote aplica un lote y lo suma a la corrida. Los contadores se suman en la
// base con `+`: si el navegador se cierra a la mitad, lo escrito sigue
// siendo cierto.
func (s *Servicio) Lote(ctx context.Context, ses *auth.Sesion, corrida string, e Entidad, m Mapeo, filas [][]string) (LoteAplicado, error) {
	if len(Faltantes(e, m)) > 0 {
		return LoteAplicado{Error: "Faltan emparejar columnas. Fijate las que están marcadas con *."}, nil
	}
	res, err := AplicarLote(ctx, s.pool, e.Clave, NormalizarFilas(e, m, filas), Opciones{LoteID: corrida, UserID: ses.UserID})
	if err != nil {
		if ctx.Err() != nil {
			return LoteAplicado{}, err
		}
		s.log.Warn("migración: un lote no se pudo aplicar", "corrida", corrida, "entidad", e.Clave, "error", err)
		if _, e2 := s.pool.Exec(ctx, `UPDATE migration_runs SET estado = 'interrumpida', finished_at = now() WHERE id = $1`, corrida); e2 != nil {
			return LoteAplicado{}, e2
		}
		return LoteAplicado{Error: "El lote no se pudo aplicar y se dejó sin efecto: " + motivo(err)}, nil
	}
	rechazos, _ := json.Marshal(res.Rechazos)
	if _, err := s.pool.Exec(ctx, `UPDATE migration_runs SET creados = creados + $2, actualizados = actualizados + $3,
		omitidos = omitidos + $4, con_error = con_error + $5, rechazos = rechazos || $6::jsonb WHERE id = $1`,
		corrida, res.Creados, res.Actualizados, res.Omitidos, res.ConError, rechazos); err != nil {
		return LoteAplicado{}, err
	}
	return LoteAplicado{Resultado: &res}, nil
}

// Cerrar cierra la corrida y contrasta el archivo contra lo que quedó en la
// base. Se anota en la bitácora al cerrar y no lote por lote.
func (s *Servicio) Cerrar(ctx context.Context, ses *auth.Sesion, corrida string, e Entidad, m Mapeo, filas [][]string) ([]Control, error) {
	if _, err := s.pool.Exec(ctx, `UPDATE migration_runs SET estado = 'completada', finished_at = now() WHERE id = $1`, corrida); err != nil {
		return nil, err
	}
	base, err := s.enLaBase(ctx, e.Clave)
	if err != nil {
		return nil, err
	}
	controles := Controles(e.Clave, NormalizarFilas(e, m, filas), base)

	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaImportar, "migracion", corrida,
		"Cerró una corrida de migración de "+e.Clave, struct {
			RunID   string `json:"runId"`
			Entidad string `json:"entidad"`
			Filas   int    `json:"filas"`
		}{corrida, e.Clave, len(filas)})
	return controles, nil
}

// enLaBase es lo que el informe de cada entidad le pregunta a la base.
func (s *Servicio) enLaBase(ctx context.Context, entidad string) (EnLaBase, error) {
	var b EnLaBase
	var err error
	switch entidad {
	case "saldos":
		err = s.pool.QueryRow(ctx, `SELECT coalesce(sum(monto), 0)::text, count(*)::int FROM account_movements WHERE referencia = $1`,
			ReferenciaSaldo).Scan(&b.Total, &b.Cuantos)
	case "clientes":
		err = s.pool.QueryRow(ctx, `SELECT count(*)::int FROM customers WHERE codigo_legacy IS NOT NULL`).Scan(&b.Cuantos)
	case "proveedores":
		err = s.pool.QueryRow(ctx, `SELECT (SELECT count(*)::int FROM suppliers WHERE codigo_legacy IS NOT NULL),
			(SELECT coalesce(sum(monto), 0)::text FROM supplier_movements WHERE referencia = $1)`, ReferenciaSaldoProveedor).
			Scan(&b.Fichas, &b.Total)
	case "ventas_historicas":
		err = s.pool.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(total), 0)::text FROM historical_sales`).Scan(&b.Cuantos, &b.Total)
	case "comprobantes_historicos":
		err = s.pool.QueryRow(ctx, `SELECT count(*)::int, coalesce(sum(total), 0)::text FROM historical_invoices`).Scan(&b.Cuantos, &b.Total)
	case "productos":
		err = s.pool.QueryRow(ctx, `SELECT count(*)::int FROM product_variants`).Scan(&b.Cuantos)
	default:
		err = s.pool.QueryRow(ctx, `SELECT coalesce(sum(qty), 0)::float8 FROM inventory`).Scan(&b.TotalStock)
	}
	return b, err
}

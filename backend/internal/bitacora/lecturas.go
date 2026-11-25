package bitacora

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Linea es un renglón de la bitácora.
type Linea struct {
	ID            string    `json:"id"`
	UsuarioID     *string   `json:"usuarioId"`
	UsuarioNombre string    `json:"usuarioNombre"`
	UsuarioRol    *string   `json:"usuarioRol"`
	Accion        string    `json:"accion"`
	Entidad       string    `json:"entidad"`
	EntidadID     *string   `json:"entidadId"`
	Descripcion   string    `json:"descripcion"`
	Detalle       *string   `json:"detalle"`
	CreatedAt     time.Time `json:"createdAt"`
}

// Filtro es el de /admin/bitacora.
type Filtro struct {
	Entidad, Accion, UsuarioID, Buscar string
	Dias, Limite, Desplazamiento       int
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

// DesdeHaceDias es la medianoche argentina de hace `dias` días. El TS la
// calculaba con la hora del servidor (UTC): «hoy» empezaba a las 21 del día
// anterior.
func DesdeHaceDias(dias int, ahora time.Time) time.Time {
	a := ahora.In(argentina).AddDate(0, 0, -dias)
	return time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, argentina)
}

// Listar es listarBitacora: lo más nuevo primero, de a 60 (hasta 200), con
// el total para paginar.
func Listar(ctx context.Context, pool *pgxpool.Pool, f Filtro, ahora time.Time) ([]Linea, int, error) {
	var cond []string
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if f.Entidad != "" {
		cond = append(cond, "entidad = "+arg(f.Entidad))
	}
	if f.Accion != "" {
		cond = append(cond, "accion::text = "+arg(f.Accion))
	}
	if f.UsuarioID != "" {
		cond = append(cond, "usuario_id = "+arg(f.UsuarioID))
	}
	if f.Dias > 0 {
		cond = append(cond, "created_at >= "+arg(DesdeHaceDias(f.Dias, ahora)))
	}
	if b := strings.TrimSpace(f.Buscar); b != "" {
		p := arg("%" + b + "%")
		cond = append(cond, "(descripcion ILIKE "+p+" OR usuario_nombre ILIKE "+p+")")
	}
	donde := ""
	if len(cond) > 0 {
		donde = " WHERE " + strings.Join(cond, " AND ")
	}
	var total int
	if err := pool.QueryRow(ctx, "SELECT count(*)::int FROM audit_log"+donde, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	limite := f.Limite
	if limite <= 0 {
		limite = 60
	}
	limite = min(limite, 200)
	filas, err := pool.Query(ctx, `SELECT id, usuario_id, usuario_nombre, usuario_rol, accion::text, entidad, entidad_id, descripcion, detalle, created_at
		FROM audit_log`+donde+` ORDER BY created_at DESC LIMIT `+arg(limite)+` OFFSET `+arg(max(f.Desplazamiento, 0)), args...)
	if err != nil {
		return nil, 0, err
	}
	out, err := pgx.CollectRows(filas, pgx.RowToStructByPos[Linea])
	return out, total, err
}

// Persona es alguien que figura en la bitácora.
type Persona struct {
	UsuarioID     string `json:"usuarioId"`
	UsuarioNombre string `json:"usuarioNombre"`
}

// Opciones es opcionesDeBitacora: las entidades y las personas que
// aparecen, para los filtros.
func Opciones(ctx context.Context, pool *pgxpool.Pool) ([]string, []Persona, error) {
	filas, err := pool.Query(ctx, `SELECT DISTINCT entidad FROM audit_log ORDER BY entidad`)
	if err != nil {
		return nil, nil, err
	}
	entidades, err := pgx.CollectRows(filas, pgx.RowTo[string])
	if err != nil {
		return nil, nil, err
	}
	filas, err = pool.Query(ctx, `SELECT DISTINCT usuario_id, usuario_nombre FROM audit_log
		WHERE usuario_id IS NOT NULL AND usuario_id <> '' ORDER BY usuario_nombre`)
	if err != nil {
		return nil, nil, err
	}
	personas, err := pgx.CollectRows(filas, pgx.RowToStructByPos[Persona])
	return entidades, personas, err
}

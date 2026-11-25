// Package bitacora anota qué hizo cada quien en el panel: registrarEnBitacora
// del TS, en la misma tabla (audit_log). Se lee desde /admin/bitacora.
//
// **Anotar nunca hace fallar la acción**: si la bitácora no se puede escribir,
// se registra en el log y la acción sigue (un banner que no se guarda porque
// la bitácora falló es peor que un banner sin anotar).
package bitacora

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"unicode/utf8"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// Accion es el enum accion_auditoria.
type Accion = sqlc.AccionAuditoria

// Anotar escribe una línea. `q` puede ser el de una transacción (q.WithTx):
// entonces la línea existe solo si la acción se confirmó.
func Anotar(ctx context.Context, q *sqlc.Queries, log *slog.Logger, ses *auth.Sesion, accion Accion, entidad, entidadID, descripcion string, detalle any) {
	var rol *string
	if ses.RolStaff != nil {
		r := string(*ses.RolStaff)
		rol = &r
	}
	var det *string
	if detalle != nil {
		// Sin escapar < > &, como JSON.stringify: la bitácora queda escrita
		// igual que la que dejaba el TS.
		var b strings.Builder
		enc := json.NewEncoder(&b)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(detalle); err == nil {
			d := recortar(strings.TrimSuffix(b.String(), "\n"), 4000)
			det = &d
		}
	}
	var id *string
	if entidadID != "" {
		id = &entidadID
	}
	correo := ses.Correo
	if err := q.AnotarEnBitacora(ctx, sqlc.AnotarEnBitacoraParams{
		UsuarioID: &ses.UserID, UsuarioNombre: ses.Nombre, UsuarioEmail: &correo, UsuarioRol: rol,
		Accion: accion, Entidad: entidad, EntidadID: id, Descripcion: recortar(descripcion, 500), Detalle: det,
	}); err != nil {
		log.Error("bitácora: no se pudo anotar", "accion", accion, "entidad", entidad, "error", err)
	}
}

// recortar corta en caracteres, como String.slice del TS en el texto común
// (sin partir una letra por la mitad).
func recortar(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

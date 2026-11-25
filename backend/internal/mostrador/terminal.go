package mostrador

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Desvincular suelta la caja física de la PC que la tenía (comité final,
// carril F). El vínculo es el secreto que la máquina guardó al vincular: se
// cambia por otro, así el latido de esa PC deja de reconocerse (y la PC
// vuelve a pedir que se la vincule, ver `cajaVigente` en el latido) y la caja
// queda libre para otra máquina. La caja no se da de baja: sigue en la lista
// para vincular, con su código y sus tickets viejos.
//
// Con ventas sin subir no se suelta, por la misma razón que no se da de baja
// (caja/panel.go, DarDeBajaCaja): esa plata está en el cajón y el cierre del
// turno la cuenta por los pendientes que manda la máquina con su secreto.
// Los del último latido pueden estar viejos (la PC cobró sin conexión y
// todavía no latió): por eso cuentan también los que la PC informa de su
// cola local, `locales`. El botón solo existe en la misma PC y en línea. La
// bitácora guarda el último latido y los pendientes que se borran, para que
// quede el rastro de cómo estaba la PC.
func (s *Servicio) Desvincular(ctx context.Context, ses *auth.Sesion, id string, locales int) (string, error) {
	if !plataforma.UUIDValido(id) {
		return "", rechazo("Esa terminal no existe.")
	}
	crudo := make([]byte, 24)
	if _, err := rand.Read(crudo); err != nil {
		return "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var codigo string
	var pendientes int
	var ultima *time.Time
	err = tx.QueryRow(ctx, `SELECT codigo, pendientes, ultima_vez_at FROM pos_devices WHERE id = $1 FOR UPDATE`, id).Scan(&codigo, &pendientes, &ultima)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", rechazo("Esa terminal no existe.")
	}
	if err != nil {
		return "", err
	}
	if locales > pendientes {
		pendientes = locales
	}
	if pendientes > 0 {
		ventas, verbo := "ventas cobradas", "subieron"
		if pendientes == 1 {
			ventas, verbo = "venta cobrada", "subió"
		}
		return "", rechazo(fmt.Sprintf("%s tiene %d %s que todavía no %s. Esperá a que suban antes de desvincularla.", codigo, pendientes, ventas, verbo))
	}
	if _, err := tx.Exec(ctx, `UPDATE pos_devices SET secreto = $2, ultima_vez_at = NULL, pendientes = 0 WHERE id = $1`,
		id, base64.RawURLEncoding.EncodeToString(crudo)); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	var latido any
	if ultima != nil {
		latido = ultima.UTC().Format(time.RFC3339)
	}
	s.anotar(ctx, ses, sqlc.AccionAuditoriaCambiarEstado, "caja", id, "Desvinculó la terminal "+codigo,
		map[string]any{"ultimoLatido": latido, "pendientes": pendientes})
	return "Esta PC ya no es " + codigo + ".", nil
}

package cola

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
)

// Despertador escucha los avisos de trabajo nuevo (el trigger de
// `trabajos`, canal mjbj_cola) y los pasa por el canal que devuelve, sin
// bloquear: varios avisos seguidos despiertan una sola vez. Si la conexión
// se cae, reintenta con espera creciente; mientras tanto el worker sigue con
// su vuelta de siempre, así que nada se pierde, solo se demora.
func Despertador(ctx context.Context, url string, log *slog.Logger) <-chan struct{} {
	despertar := make(chan struct{}, 1)
	go func() {
		espera := time.Second
		for ctx.Err() == nil {
			err := escucharTrabajos(ctx, url, despertar)
			if ctx.Err() != nil {
				return
			}
			log.Warn("cola: se cortó la escucha de trabajos nuevos", "error", err, "reintento", espera)
			select {
			case <-ctx.Done():
				return
			case <-time.After(espera):
			}
			espera = min(espera*2, 30*time.Second)
		}
	}()
	return despertar
}

func escucharTrabajos(ctx context.Context, url string, despertar chan<- struct{}) error {
	conn, err := pgx.Connect(ctx, url)
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())
	if _, err := conn.Exec(ctx, "LISTEN mjbj_cola"); err != nil {
		return err
	}
	for {
		if _, err := conn.WaitForNotification(ctx); err != nil {
			return err
		}
		select {
		case despertar <- struct{}{}:
		default:
		}
	}
}

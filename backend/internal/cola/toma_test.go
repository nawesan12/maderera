package cola

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

// Un trabajo que se pasó de su toma y otro proceso retomó no lo cierra quien
// lo tenía antes: si no, quedaba «hecho» mientras el segundo seguía, y un
// fallo del primero lo devolvía a la cola para una tercera vuelta.
func TestSoloQuienLoTomoLoCierra(t *testing.T) {
	pool := pruebas.Base(t)
	q := sqlc.New(pool)
	ctx := context.Background()
	if _, err := Encolar(ctx, q, "prueba.lento", map[string]int{}, time.Time{}); err != nil {
		t.Fatal(err)
	}
	c := Nueva(q, silencio)
	c.Registrar("prueba.lento", func(ctx context.Context, _ json.RawMessage) error {
		// Mientras corre se le vence la toma y otro proceso lo retoma.
		if _, err := pool.Exec(ctx, `update trabajos set tomado_hasta = now() - interval '1 second' where tipo = 'prueba.lento'`); err != nil {
			return err
		}
		if _, err := q.TomarTrabajo(ctx, []string{"prueba.lento"}); err != nil {
			return err
		}
		return nil
	})
	if _, err := c.Procesar(ctx, 1); err != nil {
		t.Fatal(err)
	}
	var estado string
	var intentos int
	if err := pool.QueryRow(ctx, `select estado::text, intentos from trabajos where tipo = 'prueba.lento'`).Scan(&estado, &intentos); err != nil {
		t.Fatal(err)
	}
	if estado != "procesando" || intentos != 2 {
		t.Fatalf("el primero cerró el trabajo del segundo: %s, %d intentos", estado, intentos)
	}
}

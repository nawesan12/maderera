// Package revalidar le avisa a Next que algo cambió, para que vuelva a armar
// las páginas cacheadas que lo muestran.
//
// Cuando un cambio lo hace una server action de Next, ella misma llama a
// revalidatePath/updateTag. Pero hay cambios que Go hace por su cuenta —un
// webhook de pago, una tarea programada, el mostrador offline— y Next no se
// entera. Para esos, Go encola un trabajo `next.revalidar` **en la misma
// transacción del cambio** (si el cambio se deshace, el aviso también), y el
// worker se lo manda a Next por /api/interno/revalidar.
package revalidar

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"mjbj/internal/cola"
	"mjbj/internal/sqlc"
)

// Tipo es el nombre del trabajo en la cola.
const Tipo = "next.revalidar"

// Aviso es qué hay que volver a armar: etiquetas de caché (las de
// lib/cache-publico.ts: catalogo, contenido, eventos…) y rutas.
type Aviso struct {
	Etiquetas []string `json:"etiquetas,omitempty"`
	Rutas     []string `json:"rutas,omitempty"`
}

// Encolar deja el aviso en la cola. Pasale el sqlc de la transacción del
// cambio (q.WithTx(tx)).
func Encolar(ctx context.Context, q *sqlc.Queries, a Aviso) error {
	_, err := cola.Encolar(ctx, q, Tipo, a, time.Time{})
	return err
}

// Config es dónde está Next y con qué secreto se le habla.
type Config struct {
	URL     string `env:"NEXT_URL" envDefault:"http://app:3000"`
	Secreto string `env:"REVALIDAR_SECRETO,required"`
}

// Manejador es el que hace el trabajo: un POST a Next.
func Manejador(cfg Config) cola.Manejador {
	cliente := &http.Client{Timeout: 15 * time.Second}
	return func(ctx context.Context, carga json.RawMessage) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.URL+"/api/interno/revalidar", bytes.NewReader(carga))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+cfg.Secreto)
		r, err := cliente.Do(req)
		if err != nil {
			return fmt.Errorf("Next no respondió: %w", err)
		}
		defer r.Body.Close()
		if r.StatusCode != http.StatusOK {
			cuerpo, _ := io.ReadAll(io.LimitReader(r.Body, 300))
			return fmt.Errorf("Next contestó %d: %s", r.StatusCode, cuerpo)
		}
		return nil
	}
}

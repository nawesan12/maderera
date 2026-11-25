package catalogo

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BenchmarkListado mide el listado completo contra una base con datos
// (MJBJ_BENCH_BASE, la del benchmark de la tanda 2).
func BenchmarkListado(b *testing.B) {
	url := os.Getenv("MJBJ_BENCH_BASE")
	if url == "" {
		b.Skip("sin MJBJ_BENCH_BASE")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		b.Fatal(err)
	}
	defer pool.Close()
	s := Nuevo(pool)
	ctx := context.Background()
	l, _ := s.General(ctx)
	b.ResetTimer()
	for b.Loop() {
		if _, err := s.Productos(ctx, Filtros{}, l); err != nil {
			b.Fatal(err)
		}
	}
}

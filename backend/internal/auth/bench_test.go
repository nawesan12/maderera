package auth

import (
	"context"
	"fmt"
	"net/http/httptest"
	"testing"

	"mjbj/internal/pruebas"
)

// El benchmark de la tanda 1 (bench/tanda1): entrar con clave, en el
// proceso, con N a la vez. Casi todo el tiempo es scrypt.
//
//	MJBJ_PRUEBA_BASE=… go test -run '^$' -bench Entrar ./internal/auth/
func BenchmarkEntrar(b *testing.B) {
	pool := pruebas.Base(b)
	s := Nuevo(Config{Secreto: "secreto-de-benchmark-mjbj-con-32-caracteres-o-mas", URL: "http://localhost"}, pool)
	if _, err := s.Registrar(context.Background(), httptest.NewRecorder(), Alta{Nombre: "Bench", Correo: "bench@prueba.test", Clave: "clave de benchmark"}, "", ""); err != nil {
		b.Fatal(err)
	}
	// Con el tope de producción (2 a la vez, la VPS tiene 2 núcleos) y con 4,
	// que es lo que usa Node (el pool de libuv) para comparar en igualdad.
	for _, tope := range []int{2, 4} {
		b.Run(fmt.Sprintf("tope=%d", tope), func(b *testing.B) {
			turnoScrypt = make(chan struct{}, tope)
			b.SetParallelism(1) // GOMAXPROCS goroutines entrando a la vez
			b.ResetTimer()
			b.RunParallel(func(pb *testing.PB) {
				for pb.Next() {
					if _, err := s.Entrar(context.Background(), httptest.NewRecorder(), "bench@prueba.test", "clave de benchmark", "", "", true); err != nil {
						b.Error(err)
						return
					}
				}
			})
			b.ReportMetric(float64(b.N)/b.Elapsed().Seconds(), "entradas/s")
		})
	}
	turnoScrypt = make(chan struct{}, 2)
}

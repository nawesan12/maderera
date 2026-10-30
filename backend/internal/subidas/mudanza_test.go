package subidas_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"mjbj/internal/pruebas"
	"mjbj/internal/subidas"
)

// Los comprobantes y documentos subidos cuando iban a /subidas/ pasan a la
// carpeta privada, la base apunta a la referencia nueva, y una segunda
// corrida no hace nada.
func TestMudarAPrivado(t *testing.T) {
	pool := pruebas.Base(t)
	ctx := context.Background()
	publica, privada := t.TempDir(), t.TempDir()
	d := subidas.Nuevo(subidas.Config{Carpeta: publica, CarpetaPrivada: privada})
	for _, n := range []string{"comprobante-1.pdf", "tecnica-1.pdf", "producto-1.png"} {
		if err := os.WriteFile(filepath.Join(publica, n), []byte(n), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `insert into payments (tipo, proveedor, medio, monto, estado, comprobante_url)
		values ('pedido', 'transferencia', 'transferencia', 100, 'en_revision', '/subidas/comprobante-1.pdf')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into technical_documents (titulo, categoria, url, formato, solo_profesionales)
		values ('Tabla', 'general', '/subidas/tecnica-1.pdf', 'pdf', true), ('Perdido', 'general', '/subidas/tecnica-que-no-esta.pdf', 'pdf', false)`); err != nil {
		t.Fatal(err)
	}

	m, err := d.MudarAPrivado(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if m.Movidos != 2 || len(m.Fallas) != 1 || !strings.Contains(m.Fallas[0], "tecnica-que-no-esta") {
		t.Fatalf("%+v", m)
	}
	for _, n := range []string{"comprobante-1.pdf", "tecnica-1.pdf"} {
		if _, err := os.Stat(filepath.Join(publica, n)); !os.IsNotExist(err) {
			t.Errorf("%s sigue en la carpeta pública", n)
		}
		if datos, _ := d.LeerGuardado(subidas.PrefijoPrivado + n); string(datos) != n {
			t.Errorf("%s no está en la privada", n)
		}
	}
	if _, err := os.Stat(filepath.Join(publica, "producto-1.png")); err != nil {
		t.Error("movió una foto de producto, que es pública")
	}
	var ref string
	if err := pool.QueryRow(ctx, `select comprobante_url from payments`).Scan(&ref); err != nil || ref != "privado:comprobante-1.pdf" {
		t.Fatalf("la base quedó con %q %v", ref, err)
	}

	if m, err := d.MudarAPrivado(ctx, pool); err != nil || m.Movidos != 0 {
		t.Fatalf("la segunda corrida: %+v %v", m, err)
	}
}

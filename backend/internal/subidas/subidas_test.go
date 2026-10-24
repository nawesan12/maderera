package subidas

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImagenes(t *testing.T) {
	d := Nuevo(Config{Carpeta: t.TempDir()})
	png := append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a}, make([]byte, 100)...)
	url, err := d.GuardarImagen(png, "image/png", "producto")
	if err != nil || !strings.HasPrefix(url, "/subidas/producto-") || !strings.HasSuffix(url, ".png") {
		t.Fatalf("png: %q %v", url, err)
	}
	if _, err := os.Stat(filepath.Join(d.carpeta, strings.TrimPrefix(url, "/subidas/"))); err != nil {
		t.Fatal("no quedó en disco")
	}
	casos := map[string]struct {
		datos []byte
		tipo  string
		msg   string
	}{
		"vacía":            {nil, "image/png", "El archivo está vacío."},
		"tipo no aceptado": {png, "image/gif", "Subí una imagen en JPG, PNG, WebP o AVIF."},
		"disfrazada":       {[]byte("MZ\x90\x00 un ejecutable"), "image/jpeg", "El archivo no parece ser una imagen válida."},
		"pesada":           {append(png, make([]byte, 9<<20)...), "image/png", "La imagen pesa 9.0 MB. El máximo son 8 MB."},
	}
	for nombre, c := range casos {
		_, err := d.GuardarImagen(c.datos, c.tipo, "")
		var e *ErrSubida
		if !errors.As(err, &e) || e.Mensaje != c.msg {
			t.Errorf("%s: %v, tenía que decir %q", nombre, err, c.msg)
		}
	}
	if err := d.Borrar(url); err != nil {
		t.Fatal(err)
	}
	if err := d.Borrar(url); err != nil {
		t.Error("borrar algo que ya no está no es error")
	}
	if err := d.Borrar("/subidas/../../etc/passwd"); err == nil {
		t.Error("dejó borrar fuera de la carpeta")
	}
}

func TestAdjuntos(t *testing.T) {
	d := Nuevo(Config{Carpeta: t.TempDir()})
	url, err := d.GuardarAdjunto([]byte("%PDF-1.4"), "application/pdf; charset=binary", "whatsapp")
	if err != nil || !strings.HasSuffix(url, ".pdf") {
		t.Errorf("pdf: %q %v", url, err)
	}
	if url, _ := d.GuardarAdjunto([]byte("x"), "application/x-raro", ""); !strings.HasSuffix(url, ".bin") || !strings.Contains(url, "whatsapp-") {
		t.Errorf("tipo desconocido: %q", url)
	}
}

func TestNombreValido(t *testing.T) {
	for n, want := range map[string]bool{"producto-1.jpg": true, "../x": false, "a/b.jpg": false, ".oculto": false, "x..y": false} {
		if NombreValido(n) != want {
			t.Errorf("NombreValido(%q) = %v", n, !want)
		}
	}
}

package pdf

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"os"
	"testing"
	"time"
)

func init() {
	registrar("comprobante", decodificar(Comprobante))
}

// urlQr y la matriz de qrcode.create() contra el TS (qr.json).
func TestQrComoQrcode(t *testing.T) {
	crudo, err := os.ReadFile(dirGolden + "/qr.json")
	if err != nil {
		t.Fatal(err)
	}
	var casos []struct {
		Datos *struct {
			Fecha        time.Time `json:"fecha"`
			CuitEmisor   string    `json:"cuitEmisor"`
			PuntoVenta   float64   `json:"puntoVenta"`
			Tipo         string    `json:"tipo"`
			Numero       float64   `json:"numero"`
			Total        float64   `json:"total"`
			ReceptorCuit string    `json:"receptorCuit"`
			Cae          string    `json:"cae"`
		} `json:"datos"`
		URL    string `json:"url"`
		Texto  string `json:"texto"`
		Matriz struct {
			Version int    `json:"version"`
			Mascara int    `json:"mascara"`
			Lado    int    `json:"lado"`
			Modulos string `json:"modulos"`
		} `json:"matriz"`
	}
	if err := json.Unmarshal(crudo, &casos); err != nil {
		t.Fatal(err)
	}
	for i, c := range casos {
		texto := c.Texto
		if c.Datos != nil {
			d := c.Datos
			texto = UrlQr(DatosQr{Fecha: d.Fecha, CuitEmisor: d.CuitEmisor, PuntoVenta: d.PuntoVenta, Tipo: d.Tipo, Numero: d.Numero, Total: d.Total, ReceptorCuit: d.ReceptorCuit, Cae: d.Cae})
			if texto != c.URL {
				t.Errorf("caso %d: UrlQr\n  Go: %s\n  TS: %s", i, texto, c.URL)
				continue
			}
		}
		m, err := qrCrear(texto)
		if err != nil {
			t.Errorf("caso %d: %v", i, err)
			continue
		}
		quiero, _ := base64.StdEncoding.DecodeString(c.Matriz.Modulos)
		if m.size != c.Matriz.Lado {
			t.Errorf("caso %d (%q): lado %d, qrcode %d (versión %d)", i, texto[:min(len(texto), 40)], m.size, c.Matriz.Lado, c.Matriz.Version)
			continue
		}
		distintos := 0
		for k, v := range m.data {
			bit := quiero[k>>3]>>(7-k&7)&1 == 1
			if (v != 0) != bit {
				distintos++
			}
		}
		if distintos > 0 {
			t.Errorf("caso %d (%q): %d módulos distintos (máscara de qrcode %d)", i, texto[:min(len(texto), 40)], distintos, c.Matriz.Mascara)
		}
	}
}

func TestDesagregarComoTS(t *testing.T) {
	crudo, err := os.ReadFile(dirGolden + "/desagregar.json")
	if err != nil {
		t.Fatal(err)
	}
	var casos []struct {
		P, A, Neto, Iva, Total, Alicuota float64
	}
	if err := json.Unmarshal(crudo, &casos); err != nil {
		t.Fatal(err)
	}
	for _, c := range casos {
		a := c.A
		if a == -999 {
			a = math.NaN()
		}
		r := Desagregar(c.P, a)
		al := r.Alicuota
		if math.IsNaN(al) {
			al = -999
		}
		if r.Neto != c.Neto || r.Iva != c.Iva || r.Total != c.Total || al != c.Alicuota {
			t.Errorf("Desagregar(%v, %v) = %+v, el TS da %+v", c.P, c.A, r, c)
		}
	}
}

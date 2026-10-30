package avisos

import (
	"encoding/json"
	"os"
	"testing"
)

func TestPlantillasComoElTS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/avisos/cobros.json")
	if err != nil {
		t.Fatal(err)
	}
	type correo struct{ Asunto, HTML, Texto string }
	var g struct {
		Sitio   string
		Recibos []struct {
			Entrada struct {
				Nombre, Numero, Medios string
				Total                  float64
				Saldo                  *float64
			}
			correo
		}
		Cheques []struct {
			Entrada struct {
				Nombre, Cheque string
				Importe        float64
				Motivo         *string
				PorElBanco     bool
			}
			correo
		}
		Facturas []struct {
			Entrada struct {
				Nombre, Comprobante string
				Total               float64
				ConCae              bool
			}
			correo
		}
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	comparar := func(que string, i int, go_ Correo, ts correo) {
		if go_.Asunto != ts.Asunto || go_.HTML != ts.HTML || go_.Texto != ts.Texto {
			t.Errorf("%s %d:\nGo asunto %q\nTS asunto %q\nmismo html: %v, mismo texto: %v", que, i, go_.Asunto, ts.Asunto, go_.HTML == ts.HTML, go_.Texto == ts.Texto)
		}
	}
	for i, c := range g.Recibos {
		e := c.Entrada
		comparar("recibo", i, ReciboEmitido(g.Sitio, e.Nombre, e.Numero, e.Total, e.Medios, e.Saldo), c.correo)
	}
	for i, c := range g.Cheques {
		e := c.Entrada
		motivo := ""
		if e.Motivo != nil {
			motivo = *e.Motivo
		}
		comparar("cheque", i, ChequeRechazado(g.Sitio, e.Nombre, e.Cheque, e.Importe, motivo, e.PorElBanco), c.correo)
	}
	for i, c := range g.Facturas {
		e := c.Entrada
		comparar("factura", i, FacturaEmitida(g.Sitio, e.Nombre, e.Comprobante, e.Total, e.ConCae), c.correo)
	}
}

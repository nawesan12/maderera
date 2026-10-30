package avisos

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"mjbj/internal/email"
	"mjbj/internal/jsmath"
)

type lineaGolden struct {
	Descripcion string
	Cantidad    float64
	Unidad      *string
	Importe     *string
}

func lineasDe(ls []lineaGolden) []email.LineaCorreo {
	var out []email.LineaCorreo
	for _, l := range ls {
		out = append(out, LineaDeCorreo(l.Descripcion, l.Cantidad, l.Unidad, l.Importe))
	}
	return out
}

func TestPlantillasDePedidosComoElTS(t *testing.T) {
	crudo, err := os.ReadFile("../../testdata/golden/avisos/pedidos.json")
	if err != nil {
		t.Fatal(err)
	}
	type correo struct{ Asunto, HTML, Texto string }
	var g struct {
		Sitio   string
		Pedidos []struct {
			Entrada struct {
				Nombre, Numero, Token, Total, Entrega, MedioPago string
				Lineas                                           []lineaGolden
			}
			correo
		}
		Estados []struct {
			Entrada struct {
				Nombre, Numero, Token, Estado                string
				AsuntoPersonalizado, EncabezadoPersonalizado *string
			}
			correo
		}
		Pagos []struct {
			Entrada struct {
				Nombre, Monto, Referencia string
				Medio, Token              *string
				EsDeuda                   bool
			}
			correo
		}
		Presupuestos []struct {
			Entrada struct {
				Nombre, Numero string
				Express        bool
				RespondeHasta  *time.Time
			}
			correo
		}
		ParaFirmar []struct {
			Entrada struct{ Nombre, Numero, Remito, URL string }
			correo
		}
		Firmados []struct {
			Entrada struct {
				Nombre, Remito, Numero, Fecha string
				Lineas                        []lineaGolden
				Pendiente                     bool
			}
			correo
		}
	}
	if err := json.Unmarshal(crudo, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Pedidos) == 0 || len(g.Estados) == 0 || len(g.Pagos) == 0 || len(g.Presupuestos) == 0 || len(g.ParaFirmar) == 0 || len(g.Firmados) == 0 {
		t.Fatal("golden incompleto")
	}
	texto := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	comparar := func(que string, i int, go_ Correo, ts correo) {
		t.Helper()
		if go_.Asunto != ts.Asunto || go_.HTML != ts.HTML || go_.Texto != ts.Texto {
			t.Errorf("%s %d:\nGo asunto %q\nTS asunto %q\nmismo html: %v, mismo texto: %v\nGo texto %q\nTS texto %q", que, i, go_.Asunto, ts.Asunto,
				go_.HTML == ts.HTML, go_.Texto == ts.Texto, go_.Texto, ts.Texto)
		}
	}
	for i, c := range g.Pedidos {
		e := c.Entrada
		comparar("pedido", i, PedidoRecibido(g.Sitio, e.Nombre, e.Numero, e.Token, jsmath.Numero(e.Total), e.Entrega, e.MedioPago, lineasDe(e.Lineas)), c.correo)
	}
	for i, c := range g.Estados {
		e := c.Entrada
		comparar("estado", i, PedidoCambioDeEstado(g.Sitio, e.Nombre, e.Numero, e.Token, e.Estado, texto(e.AsuntoPersonalizado), texto(e.EncabezadoPersonalizado)), c.correo)
	}
	for i, c := range g.Pagos {
		e := c.Entrada
		comparar("pago", i, PagoAcreditado(g.Sitio, e.Nombre, jsmath.Numero(e.Monto), texto(e.Medio), e.Referencia, texto(e.Token), e.EsDeuda), c.correo)
	}
	for i, c := range g.Presupuestos {
		e := c.Entrada
		comparar("presupuesto", i, PresupuestoRecibido(g.Sitio, e.Nombre, e.Numero, e.Express, e.RespondeHasta), c.correo)
	}
	for i, c := range g.ParaFirmar {
		e := c.Entrada
		comparar("para firmar", i, PedidoParaFirmar(g.Sitio, e.Nombre, e.Numero, e.Remito, e.URL), c.correo)
	}
	for i, c := range g.Firmados {
		e := c.Entrada
		comparar("firmado", i, RemitoFirmado(g.Sitio, e.Nombre, e.Remito, e.Numero, e.Fecha, lineasDe(e.Lineas), e.Pendiente), c.correo)
	}
}

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

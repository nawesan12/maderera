package fiscal_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"mjbj/internal/fiscal"
	"mjbj/internal/fiscal/simulador"
)

func configDePrueba(t *testing.T, sim *simulador.Simulador) *fiscal.Config {
	t.Helper()
	cert, clave, err := simulador.CertificadoDePrueba("20111111112")
	if err != nil {
		t.Fatal(err)
	}
	env := map[string]string{"ARCA_CUIT": "20-11111111-2", "ARCA_CERTIFICADO": cert, "ARCA_CLAVE_PRIVADA": clave,
		"ARCA_URL_WSAA": sim.URLWsaa(), "ARCA_URL_WSFE": sim.URLWsfe()}
	cfg := fiscal.Entorno(func(k string) string { return env[k] }).Leer()
	if cfg == nil {
		t.Fatal("la configuración no se leyó")
	}
	return cfg
}

// La ida y vuelta entera contra el simulador: el ticket firmado con CMS, el
// ping, el último autorizado y un CAE.
func TestArcaContraElSimulador(t *testing.T) {
	sim := simulador.Nuevo()
	defer sim.Cerrar()
	cfg := configDePrueba(t, sim)
	ctx := context.Background()
	ahora := time.Now()

	ticket, err := fiscal.PedirTicket(ctx, cfg, "wsfe", ahora)
	if err != nil {
		t.Fatal(err)
	}
	if ticket.Token == "" || ticket.Expira.Before(ahora.Add(11*time.Hour)) {
		t.Fatalf("ticket raro: %+v", ticket)
	}
	// ARCA no da otro ticket mientras el anterior siga vigente.
	if _, err := fiscal.PedirTicket(ctx, cfg, "wsfe", ahora); err == nil || !strings.Contains(err.Error(), "ya posee un TA valido") {
		t.Fatalf("un segundo ticket tendría que fallar: %v", err)
	}

	body, err := fiscal.Llamar(ctx, cfg, nil, "FEDummy", "", nil)
	if err != nil || !fiscal.LeerDummy(body) {
		t.Fatalf("FEDummy: %v", err)
	}
	auth := fiscal.AuthXML(ticket, cfg.Cuit)
	body, err = fiscal.Llamar(ctx, cfg, nil, "FECompUltimoAutorizado", fiscal.CuerpoUltimo(auth, 3, "factura_b"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if n, e := fiscal.LeerUltimo(body); n == nil || *n != 0 || e != "" {
		t.Fatalf("último: %v %q", n, e)
	}

	tot := fiscal.Importes([]fiscal.LineaEntrada{{Descripcion: "Fenólico", Cantidad: 2, PrecioFinalUnitario: 12100}}, nil, false, 0)
	c := fiscal.AAutorizar{Tipo: "factura_b", PuntoVenta: 3, Numero: 1, FechaEmision: ahora, ReceptorCondicionIva: "consumidor_final",
		Neto: tot.Totales.Neto, Exento: tot.Totales.Exento, Iva: tot.Totales.IvaPorAlicuota, Total: tot.Total}
	body, err = fiscal.Llamar(ctx, cfg, nil, "FECAESolicitar", fiscal.CuerpoAutorizar(c, cfg.Cuit, auth), nil)
	if err != nil {
		t.Fatal(err)
	}
	r := fiscal.LeerAutorizacion(body)
	if !r.Autorizado || len(r.Cae) != 14 || r.CaeVencimiento == nil {
		t.Fatalf("no autorizó: %+v", r)
	}
	// El mismo número otra vez: ARCA lo rechaza (10016).
	body, _ = fiscal.Llamar(ctx, cfg, nil, "FECAESolicitar", fiscal.CuerpoAutorizar(c, cfg.Cuit, auth), nil)
	if r := fiscal.LeerAutorizacion(body); r.Autorizado || !strings.Contains(r.Observaciones, "[10016]") {
		t.Fatalf("el repetido tendría que rechazarse: %+v", r)
	}
	// La consulta devuelve el CAE que dio.
	body, _ = fiscal.Llamar(ctx, cfg, nil, "FECompConsultar", fiscal.CuerpoConsultar(auth, 3, "factura_b", 1), nil)
	if q := fiscal.LeerConsulta(body); !q.Existe || q.Cae != r.Cae || q.ImpTotal != 24200 {
		t.Fatalf("consulta: %+v", q)
	}
	body, _ = fiscal.Llamar(ctx, cfg, nil, "FECompConsultar", fiscal.CuerpoConsultar(auth, 3, "factura_b", 2), nil)
	if q := fiscal.LeerConsulta(body); q.Existe || !q.NoExiste() {
		t.Fatalf("el 2 no existe: %+v", q)
	}
	// Una nota de crédito sin el asociado se rechaza; con él, pasa.
	nc := c
	nc.Tipo, nc.Numero = "nota_credito_b", 1
	body, _ = fiscal.Llamar(ctx, cfg, nil, "FECAESolicitar", fiscal.CuerpoAutorizar(nc, cfg.Cuit, auth), nil)
	if r := fiscal.LeerAutorizacion(body); r.Autorizado {
		t.Fatal("la nota sin asociado no tendría que pasar")
	}
	nc.Asociado = &fiscal.Asociado{Tipo: "factura_b", PuntoVenta: 3, Numero: 1, Fecha: ahora}
	body, _ = fiscal.Llamar(ctx, cfg, nil, "FECAESolicitar", fiscal.CuerpoAutorizar(nc, cfg.Cuit, auth), nil)
	if r := fiscal.LeerAutorizacion(body); !r.Autorizado {
		t.Fatalf("la nota con asociado: %+v", r)
	}
}

package fiscal_test

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"mjbj/internal/fiscal"
)

// Contra ARCA de verdad (homologación), a pedido: MJBJ_ARCA_REAL=1.
//
// Sin certificado solo se puede el ping (FEDummy no pide ticket): prueba el
// TLS, el sobre SOAP y la lectura de la respuesta contra el servidor real.
// Con el certificado de homologación cargado (ARCA_CUIT, ARCA_CERTIFICADO_ARCHIVO,
// ARCA_CLAVE_PRIVADA_ARCHIVO, ARCA_AMBIENTE=homologacion), además pide un
// ticket al WSAA y el último autorizado del punto de venta MJBJ_ARCA_PV.
func TestHomologacionReal(t *testing.T) {
	if os.Getenv("MJBJ_ARCA_REAL") != "1" {
		t.Skip("MJBJ_ARCA_REAL=1 para hablar con ARCA de verdad")
	}
	ctx := context.Background()
	cfg := fiscal.DelProceso.Leer()
	if cfg == nil {
		cfg = &fiscal.Config{Ambiente: "homologacion", URLWsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx"}
	}
	if cfg.Ambiente != "homologacion" {
		t.Fatal("esta prueba es solo para homologación")
	}
	body, err := fiscal.Llamar(ctx, cfg, nil, "FEDummy", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if !fiscal.LeerDummy(body) {
		t.Fatal("ARCA contestó, pero algún servidor no está OK")
	}
	t.Log("FEDummy: AppServer, DbServer y AuthServer en OK")
	if cfg.Cuit == "" {
		t.Skip("sin certificado: solo el ping")
	}
	ticket, err := fiscal.PedirTicket(ctx, cfg, "wsfe", time.Now())
	if err != nil {
		t.Fatalf("WSAA: %v (si dice que ya hay un TA válido, esperá a que venza o usá el guardado en arca_tokens)", err)
	}
	pv := int64(1)
	if v := os.Getenv("MJBJ_ARCA_PV"); v != "" {
		if _, err := fmt.Sscan(v, &pv); err != nil {
			t.Fatal(err)
		}
	}
	body, err = fiscal.Llamar(ctx, cfg, nil, "FECompUltimoAutorizado", fiscal.CuerpoUltimo(fiscal.AuthXML(ticket, cfg.Cuit), pv, "factura_b"), nil)
	if err != nil {
		t.Fatal(err)
	}
	n, e := fiscal.LeerUltimo(body)
	if e != "" || n == nil {
		t.Fatalf("último autorizado: %v %s", n, e)
	}
	t.Logf("ticket hasta %s; último factura B del punto %d: %d", ticket.Expira, pv, *n)
}

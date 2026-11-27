package pagos

import (
	"context"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// M2S1-053: rechazar una transferencia de la cuenta (sin pedido) le avisa
// al cliente con el motivo, y el mensaje no dice «en su pedido».
func TestRechazarTransferenciaDeLaCuentaAvisa(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	cliente := e.id(t, `insert into customers (nombre, tipo, email) values ('Sim Constructora', 'particular', 'sim@ejemplo.test') returning id`)
	pago := e.id(t, `insert into payments (customer_id, tipo, proveedor, medio, monto, estado, comprobante_url) values ($1, 'deuda', 'transferencia', 'deposito', 300000, 'en_revision', '/subidas/x.pdf') returning id`, cliente)
	if _, err := e.ses.AltaDeStaff(ctx, "admin@prueba.test", "una clave larga", "Persona", sqlc.StaffRoleAdmin); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	if _, err := e.ses.Entrar(ctx, w, "admin@prueba.test", "una clave larga", "", "", true); err != nil {
		t.Fatal(err)
	}
	jar, _ := cookiejar.New(nil)
	u, _ := http.NewRequest("GET", e.srv.URL, nil)
	jar.SetCookies(u.URL, w.Result().Cookies())
	adm := &http.Client{Jar: jar}
	c, b := pedir(t, adm, "POST", e.srv.URL+"/api/v1/admin/pagos/"+pago+"/conciliar", map[string]any{"decision": "rechazar", "motivo": "No llegó al banco"})
	if c != 200 || strings.Contains(b, "en su pedido") || !strings.Contains(b, "Movimientos") {
		t.Fatalf("rechazar: %d %s", c, b)
	}
	if n := e.numero(t, `select count(*)::float8 from trabajos where tipo = $1 and carga->>'detalle' = 'rechazado' and carga->>'motivo' = 'No llegó al banco'`, TipoResultado); n != 1 {
		t.Errorf("no se encoló el aviso: %v", n)
	}
}

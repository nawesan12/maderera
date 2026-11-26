package cuentas

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/sqlc"
)

// La vendedora registra desde la ficha del cliente que el banco rechazó un
// cheque (H272): el historial lo ofrece mientras el banco lo puede devolver,
// pide el PIN de un admin, y hace lo mismo que /admin/cheques (la deuda
// vuelve con una nota de débito, que se cobra con el mismo «Registrar
// cobro»). El depósito no, y uno ya rechazado no se rechaza dos veces.
func TestLaVendedoraRegistraElRechazoDeUnCheque(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	dep := e.staff(t, "deposito@prueba.test", sqlc.StaffRoleDeposito)
	var adminID string
	_ = e.pool.QueryRow(ctx, `select id from "user" where email = 'admin@prueba.test'`).Scan(&adminID)
	rol := sqlc.StaffRoleAdmin
	if err := e.ses.CargarPIN(ctx, &auth.Sesion{UserID: adminID, Nombre: "Persona", Correo: "admin@prueba.test", Rol: sqlc.UserRoleStaff, RolStaff: &rol},
		"una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	u := e.srv.URL + "/api/v1/admin/"
	if c, b := pedir(t, ven, "POST", u+"clientes", map[string]string{"nombre": "Constructora Sur", "limiteCredito": "1.000.000"}); c != 200 {
		t.Fatalf("alta: %d %s", c, b)
	}
	var id string
	_ = e.pool.QueryRow(ctx, `select id from customers where nombre = 'Constructora Sur'`).Scan(&id)
	pedir(t, adm, "POST", u+"clientes/"+id+"/movimientos", map[string]string{"tipo": "compra", "monto": "200.000"})
	partes := `[{"medio":"cheque","importe":"200.000","cheque":{"numero":"55500777","banco":"Nación","fechaPago":"` +
		time.Now().AddDate(0, 0, 5).Format("2006-01-02") + `"}}]`
	if c, b := pedir(t, ven, "POST", u+"clientes/"+id+"/cobros", map[string]string{"partes": partes}); c != 200 {
		t.Fatalf("cobro: %d %s", c, b)
	}

	// El historial ofrece el cheque del pago.
	_, b := pedir(t, ven, "GET", u+"clientes/"+id+"/historial", nil)
	var h struct {
		Movimientos []struct {
			Clase   string `json:"clase"`
			Cheques []struct {
				ID      string  `json:"id"`
				Nombre  string  `json:"nombre"`
				Importe float64 `json:"importe"`
			} `json:"cheques"`
		} `json:"movimientos"`
	}
	_ = json.Unmarshal([]byte(b), &h)
	var cheque string
	for _, m := range h.Movimientos {
		if m.Clase == "pago" && len(m.Cheques) == 1 && m.Cheques[0].Nombre == "Cheque Nación N° 55500777" && m.Cheques[0].Importe == 200000 {
			cheque = m.Cheques[0].ID
		}
	}
	if cheque == "" {
		t.Fatalf("el pago no ofrece su cheque: %s", b)
	}
	r := u + "cheques/" + cheque + "/rechazo"
	// El filtro «Cheques» lo muestra con su recibo.
	if _, b := pedir(t, ven, "GET", u+"clientes/"+id+"/historial?filtro=cheques", nil); !strings.Contains(b, `"clase":"cheque"`) ||
		!strings.Contains(b, `"cheques":[{"id":"`+cheque) || !strings.Contains(b, `"numero":"REC-`) {
		t.Errorf("filtro cheques: %s", b)
	}

	if c, _ := pedir(t, dep, "POST", r, map[string]string{"motivo": "Sin fondos"}); c != 403 {
		t.Errorf("el depósito: %d", c)
	}
	if c, b := pedir(t, ven, "POST", r, map[string]string{"motivo": " "}); c != 422 || !strings.Contains(b, "Poné el motivo del rechazo") {
		t.Errorf("sin motivo: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", r, map[string]string{"motivo": "Sin fondos"}); c != 422 || !strings.Contains(b, `"pinMonto":"200000.00"`) {
		t.Errorf("sin PIN: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", r, map[string]string{"motivo": "Sin fondos", "pin": "000000"}); c != 422 || !strings.Contains(b, `"pinIncorrecto":"si"`) {
		t.Errorf("PIN equivocado: %d %s", c, b)
	}
	if c, b := pedir(t, ven, "POST", r, map[string]string{"motivo": "Sin fondos", "pin": "482915"}); c != 200 {
		t.Fatalf("rechazo: %d %s", c, b)
	}
	var estado string
	var saldo float64
	_ = e.pool.QueryRow(ctx, `select estado::text from cheques where id = $1`, cheque).Scan(&estado)
	_ = e.pool.QueryRow(ctx, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, id).Scan(&saldo)
	var notas int
	_ = e.pool.QueryRow(ctx, `select count(*) from account_movements where customer_id = $1 and tipo = 'nota_debito' and cheque_id = $2`, id, cheque).Scan(&notas)
	if estado != "rechazado" || saldo != 200000 || notas != 1 {
		t.Errorf("después del rechazo: %s, saldo %v, notas de débito %d", estado, saldo, notas)
	}
	// Ya no se ofrece, y otra vez no pasa.
	_, b = pedir(t, ven, "GET", u+"clientes/"+id+"/historial", nil)
	if strings.Contains(b, `"cheques":[{"id":"`+cheque) {
		t.Errorf("sigue ofreciendo el rechazado: %s", b)
	}
	if _, b := pedir(t, ven, "GET", u+"clientes/"+id+"/historial?filtro=cheques", nil); strings.Contains(b, `"cheques":[{"id":"`+cheque) {
		t.Errorf("el filtro sigue ofreciendo el rechazado: %s", b)
	}
	if c, b := pedir(t, adm, "POST", r, map[string]string{"motivo": "otra vez"}); c != 422 || !strings.Contains(b, "no se puede rechazar") {
		t.Errorf("rechazar dos veces: %d %s", c, b)
	}
	// La deuda se cobra con el mismo cobro de la ficha.
	if c, b := pedir(t, ven, "POST", u+"clientes/"+id+"/cobros", map[string]string{"partes": `[{"medio":"transferencia","importe":"200000"}]`}); c != 200 {
		t.Errorf("cobrar la deuda: %d %s", c, b)
	}
	_ = e.pool.QueryRow(ctx, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, id).Scan(&saldo)
	if saldo != 0 {
		t.Errorf("saldo al final: %v", saldo)
	}
}

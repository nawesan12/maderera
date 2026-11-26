package pagos

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"mjbj/internal/limites"
	"mjbj/internal/sqlc"
)

// H385 (mes simulado): la misma transferencia informada dos veces quedaba
// dos veces «verificando», y se podía informar más de lo que se debía.
func TestTransferenciaInformadaDosVeces(t *testing.T) {
	e := armar(t, false)
	ctx := context.Background()
	if _, err := e.ses.AltaDeCliente(ctx, "mueble@prueba.test", "una clave larga", "Mueblería"); err != nil {
		t.Fatal(err)
	}
	ses, err := e.ses.Entrar(ctx, httptest.NewRecorder(), "mueble@prueba.test", "una clave larga", "", "", true)
	if err != nil {
		t.Fatal(err)
	}
	cliente := e.id(t, `select id from customers where user_id = $1`, ses.UserID)
	if _, err := e.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto, referencia) values ($1, 'compra', 520116, 'PED-1')`, cliente); err != nil {
		t.Fatal(err)
	}
	x := Extras{Lim: limites.Nuevo(sqlc.New(e.pool), silencio), Disco: e.disco}
	archivo := &Archivo{Datos: []byte("%PDF-1.4 transferencia"), Tipo: "application/pdf"}
	if _, err := e.s.SubirComprobanteDeDeuda(ctx, x, ses, archivo, "520116", "transferencia", false); err != nil {
		t.Fatalf("la primera: %v", err)
	}
	_, err = e.s.SubirComprobanteDeDeuda(ctx, x, ses, archivo, "520116", "transferencia", false)
	if err == nil || !strings.Contains(err.Error(), "Revisá") {
		t.Fatalf("la segunda igual pasó sin preguntar: %v", err)
	}
	if n := e.numero(t, `select count(*)::float8 from payments where customer_id = $1`, cliente); n != 1 {
		t.Fatalf("quedaron %v pagos", n)
	}
	// Otro importe, pero que pasa lo que se debe: también pregunta.
	if _, err := e.s.SubirComprobanteDeDeuda(ctx, x, ses, archivo, "100", "transferencia", false); err == nil {
		t.Fatal("informar más de lo que se debe no preguntó")
	}
	// Confirmado, se informa: puede ser de verdad otro pago.
	if _, err := e.s.SubirComprobanteDeDeuda(ctx, x, ses, archivo, "520116", "transferencia", true); err != nil {
		t.Fatalf("confirmado: %v", err)
	}
	if n := e.numero(t, `select count(*)::float8 from payments where customer_id = $1`, cliente); n != 2 {
		t.Fatalf("quedaron %v pagos", n)
	}
}

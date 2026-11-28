package mostrador

import (
	"context"
	"fmt"
	"testing"
	"time"

	"mjbj/internal/caja"
	"mjbj/internal/reportes"
	"mjbj/internal/sqlc"
)

// Lo que la tercera prueba como usuario no pudo reproducir en la caja
// (restos del mes 2 y 3, rol mostrador).

// M3S1-013 de punta a punta: el recibo en efectivo sin turno aparece en
// «Efectivo fuera de caja» con su sucursal, no se manda a un turno de otra
// sucursal, una vez asignado sale de la lista y entra al arqueo, y no deja
// un segundo asiento de Caja (el del recibo ya la movió).
func TestMes23ReciboFueraDeCajaDePuntaAPunta(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", sqlc.StaffRoleVendedor)
	e.abrir(t, ven, e.otra, 0)
	deLaOtra := e.txt(t, `select id::text from cash_sessions where branch_id = $1 and estado = 'abierta'`, e.otra)
	e.abrir(t, ven, e.central, 1000)
	sesion := e.sesionAbierta(t)
	r := e.txt(t, `insert into receipts (numero, recibido_de, branch_id, total, origen) values ('REC-0069', 'Sim Obra', $1, 150000, 'panel') returning id::text`, e.central)
	e.txt(t, `insert into receipt_parts (receipt_id, medio, importe) values ($1, 'efectivo', 150000) returning id::text`, r)

	p := caja.NuevoPanel(e.pool, silencio)
	desde, hasta := caja.MesArgentino("", time.Now())
	fuera := func() []caja.FueraDeCaja {
		t.Helper()
		v, err := p.EfectivoFueraDeCaja(context.Background(), desde, hasta)
		if err != nil {
			t.Fatal(err)
		}
		var out []caja.FueraDeCaja
		for _, f := range v {
			if f.Tipo == "recibo" && f.ID == r {
				out = append(out, f)
			}
		}
		return out
	}
	antes := fuera()
	if len(antes) != 1 || antes[0].Monto != 150000 || antes[0].BranchID == nil || *antes[0].BranchID != e.central {
		t.Fatalf("antes de asignar: %+v", antes)
	}
	cajaAntes := e.saldoDeCaja(t)

	adm := e.sesionDe(t, "admin@prueba.test")
	if _, err := p.AsignarReciboAlTurno(context.Background(), adm, r, deLaOtra); err == nil {
		t.Errorf("se mandó al turno de otra sucursal")
	}
	if _, err := p.AsignarReciboAlTurno(context.Background(), adm, r, sesion); err != nil {
		t.Fatal(err)
	}
	if v := fuera(); len(v) != 0 {
		t.Errorf("sigue fuera de caja: %+v", v)
	}
	ab, err := caja.Abierto(context.Background(), e.pool, e.central)
	if err != nil {
		t.Fatal(err)
	}
	if ab.Esperado != 151000 {
		t.Errorf("esperado del turno: %v", ab.Esperado)
	}
	if d := e.saldoDeCaja(t) - cajaAntes; d != 0 {
		t.Errorf("asignarlo movió la cuenta Caja otra vez: %v", d)
	}
}

// saldoDeCaja es el debe menos el haber de la cuenta Caja en todos los
// asientos.
func (e *entorno) saldoDeCaja(t *testing.T) float64 {
	t.Helper()
	s := 0.0
	for _, a := range e.asientosDeTodo(t) {
		for _, r := range a.Renglones {
			if r.Cuenta == reportes.Cuentas.Caja {
				s += r.Debe - r.Haber
			}
		}
	}
	return s
}

// M3S2-040: con más ventas que una página, lo emitido pagina sin repetir ni
// perder ninguna (aunque varias suban en el mismo instante) y el resumen es
// el del mes entero, con las anuladas aparte.
func TestMes23EmitidoPaginaMasDeCien(t *testing.T) {
	e := armar(t)
	momento := time.Now().Add(-time.Minute).Truncate(time.Second)
	for i := range 130 {
		estado := "entregado"
		if i%10 == 0 {
			estado = "cancelado"
		}
		// De a tres en el mismo instante, como sube la cola sin conexión.
		e.txt(t, `insert into orders (numero, contacto_nombre, estado, origen, tipo_entrega, subtotal, total, created_at)
			values ($1, 'Consumidor final', $2, 'mostrador', 'retiro', 1000, 1000, $3) returning id::text`,
			fmt.Sprintf("PED-%04d", 5000+i), estado, momento.Add(-time.Duration(i/3)*time.Second))
	}
	p := caja.NuevoPanel(e.pool, silencio)
	desde, hasta := caja.MesArgentino("", time.Now())
	if momento.Before(desde) { // la prueba corre en el primer minuto del mes
		desde = momento.Add(-time.Hour)
	}
	vistos := map[string]int{}
	for _, pag := range []struct{ desplazamiento, largo int }{{0, 100}, {100, 30}, {200, 0}} {
		v, err := p.EmitidoPorCaja(context.Background(), desde, hasta, 100, pag.desplazamiento)
		if err != nil {
			t.Fatal(err)
		}
		if len(v) != pag.largo {
			t.Errorf("página desde %d: %d ventas, se esperaban %d", pag.desplazamiento, len(v), pag.largo)
		}
		for _, x := range v {
			vistos[x.OrderID]++
		}
	}
	if len(vistos) != 130 {
		t.Errorf("entre las páginas hay %d ventas distintas de 130", len(vistos))
	}
	for id, n := range vistos {
		if n != 1 {
			t.Errorf("%s salió %d veces", id, n)
		}
	}
	res, err := p.ResumenEmitido(context.Background(), desde, hasta)
	if err != nil {
		t.Fatal(err)
	}
	if res.Cantidad != 130 || res.Anuladas != 13 || res.Importe != 117000 || res.ImporteAnuladas != 13000 {
		t.Errorf("resumen: %+v", res)
	}
}

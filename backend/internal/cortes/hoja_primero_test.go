package cortes

import "testing"

// CRT-11 (recorrido M4-088): 10 piezas de 450 × 350 en una placa de 2600 ×
// 1830 con sierra de 5 mm. El motor elegía por el retal más grande una
// columna de 4 y una fila de 6, que la hoja (que corta primero al largo)
// partía en 14 pasadas y tres tiras de 2245 × 450. Lo que corta la máquina
// es una tira de 7 y otra de 3: 12 pasadas y el retal de 2600 × 920.
func TestCRT11DosTirasYDocePasadas(t *testing.T) {
	sierra := 5.0
	d := DatosDelPlano{Piezas: []PiezaAcortar{{LargoMm: 450, AnchoMm: 350, Cantidad: 10}}, PlacaLargo: 2600, PlacaAncho: 1830, AnchoSierra: &sierra}
	p := PlanoConLaHoja(d)
	if len(p.Placas) != 1 || p.PasadasCobrables != 12 {
		t.Fatalf("placas %d, pasadas %d", len(p.Placas), p.PasadasCobrables)
	}
	if p.RecorteMayor == nil || p.RecorteMayor.Ancho != 2600 || p.RecorteMayor.Alto != 920 {
		t.Errorf("retal mayor: %+v", p.RecorteMayor)
	}
	if n := len(p.Placas[0].Recortes); n != 2 {
		t.Errorf("retales: %+v", p.Placas[0].Recortes)
	}
	if c := ACobrar(d); c.Pasadas != 12 {
		t.Errorf("a cobrar: %+v", c)
	}

	// Un trabajo que nació con el motor anterior se sigue armando como se
	// cobró.
	no := false
	d.HojaPrimero = &no
	if v := PlanoConLaHoja(d); v.PasadasCobrables != 14 {
		t.Errorf("motor anterior: %d pasadas", v.PasadasCobrables)
	}
}

// La cuenta rápida de la búsqueda dice lo mismo que la hoja armada.
func TestCortesDeLaHojaComoElDibujo(t *testing.T) {
	for i, d := range despiecesDePrueba(200, 7) {
		p := CalcularPlano(d)
		for _, placa := range p.Placas {
			arbol, err := partir(Rect{0, 0, p.PlacaLargo, p.PlacaAncho}, placa.Piezas, p.AnchoSierra, 1, 0)
			n, ok := cortesDeLaHoja(Rect{0, 0, p.PlacaLargo, p.PlacaAncho}, placa.Piezas, p.AnchoSierra, 1, 0)
			if (err == nil) != ok {
				t.Fatalf("despiece %d: armar %v, contar %v", i, err, ok)
			}
			if err == nil {
				if h := len(cortesDelDibujo(dibujoDe(arbol, map[*Trozo]*OperacionDeCorte{}, p.AnchoSierra))); h != n {
					t.Fatalf("despiece %d: la hoja %d cortes, la cuenta %d", i, h, n)
				}
			}
		}
	}
}

// M4-089: «Deshacer» después de terminar con las pasadas corregidas vuelve el
// corte a la máquina con las pasadas de antes.
func TestDeshacerTerminadoDevuelveLasPasadas(t *testing.T) {
	e := armar(t)
	ven := e.staff(t, "vendedor@prueba.test", "vendedor")
	ase := e.staff(t, "aserradero@prueba.test", "aserradero")
	id := alta(t, e, ven, melamina(e))
	u := e.srv.URL + "/api/v1/admin/cortes/" + id
	antes := e.txt(t, `select pasadas::text from cutting_orders where id = $1`, id)
	pedir(t, ase, "POST", u+"/avanzar?desde=en-cola", nil)
	if code, b := pedir(t, ase, "POST", u+"/avanzar?desde=en-proceso&pasadas=99", nil); code != 200 {
		t.Fatalf("terminar: %d %s", code, b)
	}
	if code, b := pedir(t, ase, "POST", u+"/volver?desde=terminado", nil); code != 200 {
		t.Fatalf("deshacer: %d %s", code, b)
	}
	if n := e.txt(t, `select pasadas::text from cutting_orders where id = $1`, id); n != antes {
		t.Errorf("las pasadas: %s, antes %s", n, antes)
	}
}

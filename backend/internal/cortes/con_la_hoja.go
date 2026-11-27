package cortes

import (
	"math"
	"slices"

	"cmp"
)

// MotorPasadasDeLaHoja es el motor desde el que el plano se dibuja, se cuenta
// y se cobra con la geometría de la hoja de corte (mes simulado, H230).
//
// El motor guillotina anota sus propios cortes mientras acomoda, y la hoja de
// la seccionadora rearma el árbol desde las posiciones de las piezas, con las
// tiras iguales juntas y los sobrantes al final. Las dos cuentas no
// coincidían: en CRT-9 la hoja decía 16 cortes y la ficha 13 pasadas, y los
// retales de una y otra eran otros. Sobre 200 despieces del banco, 155 daban
// distinto, para los dos lados. Lo que corta la máquina es la hoja, así que
// la hoja manda: las pasadas que se cobran, las que se ven en la ficha y en el
// plano, y los retales, salen de ella.
//
// Un trabajo guardado con un motor anterior se sigue armando como nació: su
// cobro ya está hecho.
const MotorPasadasDeLaHoja = 4

// MotorRelleno es el motor desde el que la pieza de una placa que se cobra
// por pasadas va al sobrante de una que se vende entera, si entra (mes
// simulado, M2S4-039: el segundo zócalo cortaba la placa de la casa con dos
// pasadas de más, y entraba en el retal de la placa vendida).
const MotorRelleno = 5

// MotorActual es con el que nacen los trabajos nuevos (las tres altas y el
// cambio de disco).
const MotorActual = MotorRelleno

// PlanoConLaHoja es el plano de algo que se va a cobrar ahora: el del motor,
// contado y dibujado como lo corta la hoja.
func PlanoConLaHoja(d DatosDelPlano) Plano {
	return ConLaHoja(CalcularPlano(d))
}

// ConLaHoja reescribe cada placa con la geometría de su patrón en la hoja de
// corte: las piezas donde quedan al cortarlas en orden, los cortes numerados
// de la hoja y los retales que la hoja dice que quedan. Las pasadas, las
// cobrables y el retal mayor se vuelven a contar. Si la hoja no se puede
// armar (no debería pasar: el plano siempre es guillotina) queda el del motor.
func ConLaHoja(p Plano) Plano {
	if len(p.Placas) == 0 {
		return p
	}
	// Cada placa con su propio árbol, como lo arma la hoja: el patrón junta
	// placas iguales, pero cada una tiene sus piezas (su índice y su unidad
	// son los que mueve el acomodo a mano).
	dibujos := make([]*Dibujo, len(p.Placas))
	for i, placa := range p.Placas {
		piezas := make([]PiezaColocada, len(placa.Piezas))
		for j, x := range placa.Piezas {
			x.X, x.Y, x.Ancho, x.Alto = r3(x.X), r3(x.Y), r3(x.Ancho), r3(x.Alto)
			piezas[j] = x
		}
		arbol, err := partir(Rect{0, 0, p.PlacaLargo, p.PlacaAncho}, piezas, p.AnchoSierra, 1, 0)
		if err != nil {
			return p
		}
		d := dibujoDe(arbol, map[*Trozo]*OperacionDeCorte{}, p.AnchoSierra)
		dibujos[i] = &d
	}
	out := p
	out.Placas = make([]PlacaDelPlano, len(p.Placas))
	out.Pasadas, out.PasadasCobrables, out.RecorteMayor = 0, 0, nil
	for i, placa := range p.Placas {
		placa.Piezas = piezasDelDibujo(*dibujos[i])
		placa.Cortes = cortesDelDibujo(*dibujos[i])
		placa.Recortes = retalesDelDibujo(*dibujos[i])
		out.Placas[i] = placa
		out.Pasadas += len(placa.Cortes)
		if !placa.SeVendeEntera {
			out.PasadasCobrables += len(placa.Cortes)
		}
		for _, r := range placa.Recortes {
			if out.RecorteMayor == nil || r.Ancho*r.Alto > out.RecorteMayor.Ancho*out.RecorteMayor.Alto {
				rr := r
				out.RecorteMayor = &rr
			}
		}
	}
	return out
}

func piezasDelDibujo(d Dibujo) []PiezaColocada {
	out := make([]PiezaColocada, len(d.Piezas))
	for i, p := range d.Piezas {
		out[i] = *p.Pieza
		out[i].X, out[i].Y, out[i].Ancho, out[i].Alto = p.Rect.X, p.Rect.Y, p.Rect.Ancho, p.Rect.Alto
	}
	return out
}

func cortesDelDibujo(d Dibujo) []LineaDeCorte {
	out := make([]LineaDeCorte, len(d.Cortes))
	for i, c := range d.Cortes {
		dir := "vertical"
		if math.Abs(c.Y1-c.Y2) <= eps {
			dir = "horizontal"
		}
		out[i] = LineaDeCorte{Direccion: dir, X1: c.X1, Y1: c.Y1, X2: c.X2, Y2: c.Y2}
	}
	return out
}

// retalesDelDibujo son los sobrantes de la hoja que dan para guardar, del más
// grande al más chico, como los del motor.
func retalesDelDibujo(d Dibujo) []Recorte {
	out := []Recorte{}
	for _, s := range d.Sobrantes {
		if s.Tipo == "retal" {
			out = append(out, Recorte{s.Rect.X, s.Rect.Y, s.Rect.Ancho, s.Rect.Alto})
		}
	}
	slices.SortStableFunc(out, func(a, b Recorte) int { return cmp.Compare(b.Ancho*b.Alto, a.Ancho*a.Alto) })
	return out
}

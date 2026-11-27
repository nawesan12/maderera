package cortes

// El relleno de la placa vendida (MotorRelleno, mes simulado M2S4-039).
//
// El motor acomoda sin saber qué placa se vende y cuál se cobra por pasadas:
// en CRT-26 el segundo zócalo de 900 × 100 salía de la placa de la casa con
// dos pasadas propias, cuando entraba en el retal de 1695 × 100 de la placa
// vendida. Después del acomodo se prueba mandar cada pieza de una placa que
// se cobra por pasadas a una que se vende entera (fijando la placa, no la
// coordenada, como el acomodo a mano; el resto lo vuelve a acomodar el
// motor) y se queda con el cambio si no vende
// menos placas, no usa más, no deja piezas afuera y cobra menos pasadas.
//
// Determinístico y con tope: el plano de un trabajo se rehace cada vez que se
// lee, y tiene que salir igual.

// Topes del relleno: cuántas pruebas en total y desde qué tamaño no se
// intenta (el motor con búsqueda cuesta en cada prueba).
const (
	pruebasDeRelleno     = 40
	placasMaximasRelleno = 8
)

// CalcularPlano es el plano del motor: el acomodo guillotina y, salvo que
// d.Relleno diga que no, el relleno de la placa vendida.
func CalcularPlano(d DatosDelPlano) Plano {
	base := calcularPlanoBase(d)
	if d.Relleno != nil && !*d.Relleno {
		return base
	}
	return rellenar(d, base)
}

func rellenar(d DatosDelPlano, p Plano) Plano {
	if len(p.Placas) < 2 || len(p.Placas) > placasMaximasRelleno || p.PlacasEnteras == 0 || p.PlacasEnteras == len(p.Placas) {
		return p
	}
	fijadaPorElUsuario := map[[2]int]bool{}
	for _, f := range d.Fijadas {
		fijadaPorElUsuario[[2]int{f.Indice, f.Unidad}] = true
	}
	pruebas := 0
	contada := ConLaHoja(p)
	for {
		mejor := false
	busqueda:
		for _, parcial := range p.Placas {
			if parcial.SeVendeEntera {
				continue
			}
			for _, pieza := range parcial.Piezas {
				if fijadaPorElUsuario[[2]int{pieza.Indice, pieza.Unidad}] {
					continue
				}
				for _, entera := range p.Placas {
					if !entera.SeVendeEntera {
						continue
					}
					// Las dos orientaciones: la pieza puede entrar en el
					// retal solo girada (la veta la descarta el motor).
					for _, girada := range []*bool{nil, ptrBool(true)} {
						if pruebas >= pruebasDeRelleno {
							return p
						}
						pruebas++
						prueba := d
						prueba.Fijadas = append(append([]PiezaFijada(nil), d.Fijadas...),
							PiezaFijada{Indice: pieza.Indice, Unidad: pieza.Unidad, Placa: entera.Numero, Girada: girada})
						candidato := calcularPlanoBase(prueba)
						if !esMejorRelleno(candidato, p) {
							continue
						}
						contadoCand := ConLaHoja(candidato)
						if contadoCand.PasadasCobrables >= contada.PasadasCobrables {
							continue
						}
						p, contada, d = candidato, contadoCand, prueba
						for _, f := range prueba.Fijadas {
							fijadaPorElUsuario[[2]int{f.Indice, f.Unidad}] = true
						}
						mejor = true
						break busqueda
					}
				}
			}
		}
		if !mejor {
			return p
		}
	}
}

// esMejorRelleno: no vende menos placas, no usa más, no deja piezas afuera
// ni descarta lo que fijó el usuario.
func esMejorRelleno(c, p Plano) bool {
	return c.PlacasEnteras >= p.PlacasEnteras && len(c.Placas) <= len(p.Placas) &&
		len(c.NoEntran) <= len(p.NoEntran) && len(c.FijadasDescartadas) <= len(p.FijadasDescartadas) &&
		c.TotalPiezas == p.TotalPiezas
}

func ptrBool(b bool) *bool { return &b }

package mostrador

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cortes"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
	"mjbj/internal/reservas"
	"mjbj/internal/ventas"
)

// Los controles sobre la plata de la venta (T3, 18/11/2026): la huella de
// la clave, el precio de lista que pone el servidor, lo que el corte no
// cobra y el porcentaje libre.

// PorcentajeLibre es precios.PorcentajeLibre (la regla de /admin/reglas).
func PorcentajeLibre(ctx context.Context, c precios.Consultador) (float64, error) {
	return precios.PorcentajeLibre(ctx, c)
}

// huellaDeVenta resume lo que la venta cobra (no la autorización ni las
// notas): la misma clave con otra venta adentro no devuelve la vieja como si
// fuera la nueva.
func huellaDeVenta(v VentaPedida) string {
	h := sha256.New()
	escribir := func(s ...string) {
		for _, x := range s {
			h.Write([]byte(x))
			h.Write([]byte{0})
		}
	}
	opt := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	num := func(f float64) string { return jsmath.Fijo2(f) }
	escribir(v.BranchID, opt(v.CustomerID), v.MedioPago, strconv.FormatBool(v.Acopio))
	if v.Descuento != nil {
		escribir(num(*v.Descuento))
	}
	for _, l := range v.Lineas {
		escribir(opt(l.VariantID), l.Descripcion, num(l.Cantidad), num(l.PrecioUnitario), opt(l.Presentacion))
		// De qué corte sale el renglón, y abajo cada despiece: un reintento
		// con la misma clave y otro despiece se tomaba como la misma venta,
		// y el despiece nuevo no llegaba al taller (revisión del carril F).
		// Solo si hay: la huella de una venta sin cortes queda como antes.
		if l.Corte != nil {
			escribir("corte", strconv.Itoa(*l.Corte))
		}
	}
	for _, p := range v.Pagos {
		escribir(p.Medio, num(p.Importe))
	}
	for _, k := range v.Cortes {
		escribir("despiece", opt(k.VariantID), opt(k.Mitad), opt(k.AcomodoManual))
		for _, p := range k.Piezas {
			escribir(strconv.Itoa(p.LargoMm), strconv.Itoa(p.AnchoMm), strconv.Itoa(p.Cantidad),
				strconv.Itoa(p.RespetaVeta), strconv.Itoa(p.CantoLargo), strconv.Itoa(p.CantoAncho))
		}
	}
	return hex.EncodeToString(h.Sum(nil))
}

// ventaYaHecha busca la venta por su clave: nil si no está. Con otra huella
// es un rechazo (ClaveUsada); una venta anterior a T3 no tiene huella y se
// devuelve como siempre.
func ventaYaHecha(ctx context.Context, c precios.Consultador, v VentaPedida, huella string) (*ResultadoVenta, error) {
	var id, numero string
	var total jsmath.Num
	var marca *string
	err := c.QueryRow(ctx, `SELECT id, numero, total, huella_mostrador FROM orders WHERE clave_mostrador = $1 LIMIT 1`, v.Clave).
		Scan(&id, &numero, &total, &marca)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if marca != nil && *marca != huella {
		return &ResultadoVenta{Error: "Esa venta ya se cobró como " + numero + " con otros productos o importes. Empezá una venta nueva.", ClaveUsada: true}, nil
	}
	return &ResultadoVenta{Ok: true, OrderID: id, Numero: numero, Total: total.F(), Nueva: false, Lineas: v.Lineas}, nil
}

// conPrecioDeLista pone en cada renglón con variante el precio de la lista
// del cliente (con el porcentaje de la media placa). El que manda el
// navegador no se cree: era el hueco por el que se vendía a cualquier precio.
func conPrecioDeLista(ctx context.Context, c precios.Consultador, lineas []ventas.LineaDeVenta, lista precios.Lista) error {
	renglones := make([]precios.RenglonConVariante, len(lineas))
	for i, l := range lineas {
		renglones[i] = precios.RenglonConVariante{VariantID: l.VariantID, Presentacion: l.Presentacion}
	}
	listas, err := precios.PreciosDeLista(ctx, c, renglones, lista)
	if err != nil {
		return err
	}
	for i := range lineas {
		lineas[i].PrecioLista = listas[i]
	}
	return nil
}

// tarifaDelCorte es la tarifa de la placa del corte (cutting_rates) para la
// lista del cliente, con la misma búsqueda que el mostrador (corte-a-medida)
// y la ficha del corte: primero la categoría, después el producto; sin la
// propia de la lista, la general.
// Nil si el corte no tiene placa o la placa no tiene tarifa.
func tarifaDelCorte(ctx context.Context, c precios.Consultador, k *CorteDeMostrador, lista precios.Lista) (*cortes.TarifaDeCorte, error) {
	if k == nil || len(k.Piezas) == 0 || k.VariantID == nil {
		return nil, nil
	}
	var categoria, producto, medida string
	err := c.QueryRow(ctx, `
		SELECT coalesce(c.name, ''), p.name, coalesce(pv.label, '') FROM product_variants pv
		JOIN products p ON p.id = pv.product_id LEFT JOIN categories c ON c.id = p.category_id
		WHERE pv.id::text = $1`, *k.VariantID).Scan(&categoria, &producto, &medida)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	filas, err := c.Query(ctx, `
		SELECT material, price_list_id::text, precio_por_pasada, precio_por_metro_canto
		FROM cutting_rates WHERE activo ORDER BY material ASC`)
	if err != nil {
		return nil, err
	}
	tarifas, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (cortes.TarifaDeCorte, error) {
		var t cortes.TarifaDeCorte
		var pp, pc jsmath.Num
		err := r.Scan(&t.Material, &t.PriceListID, &pp, &pc)
		t.PrecioPorPasada, t.PrecioPorMetroCanto = pp.F(), pc.F()
		return t, err
	})
	if err != nil {
		return nil, err
	}
	// La lista general no tiene tarifa propia: es la de público (la misma
	// cuenta que el mostrador, que busca con la lista del cliente o ninguna).
	var id *string
	if lista.Diferenciada() {
		id = lista.ID
	}
	return cortes.BuscarTarifa(tarifas, []string{categoria, producto + " " + medida, producto}, id), nil
}

// esPasada y esCanto son los renglones de servicio que agrega el corte
// (app/mostrador/corte-a-medida.tsx): sin variante, en «pasada» o en metros
// de «Tapacanto».
func esPasada(l ventas.LineaDeVenta) bool { return l.VariantID == nil && l.Unidad == "pasada" }
func esCanto(l ventas.LineaDeVenta) bool {
	return l.VariantID == nil && l.Unidad == "m" && strings.HasPrefix(l.Descripcion, "Tapacanto")
}

// atarRenglonesAlCorte deja cada renglón del corte atado a su despiece. La
// pantalla de antes mandaba un solo «corte» y los renglones sueltos: se
// atan los que son de él (su placa con la presentación del corte, las
// pasadas y el tapacanto), que era lo que se miraba antes de A2. Si algún
// renglón ya viene atado, no se adivina nada.
func atarRenglonesAlCorte(v *VentaPedida) {
	if !v.CorteSuelto || len(v.Cortes) != 1 {
		return
	}
	for _, l := range v.Lineas {
		if l.Corte != nil {
			return
		}
	}
	k := v.Cortes[0]
	presentacion := presentacionDeMitad(k.Mitad)
	cero := 0
	for i, l := range v.Lineas {
		if esPasada(l) || esCanto(l) ||
			(k.VariantID != nil && l.VariantID != nil && *l.VariantID == *k.VariantID && mismaPresentacion(l.Presentacion, presentacion)) {
			v.Lineas[i].Corte = &cero
		}
	}
}

// conTarifaDelCorte les da precio de lista a las pasadas y al tapacanto de
// cada corte: la tarifa que cargó el admin para su placa (revisión de T3).
// Sin eso, el renglón sin variante entraba a su propio precio, y poner la
// pasada a $1 dejaba de cobrar el servicio entero sin PIN.
func conTarifaDelCorte(lineas []ventas.LineaDeVenta, tarifas []*cortes.TarifaDeCorte) {
	for i := range lineas {
		if lineas[i].Corte == nil || *lineas[i].Corte >= len(tarifas) {
			continue
		}
		t := tarifas[*lineas[i].Corte]
		if t == nil {
			continue
		}
		switch {
		case esPasada(lineas[i]) && t.PrecioPorPasada > 0:
			p := t.PrecioPorPasada
			lineas[i].PrecioLista = &p
		case esCanto(lineas[i]) && t.PrecioPorMetroCanto > 0:
			p := t.PrecioPorMetroCanto
			lineas[i].PrecioLista = &p
		}
	}
}

// revisarCobroDelCorte vuelve a calcular lo que se cobra del corte i
// (cortes.ACobrar) y lo compara con sus renglones: las placas, las pasadas y
// los metros de tapacanto tienen que ser los del plano, **ni de menos ni de
// más**. Devuelve el rechazo, o "" si cierra.
//
// De menos era acomodar a mano las piezas para que cada placa quedara por
// debajo de la mitad (T3, hallazgo 11), o borrar el renglón de las pasadas.
// De más era reabrir el corte para corregirlo: los renglones nuevos se
// sumaban a los viejos y se cobraban dos placas, dos cortes y dos
// tapacantos sin PIN (comité final, A2). Antes lo de menos pedía el PIN;
// ahora no hay nada que autorizar: un corte que no cierra con su plano es
// un error de la pantalla, y la venta se rechaza para que se rearme.
//
// Las pasadas y el canto se exigen solo si el corte los cobra: con tarifa
// (la pantalla sin tarifa no agrega el renglón) o si la venta los trae.
func (s *Servicio) revisarCobroDelCorte(ctx context.Context, v VentaPedida, i int, tarifa *cortes.TarifaDeCorte) (string, error) {
	k := v.Cortes[i]
	cobro, metrosDelPlano := s.planoDelCorte(ctx, k)

	presentacion := presentacionDeMitad(k.Mitad)
	placas, pasadas, metros := 0.0, 0.0, 0.0
	hayPasadas, hayCanto := false, false
	noCierra := "El corte de " + k.MaterialDescripcion + " no cierra con su plano. Tocá «Corregir» en el corte y guardalo."
	// La pantalla carga las tarifas al abrirse: si el admin creó o activó
	// una después, Go pide las pasadas o el canto que la pantalla no puso, y
	// «Corregir» con las tarifas viejas no lo arreglaba nunca. Este texto lo
	// reconoce la pantalla (vista.tsx) para traer las nuevas.
	tarifasNuevas := "Las tarifas de corte cambiaron. Tocá «Corregir» en el corte de " + k.MaterialDescripcion + " y guardalo."
	for _, l := range v.Lineas {
		if l.Corte == nil || *l.Corte != i {
			continue
		}
		switch {
		case k.VariantID != nil && l.VariantID != nil && *l.VariantID == *k.VariantID && mismaPresentacion(l.Presentacion, presentacion):
			placas += l.Cantidad
		case esPasada(l):
			pasadas += l.Cantidad
			hayPasadas = true
		case esCanto(l):
			metros += l.Cantidad
			hayCanto = true
		default:
			// Otro producto atado al corte: no es del plano.
			return noCierra, nil
		}
	}
	if k.VariantID != nil && math.Abs(placas-float64(cobro.Placas)) > 1e-6 {
		return noCierra, nil
	}
	if (hayPasadas || (tarifa != nil && tarifa.PrecioPorPasada > 0)) && math.Abs(pasadas-float64(cobro.Pasadas)) > 1e-6 {
		if !hayPasadas {
			return tarifasNuevas, nil
		}
		return noCierra, nil
	}
	// El canto se mide en metros con dos decimales (MetrosDeTapacanto): una
	// diferencia de redondeo no es canto de más ni de menos.
	if (hayCanto || (tarifa != nil && tarifa.PrecioPorMetroCanto > 0)) && math.Abs(metrosDelPlano-metros) > 0.005 {
		if !hayCanto {
			return tarifasNuevas, nil
		}
		return noCierra, nil
	}
	return "", nil
}

// planoDelCorte es lo que cobra el plano del corte (las placas y las
// pasadas, cortes.ACobrar) y sus metros de tapacanto: la misma cuenta que
// el plano que se dibuja en la pantalla y la ficha del corte.
func (s *Servicio) planoDelCorte(ctx context.Context, k CorteDeMostrador) (cortes.Cobro, float64) {
	var largo, ancho *float64
	if k.PlacaLargoMm != nil && k.PlacaAnchoMm != nil {
		l, a := float64(*k.PlacaLargoMm), float64(*k.PlacaAnchoMm)
		largo, ancho = &l, &a
	}
	// La sierra va antes que la medida: la media placa sale de partirla con
	// ese disco (T4, hallazgo 23).
	sierra := sierraConfigurada(ctx, s.pool)
	medida := cortes.ResolverMedida(nil, nil, largo, ancho, k.Mitad, sierra)
	piezas := make([]cortes.PiezaAcortar, len(k.Piezas))
	conCanto := make([]cortes.PiezaConCanto, len(k.Piezas))
	for j, p := range k.Piezas {
		piezas[j] = cortes.PiezaAcortar{LargoMm: float64(p.LargoMm), AnchoMm: float64(p.AnchoMm), Cantidad: float64(p.Cantidad),
			RespetaVeta: float64(p.RespetaVeta), Etiqueta: p.Etiqueta, CantoLargo: float64(p.CantoLargo), CantoAncho: float64(p.CantoAncho)}
		conCanto[j] = cortes.PiezaConCanto{LargoMm: float64(p.LargoMm), AnchoMm: float64(p.AnchoMm), Cantidad: float64(p.Cantidad),
			CantoLargo: float64(p.CantoLargo), CantoAncho: float64(p.CantoAncho)}
	}
	d := cortes.DatosDelPlano{Piezas: piezas, PlacaLargo: medida.Largo, PlacaAncho: medida.Ancho, AnchoSierra: &sierra}
	if k.AcomodoManual != nil {
		d.Fijadas = cortes.LeerAcomodoManual(*k.AcomodoManual)
	}
	cobro := cortes.ACobrar(d)
	if cortes.MaterialSeCobra(ctx, s.pool) {
		cobro = cobro.ConMaterial()
	}
	if n := pasadasConfirmadas(ctx, s.pool, k); n > 0 && cobro.Pasadas > 0 {
		cobro.Pasadas = n
	}
	return cobro, cortes.MetrosDeTapacanto(conCanto)
}

// pasadasConfirmadas son las pasadas guardadas del corte de la cola que se
// cobra (las que confirmó el taller), si el despiece que llega es el suyo:
// la ficha dice esas (cortes.PasadasACobrar) y el mostrador cobraba las del
// plano, una más (tercera prueba, CRT-7302: 6 en la ficha, 7 al cobrar).
// Con el despiece cambiado, manda el plano. 0 si no hay.
func pasadasConfirmadas(ctx context.Context, db precios.Consultador, k CorteDeMostrador) int {
	if k.Existente == nil {
		return 0
	}
	var pasadas int
	var piezas []PiezaDeCorte
	var crudo []byte
	if err := db.QueryRow(ctx, `SELECT co.pasadas::int, coalesce((SELECT json_agg(json_build_object('largoMm', ci.largo_mm, 'anchoMm', ci.ancho_mm,
		  'cantidad', ci.cantidad, 'respetaVeta', ci.respeta_veta) ORDER BY ci.orden, ci.id) FROM cutting_items ci WHERE ci.cutting_order_id = co.id), '[]')
		FROM cutting_orders co WHERE co.id = $1 AND co.order_id IS NULL AND (co.estado <> 'cancelado' OR co.rehacer_de IS NOT NULL)`, *k.Existente).Scan(&pasadas, &crudo); err != nil {
		return 0
	}
	if json.Unmarshal(crudo, &piezas) != nil || !mismoDespiece(piezas, k.Piezas) {
		return 0
	}
	return pasadas
}

// mismoDespiece: las mismas piezas (medida, cantidad y veta), en cualquier orden.
func mismoDespiece(a, b []PiezaDeCorte) bool {
	if len(a) != len(b) {
		return false
	}
	cuenta := map[[4]int]int{}
	for _, p := range a {
		cuenta[[4]int{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta}]++
	}
	for _, p := range b {
		c := [4]int{p.LargoMm, p.AnchoMm, p.Cantidad, p.RespetaVeta}
		if cuenta[c] == 0 {
			return false
		}
		cuenta[c]--
	}
	return true
}

// sierraConfigurada es el disco de /admin/calculadora. El que manda el
// navegador (`anchoSierraMm`) no se cree: la pantalla ya no tiene el campo,
// y mandar 0,5 en vez de 4 acomodaba más piezas por placa, cobraba menos
// placas o pasadas sin PIN y le daba al taller un disco irreal (revisión
// del carril F). Lo usan el cobro del corte y el trabajo del taller.
func sierraConfigurada(ctx context.Context, c precios.Consultador) float64 {
	sierra := float64(cortes.AnchoDeSierraMm)
	_ = c.QueryRow(ctx, `SELECT ancho_sierra_mm::float8 FROM calculator_settings LIMIT 1`).Scan(&sierra)
	return sierra
}

// presentacionDeMitad es la presentación de la media placa de la que sale el
// corte (presentacionDeMitad del TS).
func presentacionDeMitad(mitad *string) *string {
	if mitad == nil {
		return nil
	}
	p := "media_" + *mitad
	return &p
}

func mismaPresentacion(a, b *string) bool {
	if a == nil || *a == "" {
		return b == nil
	}
	return b != nil && *a == *b
}

func fijo2ONulo(p *float64) *string {
	if p == nil {
		return nil
	}
	s := jsmath.Fijo2(*p)
	return &s
}

// listaConVentaja dice si la lista del cliente le da, en estos renglones,
// algún precio mejor que la general. Sin lista propia, no.
func listaConVentaja(ctx context.Context, c precios.Consultador, lineas []ventas.LineaDeVenta, lista precios.Lista) (bool, error) {
	if !lista.Diferenciada() {
		return false, nil
	}
	renglones := make([]precios.RenglonConVariante, len(lineas))
	for i, l := range lineas {
		renglones[i] = precios.RenglonConVariante{VariantID: l.VariantID, Presentacion: l.Presentacion}
	}
	propios, err := precios.PreciosDeLista(ctx, c, renglones, lista)
	if err != nil {
		return false, err
	}
	generales, err := precios.PreciosDeLista(ctx, c, renglones, precios.Lista{ID: lista.GeneralID, GeneralID: lista.GeneralID, FactorDerivado: 1})
	if err != nil {
		return false, err
	}
	for i := range renglones {
		if propios[i] != nil && (generales[i] == nil || *propios[i] < *generales[i]-0.005) {
			return true, nil
		}
	}
	return false, nil
}

// bajoElCosto es lo que la venta cobra por debajo del costo promedio de cada
// renglón (con el factor de la media placa), ya con el descuento repartido.
// Cero si ningún renglón queda abajo o no hay costos cargados.
func (s *Servicio) bajoElCosto(ctx context.Context, lineas []ventas.LineaDeVenta) (float64, error) {
	total := 0.0
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		conPres := make([]reservas.LineaConPresentacion, len(lineas))
		var variantes []string
		for i, l := range lineas {
			conPres[i] = reservas.LineaConPresentacion{VariantID: l.VariantID, Presentacion: l.Presentacion}
			if l.VariantID != nil {
				variantes = append(variantes, *l.VariantID)
			}
		}
		if len(variantes) == 0 {
			return nil
		}
		factores, err := reservas.FactoresDeStock(ctx, tx, conPres)
		if err != nil {
			return err
		}
		costos, err := reservas.CostosParaCongelar(ctx, tx, variantes)
		if err != nil {
			return err
		}
		for i, l := range lineas {
			if l.VariantID == nil {
				continue
			}
			k, ok := costos[*l.VariantID]
			if !ok || k.CostoUnitario == nil {
				continue
			}
			c := reservas.CostoPorUnidadDeVenta(k.CostoUnitario, factores[i].StockPorUnidad)
			if dif := jsmath.Numero(*c) - l.PrecioUnitario; dif > 0.005 {
				total += ventas.ACentavos(float64(dif * l.Cantidad))
			}
		}
		return nil
	})
	return ventas.ACentavos(total), err
}

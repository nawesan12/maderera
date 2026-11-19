package mostrador

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cortes"
	"mjbj/internal/jsmath"
	"mjbj/internal/precios"
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
	}
	for _, p := range v.Pagos {
		escribir(p.Medio, num(p.Importe))
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
	if len(v.Cortes) != 1 {
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
	noCierra := "El corte de " + k.MaterialDescripcion + " no cierra con su plano. Abrilo de nuevo y volvé a agregarlo."
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
		return noCierra, nil
	}
	// El canto se mide en metros con dos decimales (MetrosDeTapacanto): una
	// diferencia de redondeo no es canto de más ni de menos.
	if (hayCanto || (tarifa != nil && tarifa.PrecioPorMetroCanto > 0)) && math.Abs(metrosDelPlano-metros) > 0.005 {
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
	sierra := float64(cortes.AnchoDeSierraMm)
	_ = s.pool.QueryRow(ctx, `SELECT ancho_sierra_mm::float8 FROM calculator_settings LIMIT 1`).Scan(&sierra)
	if k.AnchoSierraMm != nil {
		if a := cortes.LeerAnchoDeSierra(jsmath.Texto(*k.AnchoSierraMm)); a != nil {
			sierra = *a
		}
	}
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
	return cortes.ACobrar(d), cortes.MetrosDeTapacanto(conCanto)
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

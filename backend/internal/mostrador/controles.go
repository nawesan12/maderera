package mostrador

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"

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

// faltaDelCorte vuelve a calcular lo que se cobra del corte (cortes.ACobrar)
// y devuelve, en plata de lista, lo que los renglones de la venta no traen:
// placas de material de menos o pasadas de menos. Acomodar a mano las piezas
// para que cada placa quede por debajo de la mitad ya no deja de cobrar el
// material (T3, hallazgo 11).
//
// El material son los renglones de la variante de la placa con la
// presentación del corte (media o entera); las pasadas, los renglones sin
// variante en «pasada». La pasada que falta se valúa al precio de la pasada
// de la venta; sin ese renglón, no hay contra qué (una pasada sin tarifa no
// se cobraba nunca).
func (s *Servicio) faltaDelCorte(ctx context.Context, v VentaPedida, lista precios.Lista) (float64, error) {
	k := v.Corte
	if k == nil || len(k.Piezas) == 0 {
		return 0, nil
	}
	var largo, ancho *float64
	if k.PlacaLargoMm != nil && k.PlacaAnchoMm != nil {
		l, a := float64(*k.PlacaLargoMm), float64(*k.PlacaAnchoMm)
		largo, ancho = &l, &a
	}
	medida := cortes.ResolverMedida(nil, nil, largo, ancho, k.Mitad)
	sierra := float64(cortes.AnchoDeSierraMm)
	_ = s.pool.QueryRow(ctx, `SELECT ancho_sierra_mm::float8 FROM calculator_settings LIMIT 1`).Scan(&sierra)
	if k.AnchoSierraMm != nil {
		if a := cortes.LeerAnchoDeSierra(jsmath.Texto(*k.AnchoSierraMm)); a != nil {
			sierra = *a
		}
	}
	piezas := make([]cortes.PiezaAcortar, len(k.Piezas))
	for i, p := range k.Piezas {
		piezas[i] = cortes.PiezaAcortar{LargoMm: float64(p.LargoMm), AnchoMm: float64(p.AnchoMm), Cantidad: float64(p.Cantidad),
			RespetaVeta: float64(p.RespetaVeta), Etiqueta: p.Etiqueta, CantoLargo: float64(p.CantoLargo), CantoAncho: float64(p.CantoAncho)}
	}
	d := cortes.DatosDelPlano{Piezas: piezas, PlacaLargo: medida.Largo, PlacaAncho: medida.Ancho, AnchoSierra: &sierra}
	if k.AcomodoManual != nil {
		d.Fijadas = cortes.LeerAcomodoManual(*k.AcomodoManual)
	}
	cobro := cortes.ACobrar(d)

	presentacion := presentacionDeMitad(k.Mitad)
	placas, pasadas, precioPasada := 0.0, 0.0, 0.0
	for _, l := range v.Lineas {
		switch {
		case k.VariantID != nil && l.VariantID != nil && *l.VariantID == *k.VariantID && mismaPresentacion(l.Presentacion, presentacion):
			placas += l.Cantidad
		case l.VariantID == nil && l.Unidad == "pasada":
			pasadas += l.Cantidad
			precioPasada = l.PrecioUnitario
		}
	}
	falta := 0.0
	if f := float64(cobro.Placas) - placas; f > 0 && k.VariantID != nil {
		listas, err := precios.PreciosDeLista(ctx, s.pool, []precios.RenglonConVariante{{VariantID: k.VariantID, Presentacion: presentacion}}, lista)
		if err != nil {
			return 0, err
		}
		if listas[0] != nil {
			falta += float64(f * *listas[0])
		}
	}
	if f := float64(cobro.Pasadas) - pasadas; f > 0 {
		falta += float64(f * precioPasada)
	}
	return ventas.ACentavos(falta), nil
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

package facturacion

import (
	"context"
	"time"

	"mjbj/internal/compras"
	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
)

// LibroIvaDigital junta los comprobantes del mes para los archivos de la RG
// 4597 (fiscal/libroiva.go). Ventas: lo mismo que el libro IVA ventas (solo
// lo que tiene CAE), con el IVA por alícuota reagrupado desde los renglones
// como se mandó a ARCA. Compras: lo mismo que el libro de compras (sin las
// anuladas). Devuelve también lo que no se pudo informar.
func (s *Servicio) LibroIvaDigital(ctx context.Context, desde, hasta time.Time) (ventas, compras []fiscal.ComprobanteDelLibro, omitidos []string, err error) {
	if ventas, err = s.ventasDelLibroDigital(ctx, desde, hasta); err != nil {
		return nil, nil, nil, err
	}
	if compras, omitidos, err = s.comprasDelLibroDigital(ctx, desde, hasta); err != nil {
		return nil, nil, nil, err
	}
	fiscal.OrdenarLibro(ventas)
	fiscal.OrdenarLibro(compras)
	return ventas, compras, omitidos, nil
}

func (s *Servicio) ventasDelLibroDigital(ctx context.Context, desde, hasta time.Time) ([]fiscal.ComprobanteDelLibro, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, fecha_emision, tipo::text, punto_venta, numero, receptor_nombre, receptor_cuit,
		exento::float8, total::float8 FROM invoices WHERE fecha_emision >= $1 AND fecha_emision <= $2 AND cae IS NOT NULL
		ORDER BY fecha_emision, numero`, desde, hasta)
	if err != nil {
		return nil, err
	}
	var lista []fiscal.ComprobanteDelLibro
	indice := map[string]int{}
	for filas.Next() {
		var id, tipo string
		var c fiscal.ComprobanteDelLibro
		if err := filas.Scan(&id, &c.Fecha, &tipo, &c.PuntoVenta, &c.Numero, &c.Nombre, &c.Documento, &c.Exento, &c.Total); err != nil {
			filas.Close()
			return nil, err
		}
		c.Codigo = fiscal.CodigoComprobante[tipo]
		// La C no discrimina: en WSFE va todo como neto, sin exento ni IVA.
		c.Discrimina = fiscal.LetraDe(tipo) != "C"
		if !c.Discrimina {
			c.Exento = 0
		}
		indice[id] = len(lista)
		lista = append(lista, c)
	}
	filas.Close()
	if err := filas.Err(); err != nil || len(lista) == 0 {
		return lista, err
	}
	ids := make([]string, 0, len(indice))
	for id := range indice {
		ids = append(ids, id)
	}

	filas, err = s.pool.Query(ctx, `SELECT invoice_id, alicuota_iva::float8, neto::float8, iva::float8 FROM invoice_items
		WHERE invoice_id = ANY($1::uuid[]) ORDER BY invoice_id, orden`, ids)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var id string
		var alic, neto, iva float64
		if err := filas.Scan(&id, &alic, &neto, &iva); err != nil {
			filas.Close()
			return nil, err
		}
		c := &lista[indice[id]]
		if c.Discrimina {
			c.Alicuotas = fiscal.AgruparIva(c.Alicuotas, alic, neto, iva)
		}
	}
	filas.Close()
	if err := filas.Err(); err != nil {
		return nil, err
	}

	filas, err = s.pool.Query(ctx, `SELECT invoice_id, codigo, importe::float8 FROM invoice_tributos WHERE invoice_id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var id, codigo string
		var importe float64
		if err := filas.Scan(&id, &codigo, &importe); err != nil {
			return nil, err
		}
		fiscal.TributosDeVenta(&lista[indice[id]], codigo, importe)
	}
	return lista, filas.Err()
}

func (s *Servicio) comprasDelLibroDigital(ctx context.Context, desde, hasta time.Time) ([]fiscal.ComprobanteDelLibro, []string, error) {
	filas, err := s.pool.Query(ctx, `
		SELECT f.fecha_emision, f.tipo::text, f.punto_venta, f.numero, s.nombre, s.cuit,
		  f.neto::float8, f.iva21::float8, f.iva105::float8, f.iva27::float8, f.exento::float8, f.percepciones::float8,
		  f.percepcion_iva::float8, f.percepcion_iibb::float8, f.total::float8
		FROM purchase_invoices f JOIN suppliers s ON s.id = f.supplier_id
		WHERE f.fecha_emision >= $1 AND f.fecha_emision <= $2 AND f.anulada_at IS NULL
		ORDER BY f.fecha_emision, f.numero`, desde, hasta)
	if err != nil {
		return nil, nil, err
	}
	defer filas.Close()
	var lista []fiscal.ComprobanteDelLibro
	var omitidos []string
	for filas.Next() {
		var tipo string
		var pv, n int32
		var neto, i21, i105, i27, perc, pIva, pIibb float64
		var c fiscal.ComprobanteDelLibro
		if err := filas.Scan(&c.Fecha, &tipo, &pv, &n, &c.Nombre, &c.Documento, &neto, &i21, &i105, &i27, &c.Exento, &perc,
			&pIva, &pIibb, &c.Total); err != nil {
			return nil, nil, err
		}
		c.PuntoVenta, c.Numero = int64(pv), int64(n)
		codigo, ok := fiscal.CodigoComprobanteCompra[tipo]
		if !ok {
			omitidos = append(omitidos, fiscal.FechaArca(c.Fecha)+" "+compras.NombreComprobanteCompra(tipo)+" "+
				compras.NumeroDeCompra(c.PuntoVenta, c.Numero)+" "+c.Nombre+" "+jsmath.Fijo2(c.Total))
			continue
		}
		c.Codigo = codigo
		c.PercepcionIva, c.PercepcionIibb = pIva, pIibb
		// Las de antes de la 00101 traen el total sin discriminar.
		if resto := jsmath.Redondear2(perc - pIva - pIibb); resto > 0 {
			c.OtrosTributos = resto
		}
		c.Discrimina = compras.DaCreditoFiscal(tipo) || tipo == "factura_m"
		if c.Discrimina {
			c.Alicuotas = fiscal.NetosDeCompra(neto, i21, i105, i27)
			c.CreditoFiscal = jsmath.Redondear2(i21 + i105 + i27)
		}
		lista = append(lista, c)
	}
	return lista, omitidos, filas.Err()
}

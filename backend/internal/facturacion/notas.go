package facturacion

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
)

// Las notas de crédito y de débito (emitirNotaDeCredito,
// anularConNotaDeCredito y emitirNotaDeDebito). Todo en una transacción: la
// nota, el acreditado del original y el movimiento de cuenta corriente.

type original struct {
	id, tipo, estado, receptorNombre, condicion string
	puntoVenta, numero                          int64
	customerID, orderID, receptorCuit           *string
	receptorDomicilio, puntoVentaID, cae        *string
	caeAmbiente                                 *string
	neto, iva21, iva105, iva27, exento          float64
	total, acreditado, debitado                 float64
}

func bloquearOriginal(ctx context.Context, tx pgx.Tx, id string) (*original, error) {
	var o original
	err := tx.QueryRow(ctx, `SELECT id, tipo::text, estado::text, receptor_nombre, receptor_condicion_iva::text, punto_venta, numero,
		customer_id, order_id, receptor_cuit, receptor_domicilio, punto_venta_id, neto::float8, iva21::float8, iva105::float8,
		iva27::float8, exento::float8, total::float8, acreditado::float8, debitado::float8, cae, cae_ambiente
		FROM invoices WHERE id = $1 FOR UPDATE`, id).Scan(&o.id, &o.tipo, &o.estado, &o.receptorNombre, &o.condicion, &o.puntoVenta,
		&o.numero, &o.customerID, &o.orderID, &o.receptorCuit, &o.receptorDomicilio, &o.puntoVentaID, &o.neto, &o.iva21, &o.iva105,
		&o.iva27, &o.exento, &o.total, &o.acreditado, &o.debitado, &o.cae, &o.caeAmbiente)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &o, err
}

// sinCAE es el motivo para no anular ni hacer notas sobre un comprobante que
// ARCA no autorizó. Una nota necesita el asociado autorizado (ARCA la
// rechaza), y anularlo lo dejaba «anulado sin CAE»: un número que ARCA sigue
// esperando y que ya no se puede mandar, con la serie trabada detrás. Lo que
// no tiene CAE se da de baja (DarDeBaja).
const sinCAE = "Sin CAE no hay nada que anular: dalo de baja."

// NotaDeCredito emite una nota de crédito, entera (parciales nil) o parcial.
// Una parcial no anula el original ni llegando al 100 %: anular es explícito.
//
// Lo que se emite es el reverso del original (fiscal.Reverso): una nota de
// crédito para una factura o una nota de débito, y una nota de débito para
// revertir una nota de crédito. El signo en la cuenta corriente acompaña al
// tipo que sale.
//
// La parcial sobre una factura de una venta no va por acá: la nota sola no
// devuelve ni stock ni plata, y eso es DevolucionParcial. La que anula sí
// (Anular): la venta ya se anuló con su stock y su plata.
func (s *Servicio) NotaDeCredito(ctx context.Context, invoiceID, motivo string, userID *string, parciales []fiscal.CantidadAAcreditar, anular bool) (string, error) {
	var nueva string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		o, err := bloquearOriginal(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		if err := s.puedeLlevarNota(o); err != nil {
			return err
		}
		if parciales != nil && !anular && o.orderID != nil && fiscal.EsFactura(o.tipo) {
			return errEmision("Es de una venta: usá Devolución.")
		}
		var total float64
		nueva, total, err = s.notaEnTransaccion(ctx, tx, o, motivo, userID, parciales, anular)
		if err != nil {
			return err
		}
		// La nota devuelve lo que la factura cargó, solo si la factura cargó
		// deuda (no tiene pedido detrás): un movimiento nuevo, no un borrado.
		if o.customerID != nil && o.orderID == nil {
			et := etiqueta(o.tipo, o.puntoVenta, o.numero)
			// Revertir una nota de crédito vuelve a cargar la deuda.
			tipoMov, monto, nombre := "nota_credito", -total, "Nota de crédito"
			if !fiscal.EsNotaDeCredito(fiscal.Reverso(o.tipo)) {
				tipoMov, monto, nombre = "nota_debito", total, "Nota de débito"
			}
			detalle := "Anulación de " + et + ": " + motivo
			if parciales != nil {
				detalle = nombre + " parcial sobre " + et + ": " + motivo
			}
			if _, err := tx.Exec(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, $2::tipo_movimiento_cuenta, $3::numeric, $4, $5, $6)`, *o.customerID, tipoMov, jsmath.Fijo2(monto), detalle, et, userID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", s.comoEmision(err, "fiscal.nota-credito", "No se pudo emitir la nota de crédito.")
	}
	return nueva, nil
}

// puedeLlevarNota es por qué no se le puede hacer una nota a ese original.
//
// El ambiente va en los dos sentidos: una nota de producción sobre un CAE de
// homologación anularía ante ARCA algo que ARCA nunca vio, y una de prueba
// sobre uno real no corrige nada. Sin ambiente guardado (los de antes, las
// pruebas) no se mira.
func (s *Servicio) puedeLlevarNota(o *original) error {
	switch {
	case o == nil:
		return errEmision("No encontramos el comprobante.")
	case o.estado == "anulada":
		return errEmision("Ese comprobante ya está anulado.")
	case o.estado == "borrador":
		return errEmision("Un borrador no necesita nota de crédito.")
	case o.cae == nil:
		return errEmision(sinCAE)
	}
	if o.caeAmbiente != nil && s.env != nil {
		if cfg := s.env.Leer(); cfg != nil && cfg.Ambiente != "" && cfg.Ambiente != *o.caeAmbiente {
			if *o.caeAmbiente == "homologacion" {
				return errEmision("Ese CAE es de homologación: no tiene valor fiscal y no lleva nota en producción.")
			}
			return errEmision("Ese CAE es de producción y ARCA está en homologación: la nota no tendría valor.")
		}
	}
	return nil
}

// notaEnTransaccion emite la nota (el reverso del original) dentro de la
// transacción que ya bloqueó el original, y le suma lo acreditado. Devuelve
// la nota y su total. Lo que la nota mueve afuera (la cuenta, el stock, la
// caja) lo decide quien llama.
func (s *Servicio) notaEnTransaccion(ctx context.Context, tx pgx.Tx, o *original, motivo string, userID *string,
	parciales []fiscal.CantidadAAcreditar, anular bool) (string, float64, error) {
	items, err := itemsOriginales(ctx, tx, o.id)
	if err != nil {
		return "", 0, err
	}
	// Lo que ya devolvieron otras notas: el tope de cada renglón es lo
	// que queda (el original está bloqueado, así que dos notas a la vez
	// se ven una a la otra).
	acreditadas, err := yaAcreditado(ctx, tx, o.id)
	if err != nil {
		return "", 0, err
	}
	for k := range items {
		a := acreditadas[items[k].ID]
		items[k].Acreditado, items[k].AcreditadoImporte = a.cantidad, a.importe
	}
	tributos, err := tributosDe(ctx, tx, o.id)
	if err != nil {
		return "", 0, err
	}
	devueltos, err := tributosDevueltos(ctx, tx, o.id)
	if err != nil {
		return "", 0, err
	}
	calc := fiscal.CalcularNota(fiscal.Original{Neto: o.neto, Iva21: o.iva21, Iva105: o.iva105, Iva27: o.iva27, Exento: o.exento,
		Total: o.total, Acreditado: o.acreditado, TributosDevueltos: devueltos}, items, parciales, tributos)
	if calc.Problema != "" {
		return "", 0, errEmision(calc.Problema)
	}
	lineas := make([]Linea, len(calc.Lineas))
	for i, l := range calc.Lineas {
		unidad, alic, origen := l.Unidad, l.Alicuota, l.ItemOrigenID
		lineas[i] = Linea{LineaEntrada: fiscal.LineaEntrada{Descripcion: l.Descripcion, Unidad: &unidad, Cantidad: l.Cantidad,
			PrecioFinalUnitario: l.PrecioFinalUnitario, Alicuota: &alic}, ItemOrigenID: &origen}
	}
	dados := calc.TributosDados
	if dados == nil {
		dados = []fiscal.Tributo{}
	}
	nueva, err := s.EmitirEnTransaccion(ctx, tx, DatosEmision{CustomerID: o.customerID, OrderID: o.orderID, ReceptorNombre: o.receptorNombre,
		ReceptorCuit: o.receptorCuit, ReceptorCondicionIva: o.condicion, ReceptorDomicilio: o.receptorDomicilio, PuntoVentaID: o.puntoVentaID,
		ComprobanteOrigenID: &o.id, Observaciones: &motivo, CreatedByUserID: userID, TributosDados: dados, Lineas: lineas},
		fiscal.Reverso(o.tipo))
	if err != nil {
		return "", 0, err
	}
	estado := ""
	if anular {
		estado = "anulada"
	}
	if _, err := tx.Exec(ctx, `UPDATE invoices SET acreditado = $2::numeric, estado = coalesce(nullif($3, '')::estado_comprobante, estado),
		updated_at = now() WHERE id = $1`, o.id, jsmath.Fijo2(fiscal.Redondear(o.acreditado+calc.Total)), estado); err != nil {
		return "", 0, err
	}
	return nueva, calc.Total, nil
}

// tributosDevueltos son, por código, los tributos de las notas vivas que
// revierten el original.
func tributosDevueltos(ctx context.Context, c consultor, invoiceID string) (map[string]fiscal.Tributo, error) {
	filas, err := c.Query(ctx, `SELECT t.codigo, sum(t.base_imponible)::float8, sum(t.importe)::float8 FROM invoice_tributos t
		JOIN invoices f ON f.id = t.invoice_id JOIN invoices o ON o.id = f.comprobante_origen_id
		WHERE f.comprobante_origen_id = $1 AND f.estado <> 'anulada'
		AND (f.tipo::text LIKE 'nota_credito%') <> (o.tipo::text LIKE 'nota_credito%')
		GROUP BY t.codigo`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := map[string]fiscal.Tributo{}
	for filas.Next() {
		var t fiscal.Tributo
		if err := filas.Scan(&t.Codigo, &t.Base, &t.Importe); err != nil {
			return nil, err
		}
		out[t.Codigo] = t
	}
	return out, filas.Err()
}

// acreditadoDeRenglon es cuánto de un renglón del original ya revirtieron
// sus notas: la cantidad y la plata (la suma de sus subtotales).
type acreditadoDeRenglon struct{ cantidad, importe float64 }

// yaAcreditado es cuánto de cada renglón del original ya revirtieron sus
// notas vivas (las que tienen el renglón de origen: la nota de crédito de una
// factura o la de débito que revierte una nota de crédito).
func yaAcreditado(ctx context.Context, c consultor, invoiceID string) (map[string]acreditadoDeRenglon, error) {
	filas, err := c.Query(ctx, `SELECT i.invoice_item_origen_id, sum(i.cantidad)::text, sum(i.subtotal)::text FROM invoice_items i
		JOIN invoices f ON f.id = i.invoice_id JOIN invoices o ON o.id = f.comprobante_origen_id
		WHERE f.comprobante_origen_id = $1 AND f.estado <> 'anulada' AND i.invoice_item_origen_id IS NOT NULL
		AND (f.tipo::text LIKE 'nota_credito%') <> (o.tipo::text LIKE 'nota_credito%')
		GROUP BY i.invoice_item_origen_id`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	acreditadas := map[string]acreditadoDeRenglon{}
	for filas.Next() {
		var origen, cantidad, importe string
		if err := filas.Scan(&origen, &cantidad, &importe); err != nil {
			return nil, err
		}
		acreditadas[origen] = acreditadoDeRenglon{jsmath.Numero(cantidad), jsmath.Numero(importe)}
	}
	return acreditadas, filas.Err()
}

func itemsOriginales(ctx context.Context, c consultor, id string) ([]fiscal.ItemOriginal, error) {
	filas, err := c.Query(ctx, `SELECT id, descripcion, unidad, cantidad::float8, subtotal::float8, alicuota_iva::float8
		FROM invoice_items WHERE invoice_id = $1 ORDER BY orden`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []fiscal.ItemOriginal{}
	for filas.Next() {
		var i fiscal.ItemOriginal
		if err := filas.Scan(&i.ID, &i.Descripcion, &i.Unidad, &i.Cantidad, &i.Subtotal, &i.AlicuotaIva); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, filas.Err()
}

func tributosDe(ctx context.Context, c consultor, id string) ([]fiscal.Tributo, error) {
	filas, err := c.Query(ctx, `SELECT codigo, descripcion, base_imponible::float8, alicuota::float8, importe::float8
		FROM invoice_tributos WHERE invoice_id = $1`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []fiscal.Tributo{}
	for filas.Next() {
		var t fiscal.Tributo
		if err := filas.Scan(&t.Codigo, &t.Descripcion, &t.Base, &t.Alicuota, &t.Importe); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, filas.Err()
}

// Anular es anularConNotaDeCredito: una nota por lo que falte acreditar, que
// además anula el original. Si notas parciales ya acreditaron todo, solo
// cambia el estado (y devuelve el id del original).
func (s *Servicio) Anular(ctx context.Context, invoiceID, motivo string, userID *string) (string, error) {
	var restante []fiscal.CantidadAAcreditar
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		// El atajo de abajo cambia el estado sin pasar por NotaDeCredito:
		// el CAE se mira acá también.
		o, err := bloquearOriginal(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		switch {
		case o == nil:
			return errEmision("No encontramos el comprobante.")
		case o.estado == "anulada":
			return errEmision("Ese comprobante ya está anulado.")
		case o.cae == nil:
			return errEmision(sinCAE)
		}
		acreditadas, err := yaAcreditado(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		if len(acreditadas) == 0 {
			return nil
		}
		items, err := itemsOriginales(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		restante = []fiscal.CantidadAAcreditar{}
		for _, i := range items {
			if c := i.Cantidad - acreditadas[i.ID].cantidad; c > 0 {
				restante = append(restante, fiscal.CantidadAAcreditar{ItemID: i.ID, Cantidad: c})
			}
		}
		return nil
	})
	if err != nil {
		return "", s.comoEmision(err, "fiscal.anular", "No se pudo anular el comprobante.")
	}
	if restante != nil && len(restante) == 0 {
		// Ya acreditada entera: el papel está corregido, falta el estado.
		if _, err := s.pool.Exec(ctx, `UPDATE invoices SET estado = 'anulada', updated_at = now() WHERE id = $1 AND cae IS NOT NULL`, invoiceID); err != nil {
			return "", err
		}
		return invoiceID, nil
	}
	return s.NotaDeCredito(ctx, invoiceID, motivo, userID, restante, true)
}

// NotaDeDebito le carga algo más al cliente sobre un comprobante emitido (un
// flete olvidado, intereses). No toca `acreditado` y nunca anula.
func (s *Servicio) NotaDeDebito(ctx context.Context, invoiceID, motivo string, lineas []Linea, userID *string) (string, error) {
	if len(lineas) == 0 {
		return "", errEmision("La nota de débito no tiene ningún renglón cargado.")
	}
	var nueva string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		o, err := bloquearOriginal(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		switch {
		case o == nil:
			return errEmision("No encontramos el comprobante.")
		case o.estado == "borrador":
			return errEmision("Un borrador no se puede debitar.")
		case o.estado == "anulada":
			return errEmision("Ese comprobante está anulado: no se le puede cargar nada encima.")
		case o.cae == nil:
			return errEmision(sinCAE)
		}
		nueva, err = s.EmitirEnTransaccion(ctx, tx, DatosEmision{CustomerID: o.customerID, OrderID: o.orderID, ReceptorNombre: o.receptorNombre,
			ReceptorCuit: o.receptorCuit, ReceptorCondicionIva: o.condicion, ReceptorDomicilio: o.receptorDomicilio, PuntoVentaID: o.puntoVentaID,
			ComprobanteOrigenID: &o.id, Observaciones: &motivo, CreatedByUserID: userID, Lineas: lineas}, fiscal.NotaDeDebito(o.tipo))
		if err != nil {
			return err
		}
		entradas := make([]fiscal.LineaEntrada, len(lineas))
		for i, l := range lineas {
			entradas[i] = l.LineaEntrada
		}
		total := fiscal.TotalDeLineas(entradas)
		if _, err := tx.Exec(ctx, `UPDATE invoices SET debitado = $2::numeric, updated_at = now() WHERE id = $1`,
			invoiceID, jsmath.Fijo2(fiscal.Redondear(o.debitado+total))); err != nil {
			return err
		}
		if o.customerID != nil && o.orderID == nil {
			et := etiqueta(o.tipo, o.puntoVenta, o.numero)
			if _, err := tx.Exec(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
				VALUES ($1, 'nota_debito', $2::numeric, $3, $4, $5)`, *o.customerID, jsmath.Fijo2(total),
				"Nota de débito sobre "+et+": "+motivo, et, userID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", s.comoEmision(err, "fiscal.nota-debito", "No se pudo emitir la nota de débito.")
	}
	return nueva, nil
}

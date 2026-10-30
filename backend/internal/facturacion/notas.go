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
	receptorDomicilio, puntoVentaID             *string
	neto, iva21, iva105, iva27, exento          float64
	total, acreditado, debitado                 float64
}

func bloquearOriginal(ctx context.Context, tx pgx.Tx, id string) (*original, error) {
	var o original
	err := tx.QueryRow(ctx, `SELECT id, tipo::text, estado::text, receptor_nombre, receptor_condicion_iva::text, punto_venta, numero,
		customer_id, order_id, receptor_cuit, receptor_domicilio, punto_venta_id, neto::float8, iva21::float8, iva105::float8,
		iva27::float8, exento::float8, total::float8, acreditado::float8, debitado::float8
		FROM invoices WHERE id = $1 FOR UPDATE`, id).Scan(&o.id, &o.tipo, &o.estado, &o.receptorNombre, &o.condicion, &o.puntoVenta,
		&o.numero, &o.customerID, &o.orderID, &o.receptorCuit, &o.receptorDomicilio, &o.puntoVentaID, &o.neto, &o.iva21, &o.iva105,
		&o.iva27, &o.exento, &o.total, &o.acreditado, &o.debitado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &o, err
}

// NotaDeCredito emite una nota de crédito, entera (parciales nil) o parcial.
// Una parcial no anula el original ni llegando al 100 %: anular es explícito.
//
// Lo que se emite es el reverso del original (fiscal.Reverso): una nota de
// crédito para una factura o una nota de débito, y una nota de débito para
// revertir una nota de crédito. El signo en la cuenta corriente acompaña al
// tipo que sale.
func (s *Servicio) NotaDeCredito(ctx context.Context, invoiceID, motivo string, userID *string, parciales []fiscal.CantidadAAcreditar, anular bool) (string, error) {
	var nueva string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		o, err := bloquearOriginal(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		switch {
		case o == nil:
			return errEmision("No encontramos el comprobante.")
		case o.estado == "anulada":
			return errEmision("Ese comprobante ya está anulado.")
		case o.estado == "borrador":
			return errEmision("Un borrador no necesita nota de crédito.")
		}
		items, err := itemsOriginales(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		// Lo que ya devolvieron otras notas: el tope de cada renglón es lo
		// que queda (el original está bloqueado, así que dos notas a la vez
		// se ven una a la otra).
		acreditadas, err := yaAcreditado(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		for k := range items {
			items[k].Acreditado = acreditadas[items[k].ID]
		}
		tributos, err := tributosDe(ctx, tx, invoiceID)
		if err != nil {
			return err
		}
		calc := fiscal.CalcularNota(fiscal.Original{Neto: o.neto, Iva21: o.iva21, Iva105: o.iva105, Iva27: o.iva27, Exento: o.exento,
			Total: o.total, Acreditado: o.acreditado}, items, parciales, tributos)
		if calc.Problema != "" {
			return errEmision(calc.Problema)
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
		nueva, err = s.EmitirEnTransaccion(ctx, tx, DatosEmision{CustomerID: o.customerID, OrderID: o.orderID, ReceptorNombre: o.receptorNombre,
			ReceptorCuit: o.receptorCuit, ReceptorCondicionIva: o.condicion, ReceptorDomicilio: o.receptorDomicilio, PuntoVentaID: o.puntoVentaID,
			ComprobanteOrigenID: &o.id, Observaciones: &motivo, CreatedByUserID: userID, TributosDados: dados, Lineas: lineas},
			fiscal.Reverso(o.tipo))
		if err != nil {
			return err
		}
		estado := ""
		if anular {
			estado = "anulada"
		}
		if _, err := tx.Exec(ctx, `UPDATE invoices SET acreditado = $2::numeric, estado = coalesce(nullif($3, '')::estado_comprobante, estado),
			updated_at = now() WHERE id = $1`, invoiceID, jsmath.Fijo2(fiscal.Redondear(o.acreditado+calc.Total)), estado); err != nil {
			return err
		}
		// La nota devuelve lo que la factura cargó, solo si la factura cargó
		// deuda (no tiene pedido detrás): un movimiento nuevo, no un borrado.
		if o.customerID != nil && o.orderID == nil {
			et := etiqueta(o.tipo, o.puntoVenta, o.numero)
			// Revertir una nota de crédito vuelve a cargar la deuda.
			tipoMov, monto, nombre := "nota_credito", -calc.Total, "Nota de crédito"
			if !fiscal.EsNotaDeCredito(fiscal.Reverso(o.tipo)) {
				tipoMov, monto, nombre = "nota_debito", calc.Total, "Nota de débito"
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

// yaAcreditado es cuánto de cada renglón del original ya revirtieron sus
// notas vivas (las que tienen el renglón de origen: la nota de crédito de una
// factura o la de débito que revierte una nota de crédito).
func yaAcreditado(ctx context.Context, c consultor, invoiceID string) (map[string]float64, error) {
	filas, err := c.Query(ctx, `SELECT i.invoice_item_origen_id, sum(i.cantidad)::text FROM invoice_items i
		JOIN invoices f ON f.id = i.invoice_id JOIN invoices o ON o.id = f.comprobante_origen_id
		WHERE f.comprobante_origen_id = $1 AND f.estado <> 'anulada' AND i.invoice_item_origen_id IS NOT NULL
		AND (f.tipo::text LIKE 'nota_credito%') <> (o.tipo::text LIKE 'nota_credito%')
		GROUP BY i.invoice_item_origen_id`, invoiceID)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	acreditadas := map[string]float64{}
	for filas.Next() {
		var origen, suma string
		if err := filas.Scan(&origen, &suma); err != nil {
			return nil, err
		}
		acreditadas[origen] = jsmath.Numero(suma)
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
			if c := i.Cantidad - acreditadas[i.ID]; c > 0 {
				restante = append(restante, fiscal.CantidadAAcreditar{ItemID: i.ID, Cantidad: c})
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if restante != nil && len(restante) == 0 {
		// Ya acreditada entera: el papel está corregido, falta el estado.
		if _, err := s.pool.Exec(ctx, `UPDATE invoices SET estado = 'anulada', updated_at = now() WHERE id = $1`, invoiceID); err != nil {
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

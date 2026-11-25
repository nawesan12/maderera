package facturacion

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/fiscal"
	"mjbj/internal/jsmath"
	"mjbj/internal/sqlc"
)

// La baja de un comprobante que ARCA no autorizó.
//
// ARCA autoriza cada punto de venta y tipo en orden y no deja saltear
// números. Un comprobante que no sale —rechazado por algo que no es del
// receptor, emitido con la letra equivocada, anulado sin CAE antes de que eso
// se frenara— traba a todos los que vienen detrás, para siempre. Para ARCA
// ese número no se usó: la salida es sacarlo de la serie y correr los
// pendientes un lugar para abajo, así el siguiente que ARCA espera vuelve a
// existir.
//
// **Se borra la fila, no se vacía el número.** Hay decenas de lecturas de
// `invoices` que esperan un número; un comprobante sin número sería un caso
// nuevo en cada una. Lo que era queda entero en `invoices_dadas_de_baja`
// (cabecera, renglones, tributos, cobros, movimientos de cuenta y lo que
// contestó ARCA), con quién, cuándo y por qué, y se lista en Facturación.
//
// Lo que frena la baja, cada cosa con su mensaje:
//   - que tenga CAE, o que sea un borrador;
//   - que un posterior de la serie tenga CAE (ARCA ya pasó ese número);
//   - que tenga notas encima (se dan de baja primero);
//   - que sea la nota de una devolución (la plata y el stock ya se movieron);
//   - que tenga cobros: con recibo vivo se anula el recibo primero, a la
//     vista, y sin recibo con un medio de plata serían el único rastro de
//     esa plata, que se iría con el borrado. El pase a cuenta corriente no
//     frena: no es plata, es la marca de que la deuda quedó en la cuenta, y
//     esa deuda (el movimiento de la emisión) ya se va con la baja;
//   - que ARCA ya tenga el número (se reintenta: recupera el CAE).
//
// Nada se renumera ni se da de baja solo: lo hace el admin, con motivo, y
// sobre la lista de corridos que vio (si entró un comprobante mientras
// escribía el motivo, la baja no sigue).
//
// La baja de una nota deshace lo que la nota le hizo al original: le resta
// lo acreditado o debitado, le devuelve el estado si la nota lo había anulado
// y borra el movimiento de cuenta que cargó. Si no, una factura con CAE
// quedaba «anulada» sin ninguna nota detrás y el cliente con un crédito que
// ARCA nunca autorizó.

// Corrimiento es un comprobante pendiente que baja un número.
type Corrimiento struct {
	InvoiceID      string  `json:"invoiceId"`
	De             int64   `json:"de"`
	A              int64   `json:"a"`
	ReceptorNombre string  `json:"receptorNombre"`
	CustomerID     *string `json:"customerId"`
	// Recibos son los recibos vivos que cobraron el corrido: su concepto
	// nombraba el número viejo y se corrigió; el cliente tiene el papel con
	// el número viejo y hay que reenviárselo.
	Recibos []string `json:"recibos,omitempty"`
}

// SerieDelComprobante es lo que la ficha de un comprobante sin CAE muestra
// antes de reintentar o de dar de baja.
type SerieDelComprobante struct {
	// Los anteriores sin CAE que se autorizan antes que este al reintentar.
	AnterioresSinCae int `json:"anterioresSinCae"`
	// Con más de maxAnteriores atrás, el pedido de CAE no sale: la serie se
	// autoriza de a tramos, empezando por este (el que tiene justo
	// maxAnteriores sin CAE antes). nil si no hace falta.
	Tramo *TramoDeLaSerie `json:"tramo"`
	// Los que bajan un número si este se da de baja.
	Corren []Corrimiento `json:"corren"`
	// La deuda que este comprobante cargó en la cuenta corriente y que se va
	// con él.
	Deuda float64 `json:"deuda"`
	// Por qué no se puede dar de baja, o nil. No mira ARCA: eso lo hace la
	// baja, que es la que decide.
	Bloqueo *string `json:"bloqueo"`
}

// TramoDeLaSerie es el comprobante desde el que se autoriza la serie.
type TramoDeLaSerie struct {
	InvoiceID string `json:"invoiceId"`
	Numero    int64  `json:"numero"`
}

// ResultadoDeBaja es lo que se hizo.
type ResultadoDeBaja struct {
	ID       string        `json:"id"`
	Etiqueta string        `json:"etiqueta"`
	Corridos []Corrimiento `json:"corridos"`
}

type aBajar struct {
	id, tipo, estado, receptor       string
	pv, numero                       int64
	cae, customerID, orderID, origen *string
	total                            float64
	fecha, creado                    time.Time
}

func leerABajar(ctx context.Context, c consultor, id string, bloquear bool) (*aBajar, error) {
	var x aBajar
	sql := `SELECT id, tipo::text, estado::text, receptor_nombre, punto_venta, numero, cae, customer_id, order_id, total::float8,
		fecha_emision, comprobante_origen_id, created_at FROM invoices WHERE id = $1`
	if bloquear {
		sql += ` FOR UPDATE`
	}
	err := c.QueryRow(ctx, sql, id).Scan(&x.id, &x.tipo, &x.estado, &x.receptor, &x.pv, &x.numero, &x.cae, &x.customerID,
		&x.orderID, &x.total, &x.fecha, &x.origen, &x.creado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &x, err
}

// bloqueoDeBaja son las condiciones que se miran en la base (todas menos la
// de ARCA), en el orden en que conviene resolverlas.
func bloqueoDeBaja(ctx context.Context, c consultor, x *aBajar) (string, error) {
	if x.cae != nil {
		return "Tiene CAE: un comprobante autorizado se anula con nota de crédito.", nil
	}
	if x.estado == "borrador" {
		return "Un borrador no tiene número que liberar.", nil
	}
	// La nota de una devolución no se da de baja: la plata ya salió y el
	// stock ya entró en la misma operación, y sin la nota quedaban sin
	// respaldo (y los renglones, libres para devolverse otra vez). Deshacer
	// la devolución tampoco: la plata está en la mano del cliente. Lo que
	// queda es reintentarla; el receptor es el de la factura, que ARCA ya
	// aceptó.
	var deDevolucion bool
	if err := c.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM devoluciones WHERE nota_id = $1)`, x.id).Scan(&deDevolucion); err != nil {
		return "", err
	}
	if deDevolucion {
		return "Es la nota de una devolución: la plata y el stock ya se movieron. Reintentala.", nil
	}
	var posterior *int64
	if err := c.QueryRow(ctx, `SELECT min(numero)::bigint FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante
		AND numero > $3 AND cae IS NOT NULL`, x.pv, x.tipo, x.numero).Scan(&posterior); err != nil {
		return "", err
	}
	if posterior != nil {
		return "El " + fiscal.NumeroFormateado(x.pv, *posterior) + " ya tiene CAE: ARCA pasó este número y no se puede liberar.", nil
	}
	var notas int
	if err := c.QueryRow(ctx, `SELECT count(*)::int FROM invoices WHERE comprobante_origen_id = $1`, x.id).Scan(&notas); err != nil {
		return "", err
	}
	if notas > 0 {
		return "Tiene notas encima: dalas de baja primero.", nil
	}
	var recibo *string
	var sinRecibo int
	if err := c.QueryRow(ctx, `SELECT (SELECT r.numero FROM invoice_payments p JOIN receipts r ON r.id = p.receipt_id
		  WHERE p.invoice_id = $1 AND r.estado <> 'anulado' ORDER BY r.numero LIMIT 1),
		(SELECT count(*)::int FROM invoice_payments WHERE invoice_id = $1 AND receipt_id IS NULL AND medio <> 'cuenta_corriente')`, x.id).Scan(&recibo, &sinRecibo); err != nil {
		return "", err
	}
	if recibo != nil {
		return "Está cobrado con el recibo " + *recibo + ": anulalo primero.", nil
	}
	if sinRecibo > 0 {
		return "Tiene cobros sin recibo: son el único rastro de esa plata y se irían con la baja.", nil
	}
	return "", nil
}

// movimientosDe son los movimientos de cuenta que cargó el comprobante: la
// factura suelta a un cliente con ficha (EmitirManual) deja su deuda con la
// etiqueta como referencia. Los de un pedido los maneja el pedido.
const movimientosDe = `customer_id = $1 AND referencia = $2 AND receipt_id IS NULL AND cheque_id IS NULL`

// Serie es lo que muestra la ficha antes de reintentar o dar de baja.
func (s *Servicio) Serie(ctx context.Context, id string) (*SerieDelComprobante, error) {
	x, err := leerABajar(ctx, s.pool, id, false)
	if err != nil {
		return nil, err
	}
	if x == nil {
		return nil, ErrNoEsta
	}
	out := &SerieDelComprobante{Corren: []Corrimiento{}}
	if err := s.pool.QueryRow(ctx, `SELECT count(*)::int FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante
		AND numero < $3 AND cae IS NULL`, x.pv, x.tipo, x.numero).Scan(&out.AnterioresSinCae); err != nil {
		return nil, err
	}
	if out.AnterioresSinCae > maxAnteriores {
		var t TramoDeLaSerie
		if err := s.pool.QueryRow(ctx, `SELECT id, numero FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante
			AND numero < $3 AND cae IS NULL ORDER BY numero OFFSET $4 LIMIT 1`, x.pv, x.tipo, x.numero, maxAnteriores).Scan(&t.InvoiceID, &t.Numero); err != nil {
			return nil, err
		}
		out.Tramo = &t
	}
	if out.Corren, err = posteriores(ctx, s.pool, x, false); err != nil {
		return nil, err
	}
	if x.customerID != nil && x.orderID == nil {
		if err := s.pool.QueryRow(ctx, `SELECT coalesce(sum(monto), 0)::float8 FROM account_movements WHERE `+movimientosDe,
			*x.customerID, etiqueta(x.tipo, x.pv, x.numero)).Scan(&out.Deuda); err != nil {
			return nil, err
		}
	}
	// Una nota: lo que cargó en la cuenta está bajo la etiqueta del original.
	if x.origen != nil {
		o, err := leerOriginalDeNota(ctx, s.pool, x)
		if err != nil {
			return nil, err
		}
		if o != nil && o.movimiento != nil {
			out.Deuda = o.monto
		}
	}
	m, err := bloqueoDeBaja(ctx, s.pool, x)
	if err != nil {
		return nil, err
	}
	if m != "" {
		out.Bloqueo = &m
	}
	return out, nil
}

func posteriores(ctx context.Context, c consultor, x *aBajar, bloquear bool) ([]Corrimiento, error) {
	sql := `SELECT id, numero, receptor_nombre, customer_id FROM invoices WHERE punto_venta = $1 AND tipo = $2::tipo_comprobante
		AND numero > $3 ORDER BY numero`
	if bloquear {
		sql += ` FOR UPDATE`
	}
	filas, err := c.Query(ctx, sql, x.pv, x.tipo, x.numero)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []Corrimiento{}
	for filas.Next() {
		var k Corrimiento
		if err := filas.Scan(&k.InvoiceID, &k.De, &k.ReceptorNombre, &k.CustomerID); err != nil {
			return nil, err
		}
		k.A = k.De - 1
		out = append(out, k)
	}
	return out, filas.Err()
}

// DarDeBaja saca de la serie un comprobante sin CAE y corre los pendientes
// que vienen detrás.
//
// Los candados, en el mismo orden que el resto: primero el del CAE (el mismo
// de Autorizar: mientras se da de baja nadie le pide a ARCA un número de esta
// serie, y lo que ARCA contesta acá sigue valiendo al escribir), después el
// de la numeración de la serie (el de siguienteNumero: nadie toma un número
// mientras se corren). Autorizar nunca toma el de la serie y la emisión nunca
// toma el del CAE, así que no hay espera cruzada.
func (s *Servicio) DarDeBaja(ctx context.Context, ses *auth.Sesion, id, motivo string, vistos []string) (*ResultadoDeBaja, error) {
	s.cae.Lock()
	defer s.cae.Unlock()
	conn, err := s.pool.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, CandadoCAE); err != nil {
		return nil, err
	}
	defer func() { _, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, CandadoCAE) }()

	x, err := leerABajar(ctx, conn, id, false)
	if err != nil {
		return nil, err
	}
	if x == nil {
		// El doble clic: el primero ya lo dio de baja.
		return nil, errEmision("Ese comprobante ya no está: se dio de baja.")
	}
	if m, err := bloqueoDeBaja(ctx, conn, x); err != nil || m != "" {
		if err != nil {
			return nil, err
		}
		return nil, errEmision(m)
	}
	// ARCA manda: si ya tiene el número, el comprobante salió (el CAE se
	// perdió en un corte) y lo que corresponde es recuperarlo, no liberarlo.
	if s.env.UsaArca() {
		a := &arca{s: s, cfg: s.env.Leer()}
		ultimo, err := a.ultimo(ctx, x.pv, x.tipo)
		if err != nil {
			return nil, err
		}
		if ultimo >= x.numero {
			return nil, errEmision("ARCA ya lo tiene: reintentá para recuperar el CAE.")
		}
	}

	var res ResultadoDeBaja
	err = pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, fiscal.ClaveDeLock(x.pv, x.tipo)); err != nil {
			return err
		}
		// Releído con la fila bloqueada: entre la primera lectura y el
		// candado de la serie pudo haber entrado un cobro.
		x, err := leerABajar(ctx, tx, id, true)
		if err != nil {
			return err
		}
		if x == nil {
			return errEmision("Ese comprobante ya no está: se dio de baja.")
		}
		if m, err := bloqueoDeBaja(ctx, tx, x); err != nil || m != "" {
			if err != nil {
				return err
			}
			return errEmision(m)
		}
		et := etiqueta(x.tipo, x.pv, x.numero)
		cliente := ""
		if x.customerID != nil && x.orderID == nil {
			cliente = *x.customerID
		}
		corren, err := posteriores(ctx, tx, x, true)
		if err != nil {
			return err
		}
		// La lista que el admin confirmó tiene que ser la que se corre: si
		// mientras escribía el motivo el mostrador emitió en esta serie, a
		// un cliente que no vio se le cambiaría el número.
		if !mismosCorridos(corren, vistos) {
			return errEmision("La serie cambió: revisá la lista antes de confirmar.")
		}
		for i := range corren {
			if corren[i].Recibos, err = recibosDe(ctx, tx, corren[i].InvoiceID); err != nil {
				return err
			}
		}
		nota, err := leerOriginalDeNota(ctx, tx, x)
		if err != nil {
			return err
		}
		// La foto, antes de tocar nada. arca_log pierde el invoice_id con el
		// borrado: lo que contestó ARCA queda acá.
		var foto json.RawMessage
		if err := tx.QueryRow(ctx, `SELECT jsonb_build_object(
			'cabecera', to_jsonb(i),
			'renglones', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.orden) FROM invoice_items r WHERE r.invoice_id = i.id), '[]'::jsonb),
			'tributos', coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM invoice_tributos t WHERE t.invoice_id = i.id), '[]'::jsonb),
			'cobros', coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.fecha) FROM invoice_payments p WHERE p.invoice_id = i.id), '[]'::jsonb),
			'arca', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at) FROM arca_log l WHERE l.invoice_id = i.id), '[]'::jsonb),
			'movimientos', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at) FROM account_movements m
			  WHERE `+movimientosDeEn("m", "$2", "$3")+` OR m.id = $4), '[]'::jsonb),
			'original', $5::jsonb)
			FROM invoices i WHERE i.id = $1`, x.id, cliente, et, nota.idMovimiento(), nota.foto()).Scan(&foto); err != nil {
			return err
		}
		renumerados, _ := json.Marshal(corren)
		if err := tx.QueryRow(ctx, `INSERT INTO invoices_dadas_de_baja (invoice_id, tipo, punto_venta, numero, receptor_nombre, customer_id,
			order_id, total, fecha_emision, motivo, usuario_id, usuario_nombre, renumerados, comprobante)
			VALUES ($1, $2::tipo_comprobante, $3, $4, $5, $6, $7, $8::numeric, $9, $10, $11, $12, $13, $14) RETURNING id`,
			x.id, x.tipo, x.pv, x.numero, x.receptor, x.customerID, x.orderID, x.total, x.fecha, motivo, ses.UserID, ses.Nombre,
			json.RawMessage(renumerados), foto).Scan(&res.ID); err != nil {
			return err
		}
		// La deuda que cargó se va con él, borrada y no contramovida: con un
		// contramovimiento la cuenta mostraba dos «0003» de importes
		// distintos apenas el 0004 bajaba a 0003. Queda en la foto.
		if cliente != "" {
			if _, err := tx.Exec(ctx, `DELETE FROM account_movements WHERE `+movimientosDe, cliente, et); err != nil {
				return err
			}
		}
		if err := nota.deshacer(ctx, tx); err != nil {
			return err
		}
		// Los cobros con recibo anulado y los pases a cuenta corriente se van
		// en cascada (están en la foto).
		if _, err := tx.Exec(ctx, `DELETE FROM invoices WHERE id = $1`, x.id); err != nil {
			return err
		}
		q := s.q.WithTx(tx)
		bitacora.Anotar(ctx, q, s.log, ses, sqlc.AccionAuditoriaEliminar, "factura", x.id,
			"Dio de baja "+et+" (sin CAE): "+motivo, map[string]any{"bajaId": res.ID, "corridos": len(corren)})
		// De abajo hacia arriba: el número de arriba ya quedó libre.
		for _, k := range corren {
			if _, err := tx.Exec(ctx, `UPDATE invoices SET numero = $2, updated_at = now() WHERE id = $1`, k.InvoiceID, k.A); err != nil {
				return err
			}
			viejo, nuevo := etiqueta(x.tipo, x.pv, k.De), etiqueta(x.tipo, x.pv, k.A)
			// Solo los movimientos de ese comprobante: su cliente y su
			// etiqueta exacta.
			if k.CustomerID != nil {
				if _, err := tx.Exec(ctx, `UPDATE account_movements SET referencia = $3, detalle = replace(detalle, $2, $3)
					WHERE `+movimientosDe, *k.CustomerID, viejo, nuevo); err != nil {
					return err
				}
			}
			// Y los recibos que lo cobraron: «Cobro de Factura B 0003-00000005»
			// seguía nombrando un número que mañana es de otro cliente, en el
			// recibo y en su renglón de la cuenta corriente. Se reemplaza la
			// etiqueta exacta (son de ancho fijo: la 0005 no es parte de otra).
			// De abajo hacia arriba, ningún reemplazo pisa al siguiente.
			if _, err := tx.Exec(ctx, `WITH r AS (SELECT DISTINCT receipt_id FROM invoice_payments WHERE invoice_id = $1 AND receipt_id IS NOT NULL),
				_ AS (UPDATE receipts SET concepto = replace(concepto, $2, $3) WHERE id IN (SELECT receipt_id FROM r) AND concepto LIKE '%' || $2 || '%')
				UPDATE account_movements SET detalle = replace(detalle, $2, $3)
				WHERE receipt_id IN (SELECT receipt_id FROM r) AND detalle LIKE '%' || $2 || '%'`, k.InvoiceID, viejo, nuevo); err != nil {
				return err
			}
			bitacora.Anotar(ctx, q, s.log, ses, sqlc.AccionAuditoriaEditar, "factura", k.InvoiceID,
				viejo+" pasa a ser el "+fiscal.NumeroFormateado(x.pv, k.A)+" por la baja del "+fiscal.NumeroFormateado(x.pv, x.numero),
				map[string]any{"de": k.De, "a": k.A, "bajaId": res.ID})
		}
		res.Etiqueta = et
		res.Corridos = corren
		return nil
	})
	if err != nil {
		return nil, s.comoEmision(err, "fiscal.baja", "No se pudo dar de baja el comprobante.")
	}
	return &res, nil
}

// mismosCorridos compara los corridos de ahora con los que vio el admin, en
// orden.
func mismosCorridos(corren []Corrimiento, vistos []string) bool {
	if len(corren) != len(vistos) {
		return false
	}
	for i, k := range corren {
		if k.InvoiceID != vistos[i] {
			return false
		}
	}
	return true
}

// recibosDe son los números de los recibos vivos que cobraron el comprobante.
func recibosDe(ctx context.Context, c consultor, id string) ([]string, error) {
	filas, err := c.Query(ctx, `SELECT DISTINCT r.numero FROM invoice_payments p JOIN receipts r ON r.id = p.receipt_id
		WHERE p.invoice_id = $1 AND r.estado <> 'anulado' ORDER BY r.numero`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	var out []string
	for filas.Next() {
		var n string
		if err := filas.Scan(&n); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, filas.Err()
}

// originalDeNota es lo que una nota sin CAE le hizo a su comprobante de
// origen y que su baja tiene que deshacer.
type originalDeNota struct {
	id         string
	cae        *string
	estado     string
	total      float64
	acreditado float64
	debitado   float64
	// sobreAcreditado: la nota salió de NotaDeCredito (también la nota de
	// débito que revierte una de crédito) y sumó en `acreditado`; si no, es
	// una nota de débito de NotaDeDebito y sumó en `debitado`.
	sobreAcreditado bool
	importe         float64
	// El movimiento que la nota cargó en la cuenta del cliente: va con la
	// etiqueta del original y en la misma transacción que la nota (el mismo
	// created_at).
	movimiento *string
	monto      float64
}

func leerOriginalDeNota(ctx context.Context, c consultor, x *aBajar) (*originalDeNota, error) {
	if x.origen == nil {
		return nil, nil
	}
	o := originalDeNota{importe: x.total}
	var tipo string
	var pv, numero int64
	var cliente, pedido *string
	err := c.QueryRow(ctx, `SELECT id, tipo::text, punto_venta, numero, cae, estado::text, total::float8, acreditado::float8, debitado::float8,
		customer_id, order_id FROM invoices WHERE id = $1`, *x.origen).
		Scan(&o.id, &tipo, &pv, &numero, &o.cae, &o.estado, &o.total, &o.acreditado, &o.debitado, &cliente, &pedido)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Las líneas de NotaDeCredito apuntan a los renglones del original; las de
	// NotaDeDebito son conceptos nuevos.
	if fiscal.EsNotaDeCredito(x.tipo) {
		o.sobreAcreditado = true
	} else if err := c.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = $1 AND invoice_item_origen_id IS NOT NULL)`,
		x.id).Scan(&o.sobreAcreditado); err != nil {
		return nil, err
	}
	if cliente != nil && pedido == nil {
		tipoMov := "nota_debito"
		if fiscal.EsNotaDeCredito(x.tipo) {
			tipoMov = "nota_credito"
		}
		err := c.QueryRow(ctx, `SELECT id, monto::float8 FROM account_movements WHERE customer_id = $1 AND referencia = $2
			AND tipo = $3::tipo_movimiento_cuenta AND created_at = $4 AND receipt_id IS NULL AND cheque_id IS NULL ORDER BY id LIMIT 1`,
			*cliente, etiqueta(tipo, pv, numero), tipoMov, x.creado).Scan(&o.movimiento, &o.monto)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	return &o, nil
}

func (o *originalDeNota) idMovimiento() *string {
	if o == nil {
		return nil
	}
	return o.movimiento
}

// foto es cómo estaba el original antes de la baja de su nota.
func (o *originalDeNota) foto() json.RawMessage {
	if o == nil {
		return json.RawMessage("null")
	}
	b, _ := json.Marshal(map[string]any{"invoiceId": o.id, "estado": o.estado, "acreditado": o.acreditado, "debitado": o.debitado})
	return b
}

func (o *originalDeNota) deshacer(ctx context.Context, tx pgx.Tx) error {
	if o == nil {
		return nil
	}
	if o.sobreAcreditado {
		acreditado := fiscal.Redondear(o.acreditado - o.importe)
		if acreditado < 0 {
			acreditado = 0
		}
		// Si la nota lo había anulado y ya no queda acreditado entero, vuelve
		// a estar vigente: autorizado si tiene CAE.
		estado := o.estado
		if estado == "anulada" && acreditado < o.total-0.005 {
			estado = "emitida"
			if o.cae != nil {
				estado = "autorizada"
			}
		}
		if _, err := tx.Exec(ctx, `UPDATE invoices SET acreditado = $2::numeric, estado = $3::estado_comprobante, updated_at = now() WHERE id = $1`,
			o.id, jsmath.Fijo2(acreditado), estado); err != nil {
			return err
		}
	} else {
		debitado := fiscal.Redondear(o.debitado - o.importe)
		if debitado < 0 {
			debitado = 0
		}
		if _, err := tx.Exec(ctx, `UPDATE invoices SET debitado = $2::numeric, updated_at = now() WHERE id = $1`,
			o.id, jsmath.Fijo2(debitado)); err != nil {
			return err
		}
	}
	if o.movimiento != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM account_movements WHERE id = $1`, *o.movimiento); err != nil {
			return err
		}
	}
	return nil
}

// movimientosDeEn es movimientosDe con otro alias y otros parámetros.
func movimientosDeEn(alias, cliente, ref string) string {
	return alias + ".customer_id::text = " + cliente + " AND " + alias + ".referencia = " + ref + " AND " + alias +
		".receipt_id IS NULL AND " + alias + ".cheque_id IS NULL"
}

// DadoDeBaja es un renglón del listado de Facturación › Dados de baja.
type DadoDeBaja struct {
	ID             string        `json:"id"`
	Tipo           string        `json:"tipo"`
	PuntoVenta     int64         `json:"puntoVenta"`
	Numero         int64         `json:"numero"`
	ReceptorNombre string        `json:"receptorNombre"`
	Total          float64       `json:"total"`
	FechaEmision   time.Time     `json:"fechaEmision"`
	Motivo         string        `json:"motivo"`
	UsuarioNombre  string        `json:"usuarioNombre"`
	CreatedAt      time.Time     `json:"createdAt"`
	Renumerados    []Corrimiento `json:"renumerados"`
}

// DadosDeBaja lista las bajas, la más nueva primero.
func (s *Servicio) DadosDeBaja(ctx context.Context) ([]DadoDeBaja, error) {
	filas, err := s.pool.Query(ctx, `SELECT id, tipo::text, punto_venta, numero, receptor_nombre, total::float8, fecha_emision, motivo,
		usuario_nombre, created_at, renumerados FROM invoices_dadas_de_baja ORDER BY created_at DESC LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []DadoDeBaja{}
	for filas.Next() {
		var d DadoDeBaja
		var ren []byte
		if err := filas.Scan(&d.ID, &d.Tipo, &d.PuntoVenta, &d.Numero, &d.ReceptorNombre, &d.Total, &d.FechaEmision, &d.Motivo,
			&d.UsuarioNombre, &d.CreatedAt, &ren); err != nil {
			return nil, err
		}
		d.Renumerados = []Corrimiento{}
		if err := json.Unmarshal(ren, &d.Renumerados); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, filas.Err()
}

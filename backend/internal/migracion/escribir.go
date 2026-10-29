package migracion

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"

	"mjbj/internal/productos"
	"mjbj/internal/sqlc"
)

// Con qué se reconoce un saldo ya migrado. No cambiarlas: son las del TS y
// las que ya están en la base.
const (
	ReferenciaSaldo          = "SALDO-INICIAL"
	ReferenciaSaldoProveedor = "SALDO-INICIAL-PROV"
)

// Resultado es lo que dejó un lote.
type Resultado struct {
	Creados      int       `json:"creados"`
	Actualizados int       `json:"actualizados"`
	Omitidos     int       `json:"omitidos"`
	ConError     int       `json:"conError"`
	Rechazos     []Rechazo `json:"rechazos"`
}

func (r *Resultado) rechazar(linea int, identificador, motivo string) {
	r.ConError++
	r.Rechazos = append(r.Rechazos, Rechazo{Linea: linea, Identificador: identificador, Motivo: motivo})
}

// comparable deja un texto comparable: sin tildes, sin espacios de más, en
// minúsculas.
func comparable(texto string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(texto) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	campos := strings.FieldsFunc(minusculasJS(b.String()), esEspacioJS)
	return strings.Join(campos, " ")
}

// porNombre encuentra una ficha por su nombre comparable (y, en productos,
// su categoría). El TS buscaba `lower(nombre) = comparable(texto)`: el
// archivo sin tildes contra la base con tildes, y un «José Pérez» sin código
// ni CUIT no se encontraba nunca y se duplicaba en cada corrida. Acá los dos
// lados pasan por comparable, así que lo que el TS encontraba se sigue
// encontrando (si `lower(nombre)` ya era igual, no tenía tildes ni espacios
// de más) y además lo que tiene tildes.
//
// La tabla se lee una vez por lote y se mantiene al día con lo que el lote
// escribe: comparar con tildes en SQL (f_unaccent + regexp sobre cada fila)
// recorría la tabla entera por cada fila del archivo, y no hay índice.
type porNombre struct {
	consulta string // devuelve id, nombre y el agrupador ("" si no hay)
	cargado  bool
	ids      map[string]string // clave → id (el primero, como el LIMIT 1)
	claves   map[string]string // id → clave
}

func claveDeNombre(nombre, grupo string) string { return grupo + "\x00" + comparable(nombre) }

func (p *porNombre) buscar(ctx context.Context, tx pgx.Tx, nombre, grupo string) (string, error) {
	if !p.cargado {
		p.ids, p.claves = map[string]string{}, map[string]string{}
		rows, err := tx.Query(ctx, p.consulta)
		if err != nil {
			return "", err
		}
		defer rows.Close()
		for rows.Next() {
			var id, n, g string
			if err := rows.Scan(&id, &n, &g); err != nil {
				return "", err
			}
			p.poner(id, claveDeNombre(n, g))
		}
		if err := rows.Err(); err != nil {
			return "", err
		}
		p.cargado = true
	}
	return p.ids[claveDeNombre(nombre, grupo)], nil
}

// poner anota (o cambia) el nombre de una ficha que escribió el lote.
func (p *porNombre) poner(id, clave string) {
	if p.ids == nil {
		return
	}
	if vieja, ok := p.claves[id]; ok && p.ids[vieja] == id {
		delete(p.ids, vieja)
	}
	p.claves[id] = clave
	if _, ok := p.ids[clave]; !ok {
		p.ids[clave] = id
	}
}

// nulo es `texto || null`.
func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// Opciones son la corrida y quién la corre.
type Opciones struct {
	LoteID string
	UserID string
}

// AplicarLote escribe un lote en su transacción. Las filas con error de
// lectura ni llegan a la base: se cuentan y se listan.
func AplicarLote(ctx context.Context, pool *pgxpool.Pool, entidad string, filas []Fila, op Opciones) (Resultado, error) {
	res := Resultado{Rechazos: []Rechazo{}}
	var buenas []Fila
	for _, f := range filas {
		if len(f.Errores) > 0 {
			res.rechazar(f.Linea, primero(f.Datos["sku"], f.Datos["codigo"], f.Datos["nombre"], "—"), strings.Join(f.Errores, " "))
			continue
		}
		buenas = append(buenas, f)
	}
	if len(buenas) == 0 {
		return res, nil
	}

	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		switch entidad {
		case "clientes":
			return aplicarClientes(ctx, tx, buenas, &res)
		case "productos":
			return aplicarProductos(ctx, tx, buenas, &res, op)
		case "stock":
			return aplicarStock(ctx, tx, buenas, &res, op)
		case "saldos":
			return aplicarSaldos(ctx, tx, buenas, &res, op)
		case "proveedores":
			return aplicarProveedores(ctx, tx, buenas, &res, op)
		case "ventas_historicas":
			return aplicarVentas(ctx, tx, buenas, &res)
		case "comprobantes_historicos":
			return aplicarComprobantes(ctx, tx, buenas, &res)
		}
		return fmt.Errorf("entidad de migración desconocida: %s", entidad)
	})
	if err != nil {
		// Lo que se haya contado de este lote no quedó escrito.
		return Resultado{}, err
	}
	return res, nil
}

// unID devuelve el id de la primera fila, o "" si no hay.
func unID(ctx context.Context, tx pgx.Tx, consulta string, args ...any) (string, error) {
	var id string
	err := tx.QueryRow(ctx, consulta, args...).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

/* ---------------------------- clientes ---------------------------- */

// buscarCliente es la cascada de confianza: el código del sistema viejo, el
// CUIT y recién al final el nombre.
func buscarCliente(ctx context.Context, tx pgx.Tx, d map[string]string, nombres *porNombre) (string, error) {
	if d["codigo"] != "" {
		if id, err := unID(ctx, tx, `SELECT id FROM customers WHERE codigo_legacy = $1 LIMIT 1`, d["codigo"]); id != "" || err != nil {
			return id, err
		}
	}
	if d["cuit"] != "" {
		if id, err := unID(ctx, tx, `SELECT id FROM customers WHERE cuit = $1 LIMIT 1`, d["cuit"]); id != "" || err != nil {
			return id, err
		}
	}
	if nombres == nil {
		return "", nil
	}
	return nombres.buscar(ctx, tx, d["nombre"], "")
}

func aplicarClientes(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado) error {
	nombres := &porNombre{consulta: `SELECT id::text, nombre, '' FROM customers ORDER BY created_at, id`}
	for _, f := range filas {
		d := f.Datos
		id, err := buscarCliente(ctx, tx, d, nombres)
		if err != nil {
			return err
		}
		limite := d["limiteCredito"]
		if limite == "" {
			limite = "0"
		}
		args := []any{d["nombre"], nulo(d["razonSocial"]), nulo(d["cuit"]), d["condicionIva"], nulo(d["email"]),
			nulo(d["telefono"]), nulo(d["direccion"]), d["tipo"], limite, nulo(d["asesor"]), nulo(d["notas"]), nulo(d["codigo"])}
		if id != "" {
			_, err = tx.Exec(ctx, `UPDATE customers SET nombre = $1, razon_social = $2, cuit = $3, condicion_iva = $4::condicion_iva,
				email = $5, telefono = $6, direccion = $7, tipo = $8::tipo_cliente, limite_credito = $9::numeric, asesor = $10,
				notas = $11, codigo_legacy = $12, updated_at = now() WHERE id = $13`, append(args, id)...)
			res.Actualizados++
		} else {
			err = tx.QueryRow(ctx, `INSERT INTO customers (nombre, razon_social, cuit, condicion_iva, email, telefono, direccion,
				tipo, limite_credito, asesor, notas, codigo_legacy, updated_at)
				VALUES ($1, $2, $3, $4::condicion_iva, $5, $6, $7, $8::tipo_cliente, $9::numeric, $10, $11, $12, now())
				RETURNING id::text`, args...).Scan(&id)
			res.Creados++
		}
		if err != nil {
			return err
		}
		nombres.poner(id, claveDeNombre(d["nombre"], ""))
	}
	return nil
}

/* ----------------------- productos y medidas ----------------------- */

// slugLibre busca un slug libre agregando un sufijo: dos productos distintos
// pueden llamarse igual en categorías distintas, y el slug es la dirección.
func slugLibre(ctx context.Context, tx pgx.Tx, base string) (string, error) {
	raiz := base
	if raiz == "" {
		raiz = "producto"
	}
	for intento := 0; intento < 50; intento++ {
		candidato := raiz
		if intento > 0 {
			candidato = fmt.Sprintf("%s-%d", raiz, intento+1)
		}
		id, err := unID(ctx, tx, `SELECT id FROM products WHERE slug = $1 LIMIT 1`, candidato)
		if err != nil {
			return "", err
		}
		if id == "" {
			return candidato, nil
		}
	}
	return fmt.Sprintf("%s-%d", raiz, time.Now().UnixMilli()), nil
}

// enteroONulo es `texto ? Number(texto) : null` para una columna integer (la
// convierte Postgres, como hacía el TS).
func enteroONulo(s string) *string { return nulo(s) }

func aplicarProductos(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado, op Opciones) error {
	general, err := unID(ctx, tx, `SELECT id FROM price_lists WHERE is_default = true LIMIT 1`)
	if err != nil {
		return err
	}
	profesional, err := unID(ctx, tx, `SELECT id FROM price_lists WHERE slug = 'profesional' LIMIT 1`)
	if err != nil {
		return err
	}

	nombres := &porNombre{consulta: `SELECT id::text, name, category_id::text FROM products ORDER BY created_at, id`}
	for _, f := range filas {
		d := f.Datos

		// La categoría se busca por slug y, si no está, se crea.
		slugCategoria := productos.GenerarSlug(d["categoria"])
		categoria, err := unID(ctx, tx, `SELECT id FROM categories WHERE slug = $1 LIMIT 1`, slugCategoria)
		if err != nil {
			return err
		}
		if categoria == "" {
			if err := tx.QueryRow(ctx, `INSERT INTO categories (slug, name) VALUES ($1, $2) RETURNING id`, slugCategoria, d["categoria"]).Scan(&categoria); err != nil {
				return err
			}
		}

		// Los renglones con el mismo nombre y categoría son medidas de un
		// mismo producto.
		producto, err := nombres.buscar(ctx, tx, d["nombre"], categoria)
		if err != nil {
			return err
		}
		if producto == "" {
			slug, err := slugLibre(ctx, tx, productos.GenerarSlug(d["nombre"]))
			if err != nil {
				return err
			}
			alicuota := d["alicuotaIva"]
			if alicuota == "" {
				alicuota = "21"
			}
			if err := tx.QueryRow(ctx, `INSERT INTO products (slug, name, category_id, description, brand, unit, alicuota_iva)
				VALUES ($1, $2, $3, $4, $5, $6::unit_of_sale, $7::numeric) RETURNING id`,
				slug, d["nombre"], categoria, d["descripcion"], nulo(d["marca"]), d["unidad"], alicuota).Scan(&producto); err != nil {
				return err
			}
			nombres.poner(producto, claveDeNombre(d["nombre"], categoria))
		}

		variante, err := unID(ctx, tx, `SELECT id FROM product_variants WHERE sku = $1 LIMIT 1`, d["sku"])
		if err != nil {
			return err
		}
		etiqueta := d["medida"]
		if etiqueta == "" {
			etiqueta = d["sku"]
		}
		medida := []any{producto, d["sku"], etiqueta, enteroONulo(d["largoMm"]), enteroONulo(d["anchoMm"]), enteroONulo(d["espesorMm"])}
		if variante != "" {
			if _, err := tx.Exec(ctx, `UPDATE product_variants SET product_id = $1, sku = $2, label = $3, largo_mm = $4::integer,
				ancho_mm = $5::integer, espesor_mm = $6::integer, updated_at = now() WHERE id = $7`, append(medida, variante)...); err != nil {
				return err
			}
			res.Actualizados++
		} else {
			if err := tx.QueryRow(ctx, `INSERT INTO product_variants (product_id, sku, label, largo_mm, ancho_mm, espesor_mm, updated_at)
				VALUES ($1, $2, $3, $4::integer, $5::integer, $6::integer, now()) RETURNING id`, medida...).Scan(&variante); err != nil {
				return err
			}
			res.Creados++
		}

		// Los precios entran con su registro en el historial: el día que
		// alguien pregunte de dónde salió un precio, dice «de la migración».
		for _, p := range [2][2]string{{general, d["precioGeneral"]}, {profesional, d["precioProfesional"]}} {
			lista, precio := p[0], p[1]
			if lista == "" || precio == "" || numeroJS(precio) <= 0 {
				continue
			}
			var previo *string
			err := tx.QueryRow(ctx, `SELECT price::text FROM price_list_items WHERE variant_id = $1 AND price_list_id = $2 LIMIT 1`,
				variante, lista).Scan(&previo)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if previo != nil && numeroJS(*previo) == numeroJS(precio) {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO price_list_items (variant_id, price_list_id, price, updated_at)
				VALUES ($1, $2, $3::numeric, now())
				ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`,
				variante, lista, precio); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `INSERT INTO price_history (variant_id, price_list_id, precio_anterior, precio_nuevo, origen,
				motivo, lote_id, created_by_user_id)
				VALUES ($1, $2, $3::numeric, $4::numeric, 'importacion', 'Migración desde el sistema anterior', $5, $6)`,
				variante, lista, previo, precio, op.LoteID, op.UserID); err != nil {
				return err
			}
		}
	}
	return nil
}

/* ------------------------------ stock ------------------------------ */

type sucursal struct{ id, nombre, slug string }

func aplicarStock(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado, op Opciones) error {
	rows, err := tx.Query(ctx, `SELECT id, name, slug FROM branches`)
	if err != nil {
		return err
	}
	sucursales, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (sucursal, error) {
		var s sucursal
		err := r.Scan(&s.id, &s.nombre, &s.slug)
		return s, err
	})
	if err != nil {
		return err
	}
	q := sqlc.New(tx)

	for _, f := range filas {
		d := f.Datos
		variante, err := unID(ctx, tx, `SELECT id FROM product_variants WHERE sku = $1 LIMIT 1`, d["sku"])
		if err != nil {
			return err
		}
		if variante == "" {
			res.rechazar(f.Linea, d["sku"], "No hay ninguna medida con ese código. Migrá primero los productos.")
			continue
		}

		buscada, slug := comparable(d["sucursal"]), productos.GenerarSlug(d["sucursal"])
		var suc *sucursal
		for i, s := range sucursales {
			nombre := comparable(s.nombre)
			if nombre == buscada || s.slug == slug || strings.Contains(nombre, buscada) {
				suc = &sucursales[i]
				break
			}
		}
		if suc == nil {
			res.rechazar(f.Linea, d["sku"]+" · "+d["sucursal"],
				fmt.Sprintf(`No existe la sucursal "%s". Creala en Sucursales o corregí el archivo.`, d["sucursal"]))
			continue
		}

		cantidad := numeroJS(d["cantidad"])
		var minimo *float64
		if d["minimo"] != "" {
			m := numeroJS(d["minimo"])
			minimo = &m
		}

		// El candado del stock de esa medida en esa sucursal (el de
		// lib/inventario/reservas.ts): el TS no lo tomaba, y una venta entre
		// la lectura y la escritura dejaba el libro de movimientos sin cerrar
		// con la existencia.
		if err := q.BloquearStock(ctx, sqlc.BloquearStockParams{Variante: variante, Sucursal: suc.id}); err != nil {
			return err
		}

		var anterior float64
		hay := true
		if err := tx.QueryRow(ctx, `SELECT qty FROM inventory WHERE variant_id = $1 AND branch_id = $2 LIMIT 1`,
			variante, suc.id).Scan(&anterior); errors.Is(err, pgx.ErrNoRows) {
			hay = false
		} else if err != nil {
			return err
		}

		if hay && anterior == cantidad && minimo == nil {
			res.Omitidos++
			continue
		}

		// El archivo dice cuánto hay, no cuánto entró: la existencia queda
		// en el número del archivo. Por eso volver a correrlo no suma.
		minimoAlta := 0.0
		if minimo != nil {
			minimoAlta = *minimo
		}
		conflicto := `qty = excluded.qty, updated_at = excluded.updated_at`
		if minimo != nil {
			conflicto = `qty = excluded.qty, min_qty = excluded.min_qty, updated_at = excluded.updated_at`
		}
		if _, err := tx.Exec(ctx, `INSERT INTO inventory (variant_id, branch_id, qty, min_qty, updated_at)
			VALUES ($1, $2, $3, $4, now()) ON CONFLICT (variant_id, branch_id) DO UPDATE SET `+conflicto,
			variante, suc.id, cantidad, minimoAlta); err != nil {
			return err
		}

		if diferencia := float64(cantidad - anterior); diferencia != 0 {
			if _, err := tx.Exec(ctx, `INSERT INTO inventory_movements (variant_id, branch_id, type, qty, note, created_by_user_id)
				VALUES ($1, $2, 'ajuste', $3, 'Existencia inicial migrada del sistema anterior', $4)`,
				variante, suc.id, diferencia, op.UserID); err != nil {
				return err
			}
		}
		if hay {
			res.Actualizados++
		} else {
			res.Creados++
		}
	}
	return nil
}

/* ------------------------ saldos de clientes ------------------------ */

func aplicarSaldos(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado, op Opciones) error {
	for _, f := range filas {
		d := f.Datos
		cliente, err := buscarCliente(ctx, tx, d, nil)
		if err != nil {
			return err
		}
		if cliente == "" && d["email"] != "" {
			if cliente, err = unID(ctx, tx, `SELECT id FROM customers WHERE lower(email) = $1 LIMIT 1`, d["email"]); err != nil {
				return err
			}
		}
		if cliente == "" {
			res.rechazar(f.Linea, primero(d["nombre"], d["codigo"], d["cuit"], d["email"]),
				"No se encontró la ficha del cliente. Migrá primero los clientes.")
			continue
		}

		// Un saldo cargado dos veces duplica la deuda de una persona real:
		// la corrida se puede repetir, el movimiento no.
		ya, err := unID(ctx, tx, `SELECT id FROM account_movements WHERE customer_id = $1 AND referencia = $2 LIMIT 1`,
			cliente, ReferenciaSaldo)
		if err != nil {
			return err
		}
		// Saldo cero: un movimiento en cero solo ensucia el resumen.
		if ya != "" || numeroJS(d["saldo"]) == 0 {
			res.Omitidos++
			continue
		}

		detalle := d["detalle"]
		if detalle == "" {
			detalle = "Saldo inicial migrado del sistema anterior"
		}
		if _, err := tx.Exec(ctx, `INSERT INTO account_movements (customer_id, tipo, monto, detalle, referencia, created_by_user_id)
			VALUES ($1, 'ajuste', $2::numeric, $3, $4, $5)`, cliente, d["saldo"], detalle, ReferenciaSaldo, op.UserID); err != nil {
			return err
		}
		res.Creados++
	}
	return nil
}

/* ---------------------------- proveedores ---------------------------- */

func aplicarProveedores(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado, op Opciones) error {
	nombres := &porNombre{consulta: `SELECT id::text, nombre, '' FROM suppliers ORDER BY created_at, id`}
	for _, f := range filas {
		d := f.Datos

		var proveedor string
		var err error
		if d["codigo"] != "" {
			if proveedor, err = unID(ctx, tx, `SELECT id FROM suppliers WHERE codigo_legacy = $1 LIMIT 1`, d["codigo"]); err != nil {
				return err
			}
		}
		if proveedor == "" && d["cuit"] != "" {
			if proveedor, err = unID(ctx, tx, `SELECT id FROM suppliers WHERE cuit = $1 LIMIT 1`, d["cuit"]); err != nil {
				return err
			}
		}
		if proveedor == "" {
			if proveedor, err = nombres.buscar(ctx, tx, d["nombre"], ""); err != nil {
				return err
			}
		}

		condicion := d["condicionIva"]
		if condicion == "" {
			condicion = "responsable_inscripto"
		}
		// La razón social es el nombre, como en el TS.
		args := []any{d["nombre"], nulo(d["cuit"]), condicion, nulo(d["email"]), nulo(d["telefono"]), nulo(d["direccion"]),
			nulo(d["notas"]), nulo(d["codigo"])}
		if proveedor != "" {
			_, err = tx.Exec(ctx, `UPDATE suppliers SET nombre = $1, razon_social = $1, cuit = $2, condicion_iva = $3::condicion_iva,
				email = $4, telefono = $5, direccion = $6, notas = $7, codigo_legacy = $8 WHERE id = $9`, append(args, proveedor)...)
			res.Actualizados++
		} else {
			err = tx.QueryRow(ctx, `INSERT INTO suppliers (nombre, razon_social, cuit, condicion_iva, email, telefono, direccion, notas, codigo_legacy)
				VALUES ($1, $1, $2, $3::condicion_iva, $4, $5, $6, $7, $8) RETURNING id`, args...).Scan(&proveedor)
			res.Creados++
		}
		if err != nil {
			return err
		}
		nombres.poner(proveedor, claveDeNombre(d["nombre"], ""))

		// El saldo va aparte: la ficha se actualiza siempre, el movimiento
		// se carga una sola vez.
		if numeroJS(d["saldo"]) == 0 {
			continue
		}
		ya, err := unID(ctx, tx, `SELECT id FROM supplier_movements WHERE supplier_id = $1 AND referencia = $2 LIMIT 1`,
			proveedor, ReferenciaSaldoProveedor)
		if err != nil {
			return err
		}
		if ya != "" {
			continue
		}
		if _, err := tx.Exec(ctx, `INSERT INTO supplier_movements (supplier_id, tipo, monto, detalle, referencia, created_by_user_id)
			VALUES ($1, 'ajuste', $2::numeric, 'Saldo inicial migrado del sistema anterior', $3, $4)`,
			proveedor, d["saldo"], ReferenciaSaldoProveedor, op.UserID); err != nil {
			return err
		}
	}
	return nil
}

/* ------------------------- archivo histórico ------------------------- */

// fichaDelCliente busca la ficha sin frenar la fila si no aparece: el
// sistema viejo tiene bajas y fusiones que la cartera ya no refleja.
func fichaDelCliente(ctx context.Context, tx pgx.Tx, codigo, cuit string) (*string, error) {
	id, err := buscarCliente(ctx, tx, map[string]string{"codigo": codigo, "cuit": cuit}, nil)
	return nulo(id), err
}

func contarUpsert(res *Resultado, insertado bool) {
	if insertado {
		res.Creados++
	} else {
		res.Actualizados++
	}
}

func aplicarVentas(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado) error {
	for _, f := range filas {
		d := f.Datos
		cliente, err := fichaDelCliente(ctx, tx, d["codigoCliente"], "")
		if err != nil {
			return err
		}
		var insertado bool
		if err := tx.QueryRow(ctx, `INSERT INTO historical_sales (comprobante_legacy, codigo_cliente_legacy, customer_id,
			cliente_nombre, fecha, total, detalle, sucursal, vendedor)
			VALUES ($1, $2, $3, $4, $5::timestamptz, $6::numeric, $7, $8, $9)
			ON CONFLICT (comprobante_legacy) DO UPDATE SET comprobante_legacy = excluded.comprobante_legacy,
				codigo_cliente_legacy = excluded.codigo_cliente_legacy, customer_id = excluded.customer_id,
				cliente_nombre = excluded.cliente_nombre, fecha = excluded.fecha, total = excluded.total,
				detalle = excluded.detalle, sucursal = excluded.sucursal, vendedor = excluded.vendedor
			RETURNING (xmax = 0)`,
			d["comprobante"], nulo(d["codigoCliente"]), cliente, d["clienteNombre"], d["fecha"], d["total"], d["detalle"],
			nulo(d["sucursal"]), nulo(d["vendedor"])).Scan(&insertado); err != nil {
			return err
		}
		contarUpsert(res, insertado)
	}
	return nil
}

func aplicarComprobantes(ctx context.Context, tx pgx.Tx, filas []Fila, res *Resultado) error {
	for _, f := range filas {
		d := f.Datos
		cliente, err := fichaDelCliente(ctx, tx, d["codigoCliente"], d["clienteCuit"])
		if err != nil {
			return err
		}
		neto, iva := d["neto"], d["iva"]
		if neto == "" {
			neto = "0"
		}
		if iva == "" {
			iva = "0"
		}
		var insertado bool
		if err := tx.QueryRow(ctx, `INSERT INTO historical_invoices (punto_venta, tipo, numero, codigo_cliente_legacy, customer_id,
			cliente_nombre, cliente_cuit, fecha, neto, iva, total, cae, cae_vence)
			VALUES ($1::integer, $2, $3::integer, $4, $5, $6, $7, $8::timestamptz, $9::numeric, $10::numeric, $11::numeric, $12, $13::timestamptz)
			ON CONFLICT (punto_venta, tipo, numero) DO UPDATE SET punto_venta = excluded.punto_venta, tipo = excluded.tipo,
				numero = excluded.numero, codigo_cliente_legacy = excluded.codigo_cliente_legacy, customer_id = excluded.customer_id,
				cliente_nombre = excluded.cliente_nombre, cliente_cuit = excluded.cliente_cuit, fecha = excluded.fecha,
				neto = excluded.neto, iva = excluded.iva, total = excluded.total, cae = excluded.cae, cae_vence = excluded.cae_vence
			RETURNING (xmax = 0)`,
			d["puntoVenta"], d["tipo"], d["numero"], nulo(d["codigoCliente"]), cliente, d["clienteNombre"], nulo(d["clienteCuit"]),
			d["fecha"], neto, iva, d["total"], nulo(d["cae"]), nulo(d["caeVence"])).Scan(&insertado); err != nil {
			return err
		}
		contarUpsert(res, insertado)
	}
	return nil
}

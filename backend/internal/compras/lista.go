package compras

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/planilla"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// La lista de precios del proveedor (app/admin/proveedores/lista-precios):
// la planilla que mande cada uno, leída con su perfil, apareada con nuestras
// variantes por el código guardado o por SKU, y aplicada a la lista general.

// TopeDeLista es lo que aceptaba el TS.
const TopeDeLista = 5 << 20

// PerfilGuardado es una fila de supplier_price_profiles.
type PerfilGuardado struct {
	ID                 string    `json:"id"`
	SupplierID         string    `json:"supplierId"`
	Nombre             string    `json:"nombre"`
	ColumnaCodigo      string    `json:"columnaCodigo"`
	ColumnaPrecio      string    `json:"columnaPrecio"`
	ColumnaDescripcion *string   `json:"columnaDescripcion"`
	PrecioEsNeto       bool      `json:"precioEsNeto"`
	MargenPorcentaje   string    `json:"margenPorcentaje"`
	Activo             bool      `json:"activo"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// PerfilDelProveedor es perfilDelProveedor: nil si todavía no se definió.
func (s *Servicio) PerfilDelProveedor(ctx context.Context, proveedor string) (*PerfilGuardado, error) {
	if !plataforma.UUIDValido(proveedor) {
		return nil, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id, supplier_id, nombre, columna_codigo, columna_precio, columna_descripcion, precio_es_neto, margen_porcentaje::text, activo, created_at, updated_at
		FROM supplier_price_profiles WHERE supplier_id = $1 AND activo LIMIT 1`, proveedor)
	if err != nil {
		return nil, err
	}
	p, err := pgx.CollectOneRow(filas, pgx.RowToStructByPos[PerfilGuardado])
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &p, err
}

// CodigoResuelto es a qué variante nuestra corresponde un código del proveedor.
type CodigoResuelto struct {
	Codigo      string
	VariantID   *string
	Sku         *string
	Descripcion *string
}

// resolverCodigos es resolverCodigos: primero el código ya guardado para el
// proveedor, después nuestro SKU.
func (s *Servicio) resolverCodigos(ctx context.Context, proveedor string, codigos []string) ([]CodigoResuelto, error) {
	vistos := map[string]bool{}
	var unicos []string
	for _, c := range codigos {
		if c = trimJS(c); c != "" && !vistos[c] {
			vistos[c] = true
			unicos = append(unicos, c)
		}
	}
	if len(unicos) == 0 {
		return nil, nil
	}
	// label es el producto con su variante: con la medida sola, el MDF y la
	// melamina de 18 se veían iguales en la vista previa (mes 23).
	type par struct{ variante, sku, label string }
	guardados, porSku := map[string]par{}, map[string]par{}
	filas, err := s.pool.Query(ctx, `
		SELECT c.codigo, c.variant_id, v.sku, p.name || CASE WHEN v.label <> '' AND v.label <> p.name THEN ' · ' || v.label ELSE '' END FROM supplier_variant_codes c JOIN product_variants v ON v.id = c.variant_id
		JOIN products p ON p.id = v.product_id
		WHERE c.supplier_id = $1 AND c.codigo = ANY($2)`, proveedor, unicos)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var codigo string
		var p par
		if err := filas.Scan(&codigo, &p.variante, &p.sku, &p.label); err != nil {
			filas.Close()
			return nil, err
		}
		guardados[codigo] = p
	}
	filas.Close()
	if filas.Err() != nil {
		return nil, filas.Err()
	}
	filas, err = s.pool.Query(ctx, `SELECT v.sku, v.id, p.name || CASE WHEN v.label <> '' AND v.label <> p.name THEN ' · ' || v.label ELSE '' END FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.active AND v.sku = ANY($1)`, unicos)
	if err != nil {
		return nil, err
	}
	for filas.Next() {
		var p par
		if err := filas.Scan(&p.sku, &p.variante, &p.label); err != nil {
			filas.Close()
			return nil, err
		}
		porSku[p.sku] = p
	}
	filas.Close()
	if filas.Err() != nil {
		return nil, filas.Err()
	}
	out := make([]CodigoResuelto, len(unicos))
	for i, c := range unicos {
		out[i] = CodigoResuelto{Codigo: c}
		p, ok := guardados[c]
		if !ok {
			p, ok = porSku[c]
		}
		if ok {
			out[i].VariantID, out[i].Sku, out[i].Descripcion = &p.variante, &p.sku, &p.label
		}
	}
	return out, nil
}

// FilaPreviaProveedor es una fila de la vista previa, con su pareja.
//
// CostoNeto es el costo de la planilla sin IVA, y CostoAnterior el último
// que se conocía de esa variante (el de la lista anterior del proveedor, o
// el promedio). Cambio dice qué le pasa al precio de venta: «sube», «baja»,
// «igual», «nuevo» (no tenía precio) o «sin_sugerido» (sin margen escrito y
// sin costo anterior contra el cual mantenerlo: solo se guarda el costo).
type FilaPreviaProveedor struct {
	FilaDeProveedor
	VariantID     *string  `json:"variantId"`
	Nuestro       *string  `json:"nuestro"`
	PrecioActual  *float64 `json:"precioActual"`
	CostoNeto     float64  `json:"costoNeto"`
	CostoAnterior *float64 `json:"costoAnterior"`
	Cambio        string   `json:"cambio"`
}

// Lo que le pasa al precio de venta de una fila.
const (
	CambioSube        = "sube"
	CambioBaja        = "baja"
	CambioIgual       = "igual"
	CambioNuevo       = "nuevo"
	CambioSinSugerido = "sin_sugerido"
)

// netoDeLaLista es el costo de la planilla sin IVA: Costo ya viene con el
// 21 % puesto (LeerListaDeProveedor, igual que el TS).
func netoDeLaLista(f FilaDeProveedor) float64 {
	return jsmath.Redondear2(f.Costo / (1 + float64(ivaPorDefecto)/100))
}

// precioConMargenActual es el precio que mantiene el margen que la variante
// tiene hoy: el actual movido en la misma proporción que el costo. Sin
// margen escrito, la vista previa ya no inventa uno (venía en 40 % y
// proponía bajar precios reales: M2S1-001).
func precioConMargenActual(actual, costoAnterior, costoNuevo float64) float64 {
	if !(actual > 0) || !(costoAnterior > 0) || !(costoNuevo > 0) {
		return 0
	}
	// El costo guardado lleva más decimales que la lista (el promedio):
	// 16.303,6183 contra 16.303,62 subía el precio un centavo y contaba
	// «para actualizar» algo que no cambia (mes 23, M2S3-056).
	if mismoCosto(costoAnterior, costoNuevo) {
		return actual
	}
	return jsmath.Redondear2(float64(actual*costoNuevo) / costoAnterior)
}

// mismoCosto compara al centavo, que es lo que trae la lista.
func mismoCosto(a, b float64) bool { return jsmath.Redondear2(a) == jsmath.Redondear2(b) }

// cambioDelPrecio clasifica una fila apareada.
func cambioDelPrecio(actual *float64, sugerido float64) string {
	switch {
	case !(sugerido > 0):
		return CambioSinSugerido
	case actual == nil:
		return CambioNuevo
	case sugerido > *actual:
		return CambioSube
	case sugerido < *actual:
		return CambioBaja
	}
	return CambioIgual
}

// VistaPreviaProveedor es lo que va a pasar si se aplica.
type VistaPreviaProveedor struct {
	Filas      []FilaPreviaProveedor `json:"filas"`
	Problemas  []ProblemaDeFila      `json:"problemas"`
	Apareadas  int                   `json:"apareadas"`
	SinAparear int                   `json:"sinAparear"`
	// SinCambios son las apareadas con el mismo costo y el mismo precio: no
	// cuentan como «para actualizar» (M2S3-056).
	SinCambios int      `json:"sinCambios"`
	Columnas   []string `json:"columnas"`
	Error      *string  `json:"error,omitempty"`
}

func vistaVacia(e string) VistaPreviaProveedor {
	return VistaPreviaProveedor{Filas: []FilaPreviaProveedor{}, Problemas: []ProblemaDeFila{}, Columnas: []string{}, Error: &e}
}

func (s *Servicio) listaGeneral(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}) (string, bool, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id FROM price_lists WHERE is_default AND active LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	return id, err == nil, err
}

// PrevisualizarLista es previsualizarLista: lee el archivo y muestra qué
// pasaría, sin tocar nada. `archivo` nil es que no vino.
func (s *Servicio) PrevisualizarLista(ctx context.Context, archivo []byte, form map[string]*string) (VistaPreviaProveedor, error) {
	if len(archivo) == 0 {
		return vistaVacia("Elegí un archivo."), nil
	}
	if len(archivo) > TopeDeLista {
		return vistaVacia("El archivo supera los 5 MB."), nil
	}
	leida := planilla.LeerPlanilla(archivo)
	if leida.Error != "" {
		return vistaVacia(leida.Error), nil
	}
	grilla := leida.Filas
	if len(grilla) < 2 {
		return vistaVacia("La planilla está vacía."), nil
	}
	columnas := []string{}
	for _, c := range grilla[0] {
		if c = trimJS(c); c != "" {
			columnas = append(columnas, c)
		}
	}
	perfil, err := leerPerfil(form)
	if err != nil {
		v := vistaVacia(mensajeDelProblema(err))
		v.Columnas = columnas
		return v, nil
	}
	filas, problemas := LeerListaDeProveedor(grilla, perfil.PerfilDeProveedor)
	codigos := make([]string, len(filas))
	for i, f := range filas {
		codigos[i] = f.Codigo
	}
	resueltos, err := s.resolverCodigos(ctx, perfil.SupplierID, codigos)
	if err != nil {
		return VistaPreviaProveedor{}, err
	}
	porCodigo := map[string]CodigoResuelto{}
	var variantes []string
	for _, r := range resueltos {
		porCodigo[r.Codigo] = r
		if r.VariantID != nil {
			variantes = append(variantes, *r.VariantID)
		}
	}
	actuales := map[string]float64{}
	if general, hay, err := s.listaGeneral(ctx, s.pool); err != nil {
		return VistaPreviaProveedor{}, err
	} else if hay && len(variantes) > 0 {
		rows, err := s.pool.Query(ctx, `SELECT variant_id, price FROM price_list_items WHERE price_list_id = $1 AND variant_id = ANY($2::uuid[])`, general, variantes)
		if err != nil {
			return VistaPreviaProveedor{}, err
		}
		for rows.Next() {
			var v string
			var p jsmath.Num
			if err := rows.Scan(&v, &p); err != nil {
				rows.Close()
				return VistaPreviaProveedor{}, err
			}
			actuales[v] = float64(p)
		}
		rows.Close()
		if rows.Err() != nil {
			return VistaPreviaProveedor{}, rows.Err()
		}
	}
	anteriores, err := s.costosAnteriores(ctx, perfil.SupplierID, variantes)
	if err != nil {
		return VistaPreviaProveedor{}, err
	}
	mantener := margenEnBlanco(form)
	vista := VistaPreviaProveedor{Filas: []FilaPreviaProveedor{}, Problemas: problemas, Columnas: columnas}
	for _, f := range filas {
		x := FilaPreviaProveedor{FilaDeProveedor: f, CostoNeto: netoDeLaLista(f)}
		if r, ok := porCodigo[f.Codigo]; ok && r.VariantID != nil {
			x.VariantID, x.Nuestro = r.VariantID, r.Descripcion
			if p, ok := actuales[*r.VariantID]; ok {
				x.PrecioActual = &p
			}
			if c, ok := anteriores[*r.VariantID]; ok {
				x.CostoAnterior = &c
			}
			if mantener {
				x.PrecioSugerido = 0
				if x.PrecioActual != nil && x.CostoAnterior != nil {
					x.PrecioSugerido = precioConMargenActual(*x.PrecioActual, *x.CostoAnterior, x.CostoNeto)
				}
			}
			x.Cambio = cambioDelPrecio(x.PrecioActual, x.PrecioSugerido)
			if (x.Cambio == CambioIgual || x.Cambio == CambioSinSugerido) && x.CostoAnterior != nil && mismoCosto(*x.CostoAnterior, x.CostoNeto) {
				vista.SinCambios++
			}
			vista.Apareadas++
		} else {
			if ok {
				x.Nuestro = r.Descripcion
			}
			vista.SinAparear++
		}
		vista.Filas = append(vista.Filas, x)
	}
	return vista, nil
}

// margenEnBlanco es que no se escribió un margen: cada variante mantiene el
// suyo.
func margenEnBlanco(form map[string]*string) bool {
	v := form["margenPorcentaje"]
	return v == nil || trimJS(*v) == ""
}

// costosAnteriores es el último costo neto conocido de cada variante: el de
// la lista anterior de este proveedor y, si no, el promedio.
func (s *Servicio) costosAnteriores(ctx context.Context, proveedor string, variantes []string) (map[string]float64, error) {
	out := map[string]float64{}
	if len(variantes) == 0 || !plataforma.UUIDValido(proveedor) {
		return out, nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, coalesce(
		  (SELECT x.costo_neto FROM supplier_variant_codes x WHERE x.supplier_id = $1::uuid AND x.variant_id = v.id AND x.costo_neto IS NOT NULL
		   ORDER BY x.costo_at DESC NULLS LAST LIMIT 1),
		  (SELECT nullif(vc.costo_promedio, 0) FROM variant_costs vc WHERE vc.variant_id = v.id))
		FROM product_variants v WHERE v.id = ANY($2::uuid[])`, proveedor, variantes)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var v string
		var c *jsmath.Num
		if err := filas.Scan(&v, &c); err != nil {
			return nil, err
		}
		if c != nil {
			out[v] = float64(*c)
		}
	}
	return out, filas.Err()
}

func mensajeDelProblema(err error) string {
	var p *plataforma.Problema
	if errors.As(err, &p) {
		for _, m := range p.Errores {
			return m
		}
		return p.Detalle
	}
	return "Revisá el perfil."
}

// AplicarLista es aplicarLista: guarda el perfil, los códigos y los precios
// nuevos de las filas apareadas. `filas` es el JSON que armó la vista previa.
func (s *Servicio) AplicarLista(ctx context.Context, ses *auth.Sesion, form map[string]*string) (string, string, error) {
	perfil, err := leerPerfil(form)
	if err != nil {
		return "", "", fallo(mensajeDelProblema(err))
	}
	crudo := form["filas"]
	if crudo == nil {
		return "", "", fallo("No hay nada para aplicar.")
	}
	var v any
	if json.Unmarshal([]byte(*crudo), &v) != nil {
		return "", "", fallo("No hay filas apareadas para aplicar.")
	}
	filas, ok := leerFilasAplicar(v)
	if !ok {
		return "", "", fallo("No hay filas apareadas para aplicar.")
	}
	general, hay, err := s.listaGeneral(ctx, s.pool)
	if err != nil {
		return "", "", err
	}
	if !hay {
		return "", "", fallo("No hay una lista de precios general.")
	}
	precios, costos := 0, 0
	// Lo que cambió, para la bitácora: qué producto, de cuánto a cuánto
	// (M2S2-005).
	type cambio struct {
		Sku     string  `json:"sku"`
		Antes   *string `json:"antes"`
		Despues string  `json:"despues"`
	}
	var cambios []cambio
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var existe string
		err := tx.QueryRow(ctx, `SELECT id FROM supplier_price_profiles WHERE supplier_id = $1 LIMIT 1`, perfil.SupplierID).Scan(&existe)
		margen := jsmath.Fijo2(perfil.MargenPorcentaje)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			_, err = tx.Exec(ctx, `
				INSERT INTO supplier_price_profiles (supplier_id, columna_codigo, columna_precio, columna_descripcion, precio_es_neto, margen_porcentaje, updated_at)
				VALUES ($1, $2, $3, $4, $5, $6::numeric, now())`, perfil.SupplierID, perfil.ColumnaCodigo, perfil.ColumnaPrecio,
				perfil.ColumnaDescripcion, perfil.PrecioEsNeto, margen)
		case err == nil:
			_, err = tx.Exec(ctx, `
				UPDATE supplier_price_profiles SET columna_codigo = $2, columna_precio = $3, columna_descripcion = $4, precio_es_neto = $5,
				  margen_porcentaje = $6::numeric, updated_at = now() WHERE id = $1`, existe, perfil.ColumnaCodigo, perfil.ColumnaPrecio,
				perfil.ColumnaDescripcion, perfil.PrecioEsNeto, margen)
		}
		if err != nil {
			return err
		}
		var nombre string
		if err := tx.QueryRow(ctx, `SELECT nombre FROM suppliers WHERE id = $1`, perfil.SupplierID).Scan(&nombre); err != nil {
			return err
		}
		motivo := "Lista de " + nombre
		lote := uuidNuevo()
		for _, f := range filas {
			// El costo neto de la planilla queda como costo de reposición con
			// este proveedor: la orden siguiente lo sugiere (M3S2-029).
			if _, err := tx.Exec(ctx, `
				INSERT INTO supplier_variant_codes (supplier_id, variant_id, codigo, costo_neto, costo_at)
				VALUES ($1, $2, $3, $4::numeric, CASE WHEN $4::numeric IS NULL THEN NULL ELSE now() END)
				ON CONFLICT (supplier_id, codigo) DO UPDATE SET variant_id = excluded.variant_id,
				  costo_neto = coalesce(excluded.costo_neto, supplier_variant_codes.costo_neto),
				  costo_at = coalesce(excluded.costo_at, supplier_variant_codes.costo_at)`,
				perfil.SupplierID, f.VariantID, f.Codigo, f.CostoNeto); err != nil {
				return err
			}
			if !(f.PrecioSugerido > 0) {
				costos++
				continue
			}
			// El precio, con su renglón en el historial como cualquier
			// importación (M2S2-042): sin eso «Últimos cambios» no lo
			// mostraba y el deshacer no tenía de dónde volver.
			precio := jsmath.Fijo2(f.PrecioSugerido)
			var anterior *string
			var sku string
			err := tx.QueryRow(ctx, `SELECT (SELECT price::text FROM price_list_items WHERE price_list_id = $1 AND variant_id = $2 FOR UPDATE),
				coalesce((SELECT sku FROM product_variants WHERE id = $2), '')`, general, f.VariantID).Scan(&anterior, &sku)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			if anterior != nil && jsmath.Numero(*anterior) == jsmath.Numero(precio) {
				costos++
				continue
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO price_list_items (price_list_id, variant_id, price) VALUES ($1, $2, $3::numeric)
				ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = $3::numeric, updated_at = now()`, general, f.VariantID, precio); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO price_history (variant_id, price_list_id, precio_anterior, precio_nuevo, origen, motivo, lote_id, created_by_user_id)
				VALUES ($1, $2, $3::numeric, $4::numeric, 'importacion', $5, $6::uuid, $7)`,
				f.VariantID, general, anterior, precio, motivo, lote, ses.UserID); err != nil {
				return err
			}
			cambios = append(cambios, cambio{Sku: sku, Antes: anterior, Despues: precio})
			precios++
		}
		return nil
	})
	if err != nil {
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "precio", perfil.SupplierID,
		"Importó "+formato.Cuantos(precios, "precio", "precios")+" de la lista de "+s.nombreDelProveedor(ctx, perfil.SupplierID), map[string]any{"cambios": cambios})
	// Sin precios cambiados no se dice «0 precios actualizados» (mes 23).
	var partes []string
	if precios > 0 || costos == 0 {
		partes = append(partes, plural(precios, "precio actualizado", "precios actualizados"))
	}
	if costos > 0 {
		partes = append(partes, plural(costos, "costo guardado", "costos guardados"))
	}
	texto := "Listo: " + strings.Join(partes, " y ")
	return texto + ".", perfil.SupplierID, nil
}

// plural es «1 precio» o «3 precios».
func plural(n int, uno, varios string) string {
	if n == 1 {
		return "1 " + uno
	}
	return fmt.Sprintf("%d %s", n, varios)
}

func uuidNuevo() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

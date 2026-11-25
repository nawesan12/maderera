package compras

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
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
	type par struct{ variante, sku, label string }
	guardados, porSku := map[string]par{}, map[string]par{}
	filas, err := s.pool.Query(ctx, `
		SELECT c.codigo, c.variant_id, v.sku, v.label FROM supplier_variant_codes c JOIN product_variants v ON v.id = c.variant_id
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
	filas, err = s.pool.Query(ctx, `SELECT sku, id, label FROM product_variants WHERE active AND sku = ANY($1)`, unicos)
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
type FilaPreviaProveedor struct {
	FilaDeProveedor
	VariantID    *string  `json:"variantId"`
	Nuestro      *string  `json:"nuestro"`
	PrecioActual *float64 `json:"precioActual"`
}

// VistaPreviaProveedor es lo que va a pasar si se aplica.
type VistaPreviaProveedor struct {
	Filas      []FilaPreviaProveedor `json:"filas"`
	Problemas  []ProblemaDeFila      `json:"problemas"`
	Apareadas  int                   `json:"apareadas"`
	SinAparear int                   `json:"sinAparear"`
	Columnas   []string              `json:"columnas"`
	Error      *string               `json:"error,omitempty"`
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
	vista := VistaPreviaProveedor{Filas: []FilaPreviaProveedor{}, Problemas: problemas, Columnas: columnas}
	for _, f := range filas {
		x := FilaPreviaProveedor{FilaDeProveedor: f}
		if r, ok := porCodigo[f.Codigo]; ok && r.VariantID != nil {
			x.VariantID, x.Nuestro = r.VariantID, r.Descripcion
			if p, ok := actuales[*r.VariantID]; ok {
				x.PrecioActual = &p
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
		for _, f := range filas {
			if _, err := tx.Exec(ctx, `
				INSERT INTO supplier_variant_codes (supplier_id, variant_id, codigo) VALUES ($1, $2, $3)
				ON CONFLICT (supplier_id, codigo) DO UPDATE SET variant_id = excluded.variant_id`, perfil.SupplierID, f.VariantID, f.Codigo); err != nil {
				return err
			}
			precio := jsmath.Fijo2(f.PrecioSugerido)
			if _, err := tx.Exec(ctx, `
				INSERT INTO price_list_items (price_list_id, variant_id, price) VALUES ($1, $2, $3::numeric)
				ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = $3::numeric, updated_at = now()`, general, f.VariantID, precio); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", "", err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "precio", perfil.SupplierID,
		fmt.Sprintf("Importó %d precios desde la lista de un proveedor", len(filas)), nil)
	return fmt.Sprintf("Listo: %d precios actualizados. El mapeo quedó guardado.", len(filas)), perfil.SupplierID, nil
}

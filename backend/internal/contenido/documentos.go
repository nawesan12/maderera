package contenido

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// El panel de documentación técnica (app/admin/documentacion del TS).

// tiposDeDocumento: el tipo que declara el navegador y el formato que se
// guarda. Para el PDF y las imágenes se verifica además la firma del
// archivo; una planilla (zip) o un CSV no tienen una que sirva.
var tiposDeDocumento = map[string]struct {
	formato string
	firma   []byte
}{
	"application/pdf": {"pdf", []byte("%PDF-")},
	"image/jpeg":      {"jpg", []byte{0xff, 0xd8, 0xff}},
	"image/png":       {"png", []byte{0x89, 'P', 'N', 'G'}},
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {"xlsx", []byte("PK")},
	"text/csv": {"csv", nil},
}

// Archivo es lo que se sube (la misma forma que una imagen).
type Archivo = Imagen

// FormDocumento es el alta.
type FormDocumento struct {
	Titulo, Descripcion, Categoria string
	SoloProfesionales              bool
	Archivo                        *Archivo
}

// SubirDocumento guarda el archivo y lo publica.
func (s *Servicio) SubirDocumento(ctx context.Context, ses *auth.Sesion, f FormDocumento) error {
	f.Titulo, f.Descripcion, f.Categoria = strings.TrimSpace(f.Titulo), strings.TrimSpace(f.Descripcion), strings.TrimSpace(f.Categoria)
	if f.Categoria == "" {
		f.Categoria = "general"
	}
	largo := utf8.RuneCountInString
	switch {
	case largo(f.Titulo) < 3 || largo(f.Titulo) > 160:
		return plataforma.Invalido(map[string]string{"titulo": "Poné un título."})
	case largo(f.Descripcion) > 400:
		return plataforma.Invalido(map[string]string{"descripcion": "La descripción es muy larga."})
	case largo(f.Categoria) < 2 || largo(f.Categoria) > 60:
		return plataforma.Invalido(map[string]string{"categoria": "Revisá la categoría."})
	case f.Archivo == nil || len(f.Archivo.Datos) == 0:
		return plataforma.Invalido(map[string]string{"archivo": "Adjuntá el archivo."})
	}
	tipo := strings.ToLower(strings.TrimSpace(strings.SplitN(f.Archivo.Tipo, ";", 2)[0]))
	t, ok := tiposDeDocumento[tipo]
	if !ok || (t.firma != nil && !bytes.HasPrefix(f.Archivo.Datos, t.firma)) {
		return plataforma.Invalido(map[string]string{"archivo": "Subí un PDF, una planilla o una imagen."})
	}
	// En la carpeta privada, aunque sea para todos: la visibilidad se cambia
	// después sin mover el archivo, y lo entrega ArchivoDeDocumento mirando
	// quién lo pide (antes iba a /subidas/ y un documento «reservado» lo
	// bajaba cualquiera que tuviera el enlace).
	url, err := s.disco.GuardarPrivado(f.Archivo.Datos, tipo, "tecnica")
	if err != nil {
		return subidaInvalida("archivo", err)
	}
	var desc *string
	if f.Descripcion != "" {
		desc = &f.Descripcion
	}
	tam := int32(len(f.Archivo.Datos))
	id, err := s.q.CrearDocumento(ctx, sqlc.CrearDocumentoParams{
		Titulo: f.Titulo, Descripcion: desc, Categoria: f.Categoria, Url: url, Formato: t.formato,
		TamanoBytes: &tam, SoloProfesionales: f.SoloProfesionales,
	})
	if err != nil {
		_ = s.disco.Borrar(url)
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "documento", id, "Publicó el documento «"+f.Titulo+"»", nil)
	return nil
}

// VisibilidadDocumento lo reserva para profesionales o lo abre a todos.
func (s *Servicio) VisibilidadDocumento(ctx context.Context, ses *auth.Sesion, id string, soloProfesionales bool) error {
	n, err := s.q.DocumentoSoloProfesionales(ctx, sqlc.DocumentoSoloProfesionalesParams{ID: id, SoloProfesionales: soloProfesionales})
	if err != nil {
		return err
	}
	if n == 0 {
		return plataforma.NuevoProblema(404, "No pudimos identificar ese documento. Recargá la pantalla y probá de nuevo.")
	}
	desc := "Abrió a todos un documento"
	if soloProfesionales {
		desc = "Reservó un documento para profesionales"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "documento", id, desc, nil)
	return nil
}

// ActivarDocumento lo da de baja o lo vuelve a poner en línea. La baja no
// borra el archivo: se puede restaurar.
func (s *Servicio) ActivarDocumento(ctx context.Context, ses *auth.Sesion, id string, activo bool) error {
	n, err := s.q.DocumentoActivo(ctx, sqlc.DocumentoActivoParams{ID: id, Activo: activo})
	if err != nil {
		return err
	}
	if n == 0 {
		return plataforma.NuevoProblema(404, "No encontramos ese documento. Puede que ya lo hayan dado de baja.")
	}
	accion, desc := sqlc.AccionAuditoriaCambiarEstado, "Volvió a poner en línea un documento"
	if !activo {
		desc = "Dio de baja un documento"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "documento", id, desc, nil)
	return nil
}

// URLDelDocumento es el enlace que ven las pantallas: la ruta que mira quién
// pide, nunca la referencia guardada.
func URLDelDocumento(id string) string { return "/api/v1/contenido/documentos/" + id + "/archivo" }

// ArchivoDeDocumento es el archivo de un documento técnico para esta
// sesión: el abierto, para cualquiera; el reservado, para los profesionales
// aprobados; el dado de baja, solo para el panel. «No existe» y «no te
// corresponde» son lo mismo (nil): un 403 confirmaría que el documento está.
func (s *Servicio) ArchivoDeDocumento(ctx context.Context, ses *auth.Sesion, id string) (datos []byte, tipo string, publico bool, err error) {
	if !plataforma.UUIDValido(id) {
		return nil, "", false, nil
	}
	var ref string
	var activo, reservado bool
	err = s.pool.QueryRow(ctx, `SELECT url, activo, solo_profesionales FROM technical_documents WHERE id = $1`, id).Scan(&ref, &activo, &reservado)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, err
	}
	puede := activo && !reservado
	if !puede && ses.Tiene(roles.QuienEntra("/admin/documentacion")...) {
		puede = true
	}
	if !puede && activo && reservado {
		if puede, err = s.esProfesional(ctx, ses); err != nil {
			return nil, "", false, err
		}
	}
	if !puede {
		return nil, "", false, nil
	}
	datos, tipo = s.disco.LeerGuardado(ref)
	return datos, tipo, activo && !reservado, nil
}

// Destino es un producto o una categoría a la que está atado un documento.
type Destino struct {
	ID     string `json:"id"`
	Nombre string `json:"nombre"`
}

// DestinosDeDocumentos son los productos y las categorías de cada documento.
func (s *Servicio) DestinosDeDocumentos(ctx context.Context) (productos, categorias map[string][]Destino, err error) {
	productos, categorias = map[string][]Destino{}, map[string][]Destino{}
	filas, err := s.pool.Query(ctx, `
		SELECT t.document_id::text, coalesce(p.id, c.id)::text, coalesce(p.name, c.name), p.id IS NOT NULL
		FROM technical_document_targets t
		LEFT JOIN products p ON p.id = t.product_id
		LEFT JOIN categories c ON c.id = t.category_id
		ORDER BY 3`)
	if err != nil {
		return nil, nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var doc string
		var d Destino
		var esProducto bool
		if err := filas.Scan(&doc, &d.ID, &d.Nombre, &esProducto); err != nil {
			return nil, nil, err
		}
		if esProducto {
			productos[doc] = append(productos[doc], d)
		} else {
			categorias[doc] = append(categorias[doc], d)
		}
	}
	return productos, categorias, filas.Err()
}

// GuardarDestinos reemplaza a qué productos y categorías está atado el
// documento: la ficha de cada uno lo muestra (migración 00095).
func (s *Servicio) GuardarDestinos(ctx context.Context, ses *auth.Sesion, id string, productos, categorias []string) error {
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var titulo string
		if err := tx.QueryRow(ctx, `SELECT titulo FROM technical_documents WHERE id = $1 FOR UPDATE`, id).Scan(&titulo); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM technical_document_targets WHERE document_id = $1`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO technical_document_targets (document_id, product_id)
			SELECT $1, p.id FROM products p WHERE p.id = ANY($2::uuid[])`, id, productos); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `
			INSERT INTO technical_document_targets (document_id, category_id)
			SELECT $1, c.id FROM categories c WHERE c.id = ANY($2::uuid[])`, id, categorias)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return plataforma.NuevoProblema(404, "Ese documento no existe.")
	}
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "documento", id, "Cambió dónde se muestra un documento técnico", nil)
	return nil
}

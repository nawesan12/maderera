package contenido

import (
	"bytes"
	"context"
	"strings"
	"unicode/utf8"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/plataforma"
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
	url, err := s.disco.GuardarAdjunto(f.Archivo.Datos, tipo, "tecnica")
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

package contenido

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"

	"mjbj/internal/api/contenidoapi"
	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/email"
	"mjbj/internal/limites"
	"mjbj/internal/plataforma"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
)

// API son las rutas del contenido (api/contenido.yaml).
type API struct {
	s        *Servicio
	google   ConfigGoogle
	contacto ConfigContacto
	envio    email.Proveedor
	lim      *limites.Limitador
}

// NuevaAPI arma los handlers.
func NuevaAPI(s *Servicio, google ConfigGoogle, contacto ConfigContacto, envio email.Proveedor, lim *limites.Limitador) *API {
	return &API{s: s, google: google, contacto: contacto, envio: envio, lim: lim}
}

var _ contenidoapi.StrictServerInterface = (*API)(nil)

// respuesta escribe la estructura del servicio tal cual, con el código dado
// (204 sin cuerpo). Implementa la interfaz de respuesta de cada operación;
// la forma la verifican los tests contra el contrato.
type respuesta struct {
	codigo int
	v      any
}

func (o respuesta) escribir(w http.ResponseWriter) error {
	if o.codigo == http.StatusNoContent {
		w.WriteHeader(o.codigo)
		return nil
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(o.codigo)
	return json.NewEncoder(w).Encode(plataforma.SinNulos(o.v))
}

func ok(v any) respuesta     { return respuesta{http.StatusOK, v} }
func listo() respuesta       { return respuesta{codigo: http.StatusNoContent} }
func creado(v any) respuesta { return respuesta{http.StatusCreated, v} }

func (o respuesta) VisitAjustesResponse(w http.ResponseWriter) error            { return o.escribir(w) }
func (o respuesta) VisitPromosResponse(w http.ResponseWriter) error             { return o.escribir(w) }
func (o respuesta) VisitBannersResponse(w http.ResponseWriter) error            { return o.escribir(w) }
func (o respuesta) VisitResenasDelProductoResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitResumenDeResenasResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitMisResenablesResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitDejarResenaResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitAdminAjustesResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitGuardarAjusteResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitAdminResenasResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitModerarResenaResponse(w http.ResponseWriter) error      { return o.escribir(w) }
func (o respuesta) VisitAdminBannersResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitCrearBannerResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitEditarBannerResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitBorrarBannerResponse(w http.ResponseWriter) error       { return o.escribir(w) }
func (o respuesta) VisitAdminPromosResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitCrearPromoResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o respuesta) VisitEditarPromoResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitBorrarPromoResponse(w http.ResponseWriter) error        { return o.escribir(w) }
func (o respuesta) VisitDocumentosResponse(w http.ResponseWriter) error         { return o.escribir(w) }
func (o respuesta) VisitDocumentosReservadosResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEventosProximosResponse(w http.ResponseWriter) error   { return o.escribir(w) }
func (o respuesta) VisitSlugsDeEventosResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitEventoPorSlugResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitEventoVisibleResponse(w http.ResponseWriter) error     { return o.escribir(w) }
func (o respuesta) VisitSitemapResponse(w http.ResponseWriter) error           { return o.escribir(w) }
func (o respuesta) VisitEnviarConsultaResponse(w http.ResponseWriter) error    { return o.escribir(w) }
func (o respuesta) VisitResenasDelNegocioResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitResumenDelNegocioResponse(w http.ResponseWriter) error { return o.escribir(w) }
func (o respuesta) VisitAdminResenasDelNegocioResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitCrearResenaDelNegocioResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitEditarResenaDelNegocioResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitPublicarResenaDelNegocioResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitBorrarResenaDelNegocioResponse(w http.ResponseWriter) error {
	return o.escribir(w)
}
func (o respuesta) VisitTraerDeGoogleResponse(w http.ResponseWriter) error { return o.escribir(w) }

// Las rutas del panel son de quien puede abrir /admin/contenido (ACCESO).
func admin(ctx context.Context) (*auth.Sesion, error) {
	return auth.Exigir(ctx, roles.QuienEntra("/admin/contenido")...)
}

// --- lo público ---

func (a *API) Ajustes(ctx context.Context, _ contenidoapi.AjustesRequestObject) (contenidoapi.AjustesResponseObject, error) {
	v, err := a.s.Ajustes(ctx)
	return ok(v), err
}

func (a *API) Promos(ctx context.Context, _ contenidoapi.PromosRequestObject) (contenidoapi.PromosResponseObject, error) {
	v, err := a.s.Promos(ctx)
	return ok(v), err
}

func (a *API) Banners(ctx context.Context, r contenidoapi.BannersRequestObject) (contenidoapi.BannersResponseObject, error) {
	v, err := a.s.Banners(ctx, string(r.Params.Ubicacion))
	return ok(v), err
}

func (a *API) ResenasDelProducto(ctx context.Context, r contenidoapi.ResenasDelProductoRequestObject) (contenidoapi.ResenasDelProductoResponseObject, error) {
	v, err := a.s.Resenas(ctx, r.Id.String())
	return ok(v), err
}

func (a *API) ResumenDeResenas(ctx context.Context, r contenidoapi.ResumenDeResenasRequestObject) (contenidoapi.ResumenDeResenasResponseObject, error) {
	v, err := a.s.ResumenDeResenas(ctx, r.Id.String())
	return ok(v), err
}

// --- las reseñas del cliente ---

func (a *API) MisResenables(ctx context.Context, _ contenidoapi.MisResenablesRequestObject) (contenidoapi.MisResenablesResponseObject, error) {
	ses, err := auth.Exigir(ctx)
	if err != nil {
		return nil, err
	}
	v, err := a.s.Resenables(ctx, ses)
	return ok(v), err
}

func (a *API) DejarResena(ctx context.Context, r contenidoapi.DejarResenaRequestObject) (contenidoapi.DejarResenaResponseObject, error) {
	ses, err := auth.Exigir(ctx)
	if err != nil {
		return nil, err
	}
	texto := ""
	if r.Body.Texto != nil {
		texto = *r.Body.Texto
	}
	slug, err := a.s.DejarResena(ctx, ses, NuevaResena{
		ProductID: r.Body.ProductId.String(), OrderID: r.Body.OrderId.String(), Estrellas: r.Body.Estrellas, Texto: texto,
	})
	if err != nil {
		return nil, err
	}
	return creado(map[string]string{"slug": slug}), nil
}

// --- el panel ---

func (a *API) AdminAjustes(ctx context.Context, _ contenidoapi.AdminAjustesRequestObject) (contenidoapi.AdminAjustesResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.Ajustes(ctx)
	return ok(v), err
}

func (a *API) GuardarAjuste(ctx context.Context, r contenidoapi.GuardarAjusteRequestObject) (contenidoapi.GuardarAjusteResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	if err := a.s.GuardarAjuste(ctx, r.Clave, r.Body.Valor); err != nil {
		return nil, err
	}
	return listo(), nil
}

func (a *API) AdminResenas(ctx context.Context, _ contenidoapi.AdminResenasRequestObject) (contenidoapi.AdminResenasResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.ResenasParaModerar(ctx)
	return ok(v), err
}

func (a *API) ModerarResena(ctx context.Context, r contenidoapi.ModerarResenaRequestObject) (contenidoapi.ModerarResenaResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	motivo := ""
	if r.Body.Motivo != nil {
		motivo = *r.Body.Motivo
	}
	slug, err := a.s.Moderar(ctx, ses, r.Id.String(), string(r.Body.Estado), motivo)
	if err != nil {
		return nil, err
	}
	return ok(map[string]string{"slug": slug}), nil
}

func (a *API) AdminBanners(ctx context.Context, _ contenidoapi.AdminBannersRequestObject) (contenidoapi.AdminBannersResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.BannersTodos(ctx)
	return ok(v), err
}

func (a *API) AdminPromos(ctx context.Context, _ contenidoapi.AdminPromosRequestObject) (contenidoapi.AdminPromosResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.PromosTodas(ctx)
	return ok(v), err
}

// Los formularios con imagen llegan en multipart. Tope: la imagen (8 MB) y
// los textos.
const topeFormulario = 9 << 20

func leerFormulario(r *multipart.Reader) (map[string]string, *Imagen, error) {
	campos := map[string]string{}
	var img *Imagen
	leido := int64(0)
	for {
		p, err := r.NextPart()
		if errors.Is(err, io.EOF) {
			return campos, img, nil
		}
		if err != nil {
			return nil, nil, plataforma.NuevoProblema(http.StatusBadRequest, "El formulario llegó cortado.")
		}
		datos, err := io.ReadAll(io.LimitReader(p, topeFormulario-leido+1))
		if err != nil {
			return nil, nil, err
		}
		leido += int64(len(datos))
		if leido > topeFormulario {
			return nil, nil, plataforma.Invalido(map[string]string{"imagen": "La imagen pesa más de 8 MB."})
		}
		if p.FormName() == "imagen" {
			if len(datos) > 0 {
				img = &Imagen{Datos: datos, Tipo: p.Header.Get("Content-Type")}
			}
			continue
		}
		campos[p.FormName()] = string(datos)
	}
}

func entero(v string) int {
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0
	}
	return n
}

// En el formulario, un checkbox marcado llega como "on" (o "true").
func marcado(v string) bool { return v == "on" || v == "true" }

func formBanner(id string, r *multipart.Reader) (FormBanner, error) {
	c, img, err := leerFormulario(r)
	if err != nil {
		return FormBanner{}, err
	}
	return FormBanner{
		ID: id, Ubicacion: c["ubicacion"], Etiqueta: c["etiqueta"], Titulo: c["titulo"], Bajada: c["bajada"],
		Enlace: c["enlace"], TextoEnlace: c["textoEnlace"], Desde: c["desde"], Hasta: c["hasta"],
		Orden: entero(c["orden"]), Activo: marcado(c["activo"]), Imagen: img,
	}, nil
}

func formPromo(id string, r *multipart.Reader) (FormPromo, error) {
	c, img, err := leerFormulario(r)
	if err != nil {
		return FormPromo{}, err
	}
	return FormPromo{
		ID: id, Medio: c["medio"], Titulo: c["titulo"], Detalle: c["detalle"], Dias: c["dias"], QuienPaga: c["quienPaga"],
		VigenciaHasta: c["vigenciaHasta"], Orden: entero(c["orden"]), Activo: marcado(c["activo"]),
		QuitarImagen: marcado(c["quitarImagen"]), Imagen: img,
	}, nil
}

func (a *API) CrearBanner(ctx context.Context, r contenidoapi.CrearBannerRequestObject) (contenidoapi.CrearBannerResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	f, err := formBanner("", r.Body)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.GuardarBanner(ctx, ses, f)
}

func (a *API) EditarBanner(ctx context.Context, r contenidoapi.EditarBannerRequestObject) (contenidoapi.EditarBannerResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	f, err := formBanner(r.Id.String(), r.Body)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.GuardarBanner(ctx, ses, f)
}

func (a *API) BorrarBanner(ctx context.Context, r contenidoapi.BorrarBannerRequestObject) (contenidoapi.BorrarBannerResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.BorrarBanner(ctx, ses, r.Id.String())
}

func (a *API) CrearPromo(ctx context.Context, r contenidoapi.CrearPromoRequestObject) (contenidoapi.CrearPromoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	f, err := formPromo("", r.Body)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.GuardarPromo(ctx, ses, f)
}

func (a *API) EditarPromo(ctx context.Context, r contenidoapi.EditarPromoRequestObject) (contenidoapi.EditarPromoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	f, err := formPromo(r.Id.String(), r.Body)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.GuardarPromo(ctx, ses, f)
}

func (a *API) BorrarPromo(ctx context.Context, r contenidoapi.BorrarPromoRequestObject) (contenidoapi.BorrarPromoResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.BorrarPromo(ctx, ses, r.Id.String())
}

// --- las reseñas del negocio ---

func (a *API) ResenasDelNegocio(ctx context.Context, _ contenidoapi.ResenasDelNegocioRequestObject) (contenidoapi.ResenasDelNegocioResponseObject, error) {
	v, err := a.s.ResenasDelNegocio(ctx)
	return ok(v), err
}

func (a *API) ResumenDelNegocio(ctx context.Context, _ contenidoapi.ResumenDelNegocioRequestObject) (contenidoapi.ResumenDelNegocioResponseObject, error) {
	v, err := a.s.ResumenDelNegocio(ctx)
	return ok(v), err
}

func (a *API) AdminResenasDelNegocio(ctx context.Context, _ contenidoapi.AdminResenasDelNegocioRequestObject) (contenidoapi.AdminResenasDelNegocioResponseObject, error) {
	if _, err := admin(ctx); err != nil {
		return nil, err
	}
	v, err := a.s.q.ResenasDelNegocioTodas(ctx)
	return ok(v), err
}

func formNegocio(id string, b *contenidoapi.FormResenaNegocio) FormResenaNegocio {
	f := FormResenaNegocio{ID: id, Autor: b.Autor, Texto: b.Texto, Estrellas: b.Estrellas, Publicada: b.Publicada}
	if b.Fecha != nil {
		f.Fecha = *b.Fecha
	}
	return f
}

func (a *API) CrearResenaDelNegocio(ctx context.Context, r contenidoapi.CrearResenaDelNegocioRequestObject) (contenidoapi.CrearResenaDelNegocioResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	pub, err := a.s.GuardarResenaNegocio(ctx, ses, formNegocio("", r.Body))
	if err != nil {
		return nil, err
	}
	return ok(map[string]bool{"publicada": pub}), nil
}

func (a *API) EditarResenaDelNegocio(ctx context.Context, r contenidoapi.EditarResenaDelNegocioRequestObject) (contenidoapi.EditarResenaDelNegocioResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	pub, err := a.s.GuardarResenaNegocio(ctx, ses, formNegocio(r.Id.String(), r.Body))
	if err != nil {
		return nil, err
	}
	return ok(map[string]bool{"publicada": pub}), nil
}

func (a *API) PublicarResenaDelNegocio(ctx context.Context, r contenidoapi.PublicarResenaDelNegocioRequestObject) (contenidoapi.PublicarResenaDelNegocioResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.PublicarResenaNegocio(ctx, ses, r.Id.String(), r.Body.Publicada)
}

func (a *API) BorrarResenaDelNegocio(ctx context.Context, r contenidoapi.BorrarResenaDelNegocioRequestObject) (contenidoapi.BorrarResenaDelNegocioResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	return listo(), a.s.BorrarResenaNegocio(ctx, ses, r.Id.String())
}

func (a *API) TraerDeGoogle(ctx context.Context, _ contenidoapi.TraerDeGoogleRequestObject) (contenidoapi.TraerDeGoogleResponseObject, error) {
	ses, err := admin(ctx)
	if err != nil {
		return nil, err
	}
	r, err := a.s.SincronizarGoogle(ctx, a.google)
	var eg *ErrGoogle
	if errors.As(err, &eg) {
		return nil, plataforma.NuevoProblema(http.StatusUnprocessableEntity, eg.Mensaje)
	}
	if err != nil {
		return nil, err
	}
	bitacora.Anotar(ctx, a.s.q, a.s.log, ses, sqlc.AccionAuditoriaCrear, "resena", "",
		"Trajo "+strconv.Itoa(r.Nuevas)+" reseñas nuevas de Google", nil)
	return ok(r), nil
}

// --- documentos, eventos, sitemap y contacto ---

func (a *API) Documentos(ctx context.Context, _ contenidoapi.DocumentosRequestObject) (contenidoapi.DocumentosResponseObject, error) {
	v, err := a.s.Documentos(ctx, auth.DeContexto(ctx))
	return ok(v), err
}

func (a *API) DocumentosReservados(ctx context.Context, _ contenidoapi.DocumentosReservadosRequestObject) (contenidoapi.DocumentosReservadosResponseObject, error) {
	v, err := a.s.q.DocumentosReservados(ctx)
	return ok(v), err
}

func (a *API) EventosProximos(ctx context.Context, _ contenidoapi.EventosProximosRequestObject) (contenidoapi.EventosProximosResponseObject, error) {
	v, err := a.s.EventosProximos(ctx)
	return ok(v), err
}

func (a *API) SlugsDeEventos(ctx context.Context, r contenidoapi.SlugsDeEventosRequestObject) (contenidoapi.SlugsDeEventosResponseObject, error) {
	v, err := a.s.q.SlugsDeEventosVisibles(ctx, int32(r.Params.Limite))
	return ok(v), err
}

func (a *API) EventoPorSlug(ctx context.Context, r contenidoapi.EventoPorSlugRequestObject) (contenidoapi.EventoPorSlugResponseObject, error) {
	v, err := a.s.EventoPorSlug(ctx, auth.DeContexto(ctx), r.Slug)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, plataforma.NuevoProblema(http.StatusNotFound, "Ese evento no existe.")
	}
	return ok(v), nil
}

func (a *API) EventoVisible(ctx context.Context, r contenidoapi.EventoVisibleRequestObject) (contenidoapi.EventoVisibleResponseObject, error) {
	v, err := a.s.q.EventoVisible(ctx, r.Slug)
	return ok(v), err
}

func (a *API) Sitemap(ctx context.Context, r contenidoapi.SitemapRequestObject) (contenidoapi.SitemapResponseObject, error) {
	v, err := a.s.Sitemap(ctx, string(r.Seccion))
	return ok(v), err
}

func (a *API) EnviarConsulta(ctx context.Context, r contenidoapi.EnviarConsultaRequestObject) (contenidoapi.EnviarConsultaResponseObject, error) {
	c := Consulta{Nombre: r.Body.Nombre, Email: r.Body.Email, Motivo: r.Body.Motivo, Mensaje: r.Body.Mensaje}
	if r.Body.Telefono != nil {
		c.Telefono = *r.Body.Telefono
	}
	if err := c.validar(); err != nil {
		return nil, err
	}
	// Por IP y por correo, como el TS: la validación va antes, así un
	// formulario mal llenado no gasta intentos.
	ip := plataforma.IPDelCliente(plataforma.PedidoDe(ctx))
	if v := a.lim.PorAmbos(ctx, limites.Contacto, ip, "correo", c.Email); !v.Permitido {
		return nil, plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
	}
	res, err := a.s.EnviarConsulta(ctx, a.envio, a.contacto, c)
	if err != nil {
		return nil, err
	}
	return ok(map[string]ResultadoConsulta{"resultado": res}), nil
}

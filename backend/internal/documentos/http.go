// Package documentos expone los PDF y las planillas que ya tienen sus datos
// en Go (api/documentos.yaml): la lista de precios del cliente y la
// exportación de precios del panel. Los documentos los arma internal/pdf.
package documentos

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/api/documentosapi"
	"mjbj/internal/auth"
	"mjbj/internal/catalogo"
	"mjbj/internal/limites"
	"mjbj/internal/pdf"
	"mjbj/internal/planilla"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/roles"
)

// API son las rutas de los documentos.
type API struct {
	pool     *pgxpool.Pool
	catalogo *catalogo.Servicio
	precios  *precios.Servicio
	lim      *limites.Limitador
	// ahora es el reloj (las pruebas lo fijan).
	ahora func() time.Time
}

// NuevaAPI arma los handlers.
func NuevaAPI(pool *pgxpool.Pool, lim *limites.Limitador, log *slog.Logger) *API {
	return &API{pool: pool, catalogo: catalogo.Nuevo(pool), precios: precios.Nuevo(pool, log), lim: lim, ahora: time.Now}
}

var _ documentosapi.StrictServerInterface = (*API)(nil)

// archivo es la respuesta 200: los bytes con su tipo, cómo se baja y que
// nunca se guarde en una caché compartida (el precio depende de quién pide).
type archivo struct {
	tipo, disposicion, cache string
	datos                    []byte
}

func (a archivo) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", a.tipo)
	w.Header().Set("Content-Disposition", a.disposicion)
	w.Header().Set("Cache-Control", a.cache)
	w.Header().Set("Content-Length", fmt.Sprint(len(a.datos)))
	w.WriteHeader(http.StatusOK)
	_, err := bytes.NewReader(a.datos).WriteTo(w)
	return err
}

func (a archivo) VisitMiListaDePreciosPdfResponse(w http.ResponseWriter) error { return a.escribir(w) }
func (a archivo) VisitExportarPreciosResponse(w http.ResponseWriter) error     { return a.escribir(w) }

// emisor son los datos legales del membrete (obtenerConfiguracionFiscal).
// El TS crea la fila con los valores por omisión si no está; acá no se
// escribe nada desde un GET: sin fila, el membrete sale con los mismos
// valores por omisión (la razón social de siempre y nada más), que es lo
// que dibujaría esa fila recién creada.
func (a *API) emisor(ctx context.Context) (*pdf.Emisor, error) { return EmisorDe(ctx, a.pool) }

// EmisorDe es el membrete, para los PDF que arman otros dominios.
func EmisorDe(ctx context.Context, pool *pgxpool.Pool) (*pdf.Emisor, error) {
	var razon string
	var fantasia, domicilio, cuit *string
	err := pool.QueryRow(ctx, `SELECT razon_social, nombre_fantasia, domicilio, cuit FROM configuracion_fiscal LIMIT 1`).
		Scan(&razon, &fantasia, &domicilio, &cuit)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	de := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	return &pdf.Emisor{RazonSocial: razon, NombreFantasia: de(fantasia), Domicilio: de(domicilio), Cuit: de(cuit)}, nil
}

const leyendaConIva = "Precios finales con IVA incluido"

// MiListaDePreciosPdf es app/(public)/mi-lista-de-precios/route.ts: la lista
// de quien pide, con los precios de su lista (Vigente), nunca de un
// parámetro.
func (a *API) MiListaDePreciosPdf(ctx context.Context, _ documentosapi.MiListaDePreciosPdfRequestObject) (documentosapi.MiListaDePreciosPdfResponseObject, error) {
	ses, err := auth.ExigirSesion(ctx)
	if err != nil {
		return nil, err
	}
	if v := a.lim.Permitido(ctx, limites.ListaDePrecios, "usuario:"+ses.UserID); !v.Permitido {
		return nil, plataforma.NuevoProblema(http.StatusTooManyRequests, limites.AvisoDeEspera(v))
	}
	l, err := a.catalogo.Vigente(ctx, ses)
	if err != nil {
		return nil, err
	}
	filas, err := a.catalogo.FilasDeMiLista(ctx, l)
	if err != nil {
		return nil, err
	}
	titulo := "Lista de precios"
	if l.EsDiferenciada && l.Nombre != nil {
		titulo = "Lista " + *l.Nombre
	}
	emisor, err := a.emisor(ctx)
	if err != nil {
		return nil, err
	}
	datos := pdf.DatosLista{Titulo: titulo, Emisor: emisor, LeyendaIva: leyendaConIva, Filas: make([]pdf.FilaDeLista, len(filas))}
	for i, f := range filas {
		datos.Filas[i] = pdf.FilaDeLista{Sku: f.SKU, Producto: f.Producto, Medida: f.Medida, Categoria: f.Categoria, Precio: f.Precio}
	}
	ahora := a.ahora()
	b, err := pdf.ListaDePrecios(datos, ahora)
	if err != nil {
		return nil, err
	}
	return archivo{
		tipo:        "application/pdf",
		disposicion: `inline; filename="lista-precios-mjbj-` + ahora.UTC().Format("2006-01-02") + `.pdf"`,
		cache:       "no-store, private",
		datos:       b,
	}, nil
}

// ExportarPrecios es app/admin/precios/exportar/route.ts: la grilla con los
// filtros de la pantalla, en CSV para trabajarla o en PDF para mandarla.
func (a *API) ExportarPrecios(ctx context.Context, r documentosapi.ExportarPreciosRequestObject) (documentosapi.ExportarPreciosResponseObject, error) {
	if _, err := auth.Exigir(ctx, roles.QuienEntra("/admin/precios")...); err != nil {
		return nil, err
	}
	busqueda := texto(r.Params.Buscar)
	if len([]rune(busqueda)) > 200 {
		busqueda = string([]rune(busqueda)[:200]) // listarPrecios corta a 200
	}
	ahora := a.ahora()
	filas, err := a.precios.Listar(ctx, busqueda, texto(r.Params.Cat), ahora)
	if err != nil {
		return nil, err
	}
	fecha := ahora.UTC().Format("2006-01-02")

	if r.Params.Formato != nil && *r.Params.Formato == documentosapi.Pdf {
		profesional := texto(r.Params.Lista) == "profesional"
		titulo := "Lista de precios"
		if profesional {
			titulo = "Lista profesional"
		}
		emisor, err := a.emisor(ctx)
		if err != nil {
			return nil, err
		}
		datos := pdf.DatosLista{Titulo: titulo, Emisor: emisor, LeyendaIva: leyendaConIva, Filas: make([]pdf.FilaDeLista, len(filas))}
		for i, f := range filas {
			precio := f.PrecioGeneral
			if profesional {
				precio = f.PrecioProfesional
			}
			datos.Filas[i] = pdf.FilaDeLista{Sku: f.SKU, Producto: f.Producto, Medida: f.Medida, Categoria: f.Categoria, Precio: &precio}
		}
		b, err := pdf.ListaDePrecios(datos, ahora)
		if err != nil {
			return nil, err
		}
		return archivo{
			tipo:        "application/pdf",
			disposicion: `inline; filename="precios-mjbj-` + fecha + `.pdf"`,
			cache:       "no-store",
			datos:       b,
		}, nil
	}

	planillaFilas := make([]planilla.FilaPlanilla, len(filas))
	for i, f := range filas {
		planillaFilas[i] = planilla.FilaPlanilla{Sku: f.SKU, Producto: f.Producto, Medida: f.Medida, Categoria: f.Categoria,
			PrecioGeneral: f.PrecioGeneral, PrecioProfesional: f.PrecioProfesional}
	}
	return archivo{
		tipo:        "text/csv; charset=utf-8",
		disposicion: `attachment; filename="precios-mjbj-` + fecha + `.csv"`,
		cache:       "no-store",
		datos:       []byte(planilla.GenerarCsv(planillaFilas)),
	}, nil
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

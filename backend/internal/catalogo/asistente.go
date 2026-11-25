package catalogo

import (
	"context"

	"mjbj/internal/api/catalogoapi"
	"mjbj/internal/asistente"
)

// EntenderAsistente es el motor sin IA para el asistente del sitio: el mismo
// que usa el bot de WhatsApp (internal/asistente), así los dos entienden
// igual. Es lógica pura y barata; no consulta la base.
func (a *API) EntenderAsistente(_ context.Context, r catalogoapi.EntenderAsistenteRequestObject) (catalogoapi.EntenderAsistenteResponseObject, error) {
	anterior := ""
	if r.Body.Anterior != nil {
		anterior = *r.Body.Anterior
	}
	texto := asistente.ConContexto(r.Body.Texto, anterior)
	e := asistente.Entender(texto)

	out := catalogoapi.EntenderAsistente200JSONResponse{
		Intencion: catalogoapi.EntendidoIntencion(e.Intencion),
		Puntaje:   e.Puntaje,
		Texto:     texto,
		Consulta:  e.Consulta,
	}
	out.Medida.EspesorMm = siHay(e.Medida.EspesorMm)
	out.Medida.LargoMm = siHay(e.Medida.LargoMm)
	out.Medida.AnchoMm = siHay(e.Medida.AnchoMm)
	if e.Cantidad != nil {
		out.Cantidad = &struct {
			Unidad catalogoapi.EntendidoCantidadUnidad `json:"unidad"`
			Valor  float64                             `json:"valor"`
		}{catalogoapi.EntendidoCantidadUnidad(e.Cantidad.Unidad), e.Cantidad.Valor}
	}
	if e.Rubro != "" {
		out.Rubro = &e.Rubro
	}
	if d := e.Despiece; d != nil {
		out.Despiece = &struct {
			Material string `json:"material"`
			Piezas   []struct {
				AnchoMm    int `json:"anchoMm"`
				Cantidad   int `json:"cantidad"`
				CantoAncho int `json:"cantoAncho"`
				CantoLargo int `json:"cantoLargo"`
				LargoMm    int `json:"largoMm"`
			} `json:"piezas"`
		}{Material: d.Material}
		for _, p := range d.Piezas {
			out.Despiece.Piezas = append(out.Despiece.Piezas, struct {
				AnchoMm    int `json:"anchoMm"`
				Cantidad   int `json:"cantidad"`
				CantoAncho int `json:"cantoAncho"`
				CantoLargo int `json:"cantoLargo"`
				LargoMm    int `json:"largoMm"`
			}{p.AnchoMm, p.Cantidad, p.CantoAncho, p.CantoLargo, p.LargoMm})
		}
		enlace := asistente.EnlaceDelDespiece(*d)
		out.Enlace = &enlace
	}
	return out, nil
}

func siHay(n int) *int {
	if n == 0 {
		return nil
	}
	return &n
}

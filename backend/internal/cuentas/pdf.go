package cuentas

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"mjbj/internal/api/cuentasapi"
	"mjbj/internal/auth"
	"mjbj/internal/cobros"
	"mjbj/internal/documentos"
	"mjbj/internal/pdf"
)

// Los PDF del recibo y del resumen de cuenta (app/api/recibos/[id]/pdf y
// app/api/cuenta/[id]/pdf). La regla es la misma que tenían: el personal baja
// cualquiera y el cliente solo los suyos; a quien no puede verlo se le
// contesta 404 y no 403, que confirmaría que existe.

type archivo struct {
	disposicion string
	datos       []byte
}

func (a archivo) escribir(w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", a.disposicion)
	w.Header().Set("Cache-Control", "private, no-store")
	w.WriteHeader(http.StatusOK)
	_, err := bytes.NewReader(a.datos).WriteTo(w)
	return err
}

func (a archivo) VisitReciboPdfResponse(w http.ResponseWriter) error          { return a.escribir(w) }
func (a archivo) VisitResumenDeCuentaPdfResponse(w http.ResponseWriter) error { return a.escribir(w) }

func de(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// puedeVer: personal, o el cliente de la sesión es el dueño.
func (a *API) puedeVer(ctx context.Context, dueno func() (*string, error)) error {
	ses := auth.DeContexto(ctx)
	if ses == nil {
		return noEsta("No encontrado")
	}
	if ses.EsStaff() {
		return nil
	}
	d, err := dueno()
	if err != nil {
		return err
	}
	propio, err := a.clienteDeLaSesion(ctx, ses)
	if err != nil {
		return err
	}
	if d == nil || propio == nil || *d != propio.id {
		return noEsta("No encontrado")
	}
	return nil
}

func (a *API) ReciboPdf(ctx context.Context, r cuentasapi.ReciboPdfRequestObject) (cuentasapi.ReciboPdfResponseObject, error) {
	id := r.Id.String()
	if err := a.puedeVer(ctx, func() (*string, error) {
		d, err := cobros.DuenoDelRecibo(ctx, a.pool, id)
		if errors.Is(err, cobros.ErrNoEsta) {
			return nil, nil
		}
		return d, err
	}); err != nil {
		return nil, err
	}
	rec, err := cobros.Recibo(ctx, a.pool, id)
	if errors.Is(err, cobros.ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	if err != nil {
		return nil, err
	}
	emisor, err := documentos.EmisorDe(ctx, a.pool)
	if err != nil {
		return nil, err
	}
	b, err := pdf.Recibo(pdf.DatosRecibo{Recibo: ReciboParaPdf(rec), Emisor: emisor}, a.ahora())
	if err != nil {
		return nil, err
	}
	return archivo{`inline; filename="recibo-` + rec.Numero + `.pdf"`, b}, nil
}

// ReciboParaPdf pasa el recibo de cobros a lo que dibuja internal/pdf.
func ReciboParaPdf(r *cobros.ReciboCompleto) pdf.ReciboCompleto {
	out := pdf.ReciboCompleto{ID: r.ID, Numero: r.Numero, Fecha: r.Fecha, Estado: r.Estado, Origen: r.Origen, Concepto: de(r.Concepto),
		Total: r.Total, RecibidoDe: r.RecibidoDe, MotivoAnulacion: de(r.MotivoAnulacion), AnuladoAt: r.AnuladoAt,
		SaldoDespues: r.SaldoDespues, EmitidoPor: de(r.EmitidoPor), Partes: make([]pdf.ParteDelRecibo, len(r.Partes))}
	if r.Cliente != nil {
		out.Cliente = &pdf.ClienteDelRecibo{ID: r.Cliente.ID, Cuit: de(r.Cliente.Cuit), Direccion: de(r.Cliente.Direccion)}
	}
	for i, p := range r.Partes {
		out.Partes[i] = pdf.ParteDelRecibo{Medio: p.Medio, Importe: p.Importe, Referencia: de(p.Referencia)}
		if c := p.Cheque; c != nil {
			out.Partes[i].Cheque = &pdf.ChequeDelRecibo{ID: c.ID, Tipo: c.Tipo, Numero: c.Numero, Banco: c.Banco, Librador: de(c.Librador),
				FechaPago: c.FechaPago, Estado: c.Estado}
		}
	}
	return out
}

func (a *API) ResumenDeCuentaPdf(ctx context.Context, r cuentasapi.ResumenDeCuentaPdfRequestObject) (cuentasapi.ResumenDeCuentaPdfResponseObject, error) {
	id := r.Id.String()
	if err := a.puedeVer(ctx, func() (*string, error) { return &id, nil }); err != nil {
		return nil, err
	}
	res, err := cobros.Resumen(ctx, a.pool, id, a.ahora())
	if errors.Is(err, cobros.ErrNoEsta) {
		return nil, noEsta("No encontrado")
	}
	if err != nil {
		return nil, err
	}
	emisor, err := documentos.EmisorDe(ctx, a.pool)
	if err != nil {
		return nil, err
	}
	b, err := pdf.ResumenCuenta(pdf.DatosResumenCuenta{Resumen: resumenParaPdf(res), Emisor: emisor}, a.ahora())
	if err != nil {
		return nil, err
	}
	nombre := res.Cliente.Nombre
	if res.Cliente.RazonSocial != nil && *res.Cliente.RazonSocial != "" {
		nombre = *res.Cliente.RazonSocial
	}
	return archivo{`attachment; filename="cuenta-` + nombreDeArchivo(nombre) + `.pdf"`, b}, nil
}

func resumenParaPdf(r *cobros.ResumenDeCuenta) pdf.ResumenDeCuenta {
	out := pdf.ResumenDeCuenta{Saldo: r.Saldo,
		Cliente: pdf.ClienteDelResumen{ID: r.Cliente.ID, Nombre: r.Cliente.Nombre, RazonSocial: de(r.Cliente.RazonSocial),
			Cuit: de(r.Cliente.Cuit), Direccion: de(r.Cliente.Direccion), LimiteCredito: r.Cliente.LimiteCredito},
		Aging:       pdf.AgingDelResumen{Total: r.Aging.Total, AFavor: r.Aging.AFavor},
		Movimientos: make([]pdf.MovimientoDelResumen, len(r.Movimientos))}
	if d := r.Aging.DiasDeLaMasVieja; d != nil {
		f := float64(*d)
		out.Aging.DiasDeLaMasVieja = &f
	}
	for _, t := range r.Aging.Tramos {
		out.Aging.Tramos = append(out.Aging.Tramos, pdf.TramoDeAging{Etiqueta: t.Etiqueta, Monto: t.Monto})
	}
	for i, m := range r.Movimientos {
		out.Movimientos[i] = pdf.MovimientoDelResumen{ID: m.ID, Fecha: m.Fecha, Tipo: m.Tipo, Detalle: de(m.Detalle), Referencia: m.Referencia,
			Monto: m.Monto, Saldo: m.Saldo}
	}
	return out
}

var noAlfanumerico = regexp.MustCompile(`[^a-zA-Z0-9]+`)

// nombreDeArchivo es el del TS: sin tildes, lo demás a guiones, en minúscula.
func nombreDeArchivo(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if !unicode.Is(unicode.Mn, r) {
			b.WriteRune(r)
		}
	}
	return strings.ToLower(noAlfanumerico.ReplaceAllString(b.String(), "-"))
}

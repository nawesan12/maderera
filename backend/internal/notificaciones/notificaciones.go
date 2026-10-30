// Package notificaciones son los avisos al cliente que se encolan cuando
// pasa algo con su plata: el recibo emitido, el cheque rechazado y el
// comprobante emitido (lib/notificaciones/{cobros,fiscal}.ts). Cada uno va
// por WhatsApp y por correo, con el PDF cuando lo hay. Los atiende el worker:
// el cobro o la factura ya se confirmaron y un aviso que falla no los toca.
package notificaciones

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/avisos"
	"mjbj/internal/cobros"
	"mjbj/internal/cola"
	"mjbj/internal/cuentas"
	"mjbj/internal/documentos"
	"mjbj/internal/email"
	"mjbj/internal/facturacion"
	"mjbj/internal/formato"
	"mjbj/internal/pdf"
	"mjbj/internal/whatsapp"
)

// Servicio arma y manda los avisos.
type Servicio struct {
	pool        *pgxpool.Pool
	sitio       string
	correo      *avisos.Servicio
	wa          *whatsapp.Servicio
	facturacion *facturacion.Servicio
	log         *slog.Logger
}

// Nuevo arma el servicio. sitio es la URL pública (APP_URL).
func Nuevo(pool *pgxpool.Pool, sitio string, correo *avisos.Servicio, wa *whatsapp.Servicio, f *facturacion.Servicio, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, sitio: sitio, correo: correo, wa: wa, facturacion: f, log: log}
}

// Registrar suma los tres manejadores a la cola.
func (s *Servicio) Registrar(c *cola.Cola) {
	c.Registrar(cobros.TrabajoAvisoDeRecibo, s.manejador(func(ctx context.Context, crudo json.RawMessage) error {
		var carga struct {
			ReceiptID string `json:"receiptId"`
		}
		if err := json.Unmarshal(crudo, &carga); err != nil {
			return err
		}
		return s.Recibo(ctx, carga.ReceiptID)
	}))
	c.Registrar(cobros.TrabajoChequeRechazado, s.manejador(func(ctx context.Context, crudo json.RawMessage) error {
		var carga struct {
			ChequeID   string `json:"chequeId"`
			PorElBanco bool   `json:"porElBanco"`
		}
		if err := json.Unmarshal(crudo, &carga); err != nil {
			return err
		}
		return s.ChequeRechazado(ctx, carga.ChequeID, carga.PorElBanco)
	}))
	c.Registrar(facturacion.TrabajoAvisoDeFactura, s.manejador(func(ctx context.Context, crudo json.RawMessage) error {
		var carga struct {
			InvoiceID string `json:"invoiceId"`
		}
		if err := json.Unmarshal(crudo, &carga); err != nil {
			return err
		}
		return s.Factura(ctx, carga.InvoiceID)
	}))
}

// manejador no reintenta: como en el TS, un aviso que no sale queda en el
// registro de avisos y en el log, y no se vuelve a mandar (un reintento
// mandaría dos veces el WhatsApp que sí salió). El correo que rebota
// temporalmente ya se reintenta solo (email.reintento).
func (s *Servicio) manejador(f func(context.Context, json.RawMessage) error) cola.Manejador {
	return func(ctx context.Context, crudo json.RawMessage) error {
		if err := f(ctx, crudo); err != nil {
			s.log.Error("notificaciones: el aviso no salió", "carga", string(crudo), "error", err)
		}
		return nil
	}
}

func primerNombre(n string) string { return strings.Split(n, " ")[0] }

type cliente struct {
	nombre          string
	email, telefono *string
}

func (s *Servicio) cliente(ctx context.Context, id string) (*cliente, error) {
	var c cliente
	err := s.pool.QueryRow(ctx, `SELECT nombre, email, telefono FROM customers WHERE id = $1`, id).Scan(&c.nombre, &c.email, &c.telefono)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

// Recibo es notificarRecibo: WhatsApp y correo, con el recibo en PDF.
func (s *Servicio) Recibo(ctx context.Context, id string) error {
	r, err := cobros.Recibo(ctx, s.pool, id)
	if errors.Is(err, cobros.ErrNoEsta) {
		return nil
	}
	if err != nil {
		return err
	}
	if r.Cliente == nil || r.Estado != "emitido" {
		return nil
	}
	c, err := s.cliente(ctx, r.Cliente.ID)
	if err != nil || c == nil {
		return err
	}
	emisor, err := documentos.EmisorDe(ctx, s.pool)
	if err != nil {
		return err
	}
	archivo, err := pdf.Recibo(pdf.DatosRecibo{Recibo: cuentas.ReciboParaPdf(r), Emisor: emisor}, timeNow())
	if err != nil {
		return err
	}
	nombreArchivo := "recibo-" + r.Numero + ".pdf"
	var medios []string
	vistos := map[string]bool{}
	for _, p := range r.Partes {
		m := cobros.NombreDelMedio[cobros.Medio(p.Medio)]
		if !vistos[m] {
			vistos[m] = true
			medios = append(medios, m)
		}
	}
	saldo := 0.0
	if r.SaldoDespues != nil {
		saldo = *r.SaldoDespues
	}
	nombre := c.nombre
	s.wa.AvisarPorWhatsapp(ctx, whatsapp.OpcionesAviso{
		Evento: "recibo_emitido", Telefono: c.telefono, Nombre: &nombre,
		Valores:      map[string]string{"importe": formato.MonedaEntera(r.Total), "recibo": r.Numero, "saldo": formato.MonedaEntera(saldo)},
		Entidad:      &whatsapp.Entidad{Tipo: "receipt", ID: id},
		ConDocumento: true, Documento: &whatsapp.Documento{Contenido: archivo, Nombre: nombreArchivo},
	})
	if c.email == nil || *c.email == "" {
		return nil
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "recibo_emitido", Para: *c.email, EntidadTipo: "receipt", EntidadID: id,
		Correo:   avisos.ReciboEmitido(s.sitio, primerNombre(c.nombre), r.Numero, r.Total, strings.Join(medios, ", "), r.SaldoDespues),
		Adjuntos: []email.Adjunto{{Nombre: nombreArchivo, Contenido: archivo, Tipo: "application/pdf"}},
	})
	return nil
}

// ChequeRechazado es notificarChequeRechazado.
func (s *Servicio) ChequeRechazado(ctx context.Context, id string, porElBanco bool) error {
	var tipo, numero, nombre string
	var banco, motivo, correo, telefono *string
	var importe float64
	err := s.pool.QueryRow(ctx, `SELECT ch.tipo::text, ch.numero, ch.banco, ch.importe::float8, ch.motivo_rechazo, c.nombre, c.email, c.telefono
		FROM cheques ch JOIN customers c ON c.id = ch.customer_id WHERE ch.id = $1`, id).
		Scan(&tipo, &numero, &banco, &importe, &motivo, &nombre, &correo, &telefono)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	cheque := cobros.NombreDelCheque(tipo, banco, numero)
	m := ""
	if motivo != nil {
		m = strings.TrimSpace(*motivo)
	}
	paraWa := m
	if paraWa == "" {
		paraWa = "no se pudo tomar"
		if porElBanco {
			paraWa = "lo rechazó el banco"
		}
	}
	s.wa.AvisarPorWhatsapp(ctx, whatsapp.OpcionesAviso{
		Evento: "cheque_rechazado", Telefono: telefono, Nombre: &nombre,
		Valores: map[string]string{"cheque": cheque, "importe": formato.MonedaEntera(importe), "motivo": paraWa},
		Entidad: &whatsapp.Entidad{Tipo: "cheque", ID: id},
	})
	if correo == nil || *correo == "" {
		return nil
	}
	sinRecortar := ""
	if motivo != nil {
		sinRecortar = *motivo
	}
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "cheque_rechazado", Para: *correo, EntidadTipo: "cheque", EntidadID: id,
		Correo: avisos.ChequeRechazado(s.sitio, primerNombre(nombre), cheque, importe, sinRecortar, porElBanco),
	})
	return nil
}

// Factura es enviarComprobantePorCorreo: el correo con el comprobante en PDF
// a quien tiene ficha con correo.
func (s *Servicio) Factura(ctx context.Context, id string) error {
	c, err := s.facturacion.Obtener(ctx, id)
	if err != nil || c == nil {
		return err
	}
	if c.CustomerID == nil {
		return nil
	}
	cl, err := s.cliente(ctx, *c.CustomerID)
	if err != nil || cl == nil || cl.email == nil || *cl.email == "" {
		return err
	}
	archivo, nombreArchivo, err := s.facturacion.Pdf(ctx, c)
	if err != nil {
		return err
	}
	etiqueta := fmt.Sprintf("%s %04d-%08d", strings.ToUpper(c.Tipo), c.PuntoVenta, c.Numero)
	nombre := primerNombre(c.ReceptorNombre)
	if nombre == "" {
		nombre = "cliente"
	}
	total, _ := strconv.ParseFloat(c.Total, 64)
	s.correo.Despachar(ctx, avisos.Despacho{
		Evento: "factura_emitida", Para: *cl.email, EntidadTipo: "invoice", EntidadID: id,
		Correo:   avisos.FacturaEmitida(s.sitio, nombre, etiqueta, total, c.Cae != nil && *c.Cae != ""),
		Adjuntos: []email.Adjunto{{Nombre: nombreArchivo, Contenido: archivo, Tipo: "application/pdf"}},
	})
	return nil
}

var timeNow = time.Now

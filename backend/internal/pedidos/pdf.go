package pedidos

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/documentos"
	"mjbj/internal/pdf"
)

// El presupuesto en PDF (app/api/presupuestos/[id]/pdf y lo que se manda por
// WhatsApp). El documento lo dibuja internal/pdf, idéntico al de pdf-lib.

func de(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// DatosParaTransferir es datosParaTransferir de lib/dal/pagos.ts: nil si
// todavía no se cargaron (sin CBU ni alias el papel no inventa uno).
func (s *Servicio) DatosParaTransferir(ctx context.Context) (*pdf.DatosParaTransferir, error) {
	var d pdf.DatosParaTransferir
	var instrucciones *string
	err := s.pool.QueryRow(ctx, `SELECT banco, titular, cuit, cbu, alias, instrucciones FROM datos_bancarios LIMIT 1`).
		Scan(&d.Banco, &d.Titular, &d.Cuit, &d.Cbu, &d.Alias, &instrucciones)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if d.Cbu == "" && d.Alias == "" {
		return nil, nil
	}
	d.Instrucciones = de(instrucciones)
	return &d, nil
}

// PresupuestoParaPdf pasa la ficha a lo que dibuja el PDF.
func PresupuestoParaPdf(p *FichaDePresupuesto) pdf.PresupuestoCompleto {
	out := pdf.PresupuestoCompleto{Numero: p.Numero, Cliente: p.Cliente, Empresa: de(p.Empresa), ClienteCodigo: de(p.ClienteCodigo),
		ClienteCuit: de(p.ClienteCuit), ClienteCondicionIva: de(p.ClienteCondicionIva), ClienteDireccion: de(p.ClienteDireccion),
		Sucursal: de(p.Sucursal), Vendedor: de(p.Vendedor), Asesor: de(p.Asesor), Subtotal: p.Subtotal, Total: p.Total,
		Notas: de(p.Notas), ValidoHasta: p.ValidoHasta, CreatedAt: p.CreatedAt, Items: make([]pdf.ItemPresupuesto, len(p.Items))}
	for i, it := range p.Items {
		out.Items[i] = pdf.ItemPresupuesto{Descripcion: it.Descripcion, Unidad: it.Unidad, Cantidad: it.Cantidad,
			PrecioUnitario: it.PrecioUnitario, Subtotal: it.Subtotal, AlicuotaIva: it.AlicuotaIva}
	}
	return out
}

// PresupuestoPdf arma el PDF de una ficha ya leída.
func (s *Servicio) PresupuestoPdf(ctx context.Context, p *FichaDePresupuesto) ([]byte, error) {
	emisor, err := documentos.EmisorDe(ctx, s.pool)
	if err != nil {
		return nil, err
	}
	banco, err := s.DatosParaTransferir(ctx)
	if err != nil {
		return nil, err
	}
	return pdf.Presupuesto(pdf.DatosPresupuesto{Presupuesto: PresupuestoParaPdf(p), Emisor: emisor, Banco: banco}, s.ahora())
}

// DuenoDeLaSesion es la ficha de cliente de quien entró (nil si no tiene).
func (s *Servicio) DuenoDeLaSesion(ctx context.Context, userID string) (*string, error) {
	var id string
	err := s.pool.QueryRow(ctx, `SELECT id FROM customers WHERE user_id = $1 AND active LIMIT 1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &id, err
}

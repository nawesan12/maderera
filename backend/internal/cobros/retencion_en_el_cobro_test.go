package cobros

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/reglas"
	"mjbj/internal/sqlc"
)

// M2S1-093: la retención que trae el cliente con el pago entra en el mismo
// recibo, como certificado atado a él. Quién la carga lo dice la regla
// retencion_en_el_cobro: de arranque, solo el admin; con «quien_cobra», la
// vendedora también.
func TestRetencionDentroDelCobro(t *testing.T) {
	b := armarBase(t)
	ctx := context.Background()
	_, _ = b.pool.Exec(ctx, `insert into "user" (id, name, email, email_verified, created_at, updated_at) values
		('vende', 'Vende', 'vende@prueba.test', true, now(), now())`)
	vendedor := sqlc.StaffRoleVendedor
	ses := &auth.Sesion{UserID: "vende", Rol: sqlc.UserRoleStaff, RolStaff: &vendedor}
	s := Nuevo(b.pool, silencio)
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 100000)`, b.cliente)
	partes := `[{"medio":"transferencia","importe":"90000"},{"medio":"retencion","importe":"10000","referencia":"SIM-IIBB-000310","impuesto":"iibb"}]`

	_, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", partes, "c-ret-1", "")
	var p *plataforma.Problema
	if !errors.As(err, &p) || p.Errores["partes"] == "" {
		t.Fatalf("de arranque, la vendedora no carga retenciones: %v", err)
	}

	if err := reglas.Fijar(ctx, b.pool, reglas.RetencionEnElCobro, "quien_cobra"); err != nil {
		t.Fatal(err)
	}
	sinImpuesto := `[{"medio":"retencion","importe":"10000","referencia":"SIM-1"}]`
	if _, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", sinImpuesto, "c-ret-2", ""); !errors.As(err, &p) {
		t.Fatalf("sin impuesto se aceptó: %v", err)
	}
	r, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", partes, "c-ret-3", "")
	if err != nil || r.ReceiptID == nil {
		t.Fatalf("con la regla: %+v %v", r, err)
	}
	var numero, impuesto string
	var deuda float64
	if err := b.pool.QueryRow(ctx, `select numero, impuesto::text from retenciones_sufridas where receipt_id = $1`, *r.ReceiptID).Scan(&numero, &impuesto); err != nil {
		t.Fatalf("el certificado no quedó atado al recibo: %v", err)
	}
	_ = b.pool.QueryRow(ctx, `select coalesce(sum(monto), 0)::float8 from account_movements where customer_id = $1`, b.cliente).Scan(&deuda)
	if numero != "SIM-IIBB-000310" || impuesto != "iibb" || deuda != 0 {
		t.Errorf("certificado %s %s, deuda %v", numero, impuesto, deuda)
	}
	// Mes 23: la ficha dice de qué impuesto es, y la que entra sola trae el
	// certificado en el título, como la cargada desde ARCA.
	_, _ = b.pool.Exec(ctx, `insert into account_movements (customer_id, tipo, monto) values ($1, 'compra', 5000)`, b.cliente)
	sola := `[{"medio":"retencion","importe":"5000","referencia":"SIM-IIBB-000311","impuesto":"iibb"}]`
	if _, err := s.CobrarAClienteEn(ctx, ses, b.cliente, "", "", sola, "c-ret-4", ""); err != nil {
		t.Fatal(err)
	}
	movs, _, err := Historial(ctx, sqlc.New(b.pool), b.cliente, nil, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	var titulos, detalles []string
	for _, m := range movs {
		if m.Clase == "pago" {
			titulos = append(titulos, m.Titulo)
			if m.Detalle != nil {
				detalles = append(detalles, *m.Detalle)
			}
		}
	}
	if !slices.Contains(titulos, "Retención de IIBB · certificado SIM-IIBB-000311") || !slices.Contains(titulos, "Pago a cuenta") {
		t.Errorf("títulos: %q", titulos)
	}
	if !slices.ContainsFunc(detalles, func(d string) bool { return strings.Contains(d, "Retención de IIBB $") }) {
		t.Errorf("detalles: %q", detalles)
	}
	if got := conImpuestoEscrito("Retención de iibb · certificado X"); got != "Retención de IIBB · certificado X" {
		t.Errorf("concepto: %q", got)
	}
}

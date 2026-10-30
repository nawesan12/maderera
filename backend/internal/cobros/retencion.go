package cobros

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/formato"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// FormRetencion es un certificado de retención que nos entregó un cliente,
// como texto (app/admin/arca/retenciones/actions.ts). Los números son
// z.coerce.number(): Number() de JS.
type FormRetencion struct {
	CustomerID, Numero, Impuesto, CodigoRegimen, Base, Importe, Fecha, Referencia string
	Alicuota                                                                      *string
}

func malRet(campo, m string) error { return plataforma.Invalido(map[string]string{campo: m}) }

// CargarRetencionSufrida es cargarSufrida: la retención baja la deuda igual
// que un pago (es plata que el cliente ya entregó, al fisco), así que va con
// recibo, por la misma puerta que todo cobro. Solo el admin.
func (s *Servicio) CargarRetencionSufrida(ctx context.Context, ses *auth.Sesion, f FormRetencion) (string, error) {
	if !plataforma.UUIDValido(f.CustomerID) {
		return "", malRet("customerId", "Elegí el cliente.")
	}
	numero := strings.TrimSpace(f.Numero)
	switch {
	case plataforma.LargoJS(numero) < 1:
		return "", malRet("numero", "Poné el número del certificado.")
	case plataforma.LargoJS(numero) > 40:
		return "", malRet("numero", "Too big: expected string to have <=40 characters")
	}
	switch f.Impuesto {
	case "ganancias", "iva", "suss", "iibb":
	default:
		return "", malRet("impuesto", `Invalid option: expected one of "ganancias"|"iva"|"suss"|"iibb"`)
	}
	opcional := func(campo, v string, max int) (*string, error) {
		t := strings.TrimSpace(v)
		if plataforma.LargoJS(t) > max {
			return nil, malRet(campo, "Too big: expected string to have <="+jsmath.Texto(float64(max))+" characters")
		}
		if t == "" {
			return nil, nil
		}
		return &t, nil
	}
	codigo, err := opcional("codigoRegimen", f.CodigoRegimen, 20)
	if err != nil {
		return "", err
	}
	nan := "Invalid input: expected number, received NaN"
	base := jsmath.Numero(f.Base)
	switch {
	case math.IsNaN(base):
		return "", malRet("base", nan)
	case base < 0:
		return "", malRet("base", "Too small: expected number to be >=0")
	}
	var alicuota *string
	if f.Alicuota != nil {
		a := jsmath.Numero(*f.Alicuota)
		switch {
		case math.IsNaN(a):
			return "", malRet("alicuota", nan)
		case a < 0:
			return "", malRet("alicuota", "Too small: expected number to be >=0")
		case a > 100:
			return "", malRet("alicuota", "Too big: expected number to be <=100")
		}
		t := jsmath.ToFixed(a, 3)
		alicuota = &t
	}
	importe := jsmath.Numero(f.Importe)
	switch {
	case math.IsNaN(importe):
		return "", malRet("importe", nan)
	case importe <= 0:
		return "", malRet("importe", "El importe tiene que ser mayor a cero.")
	}
	referencia, err := opcional("referencia", f.Referencia, 60)
	if err != nil {
		return "", err
	}
	// new Date(fecha): «2026-10-29» es medianoche UTC; con hora, la que diga.
	fecha, err := time.Parse("2006-01-02", f.Fecha)
	if err != nil {
		if fecha, err = time.Parse(time.RFC3339, f.Fecha); err != nil {
			return "", malRet("fecha", "Revisá la fecha.")
		}
	}

	var r ReciboEmitido
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var retencion string
		if err := tx.QueryRow(ctx, `INSERT INTO retenciones_sufridas
			(customer_id, numero, impuesto, codigo_regimen, base, alicuota, importe, fecha, referencia, created_by_user_id)
			VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10) RETURNING id`,
			f.CustomerID, numero, f.Impuesto, codigo, jsmath.Fijo2(base), alicuota, jsmath.Fijo2(importe), fecha, referencia, ses.UserID).Scan(&retencion); err != nil {
			return err
		}
		concepto := "Retención de " + f.Impuesto + " · certificado " + numero
		var err error
		r, err = EmitirRecibo(ctx, tx, Cobro{CustomerID: &f.CustomerID, Origen: "panel", Concepto: &concepto, UsuarioID: &ses.UserID,
			Partes: []Parte{{Medio: "retencion", Importe: importe, Referencia: &numero}}})
		if err != nil {
			return err
		}
		// Atada al recibo: si se anula el recibo, se anula la retención.
		_, err = tx.Exec(ctx, `UPDATE retenciones_sufridas SET receipt_id = $2 WHERE id = $1`, retencion, r.ReceiptID)
		return err
	})
	if err != nil {
		// El índice único por cliente y número: el mismo papel dos veces
		// saldaría dos veces la misma deuda.
		if strings.Contains(err.Error(), "retenciones_sufridas_numero_idx") {
			return "", malRet("numero", "Ese certificado ya está cargado para este cliente.")
		}
		return "", comoProblema(err)
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "retencion_sufrida", "",
		"Cargó el certificado "+numero+" por "+formato.MonedaEntera(importe), map[string]any{"receiptId": r.ReceiptID})
	return "Certificado cargado. La cuenta del cliente baja " + formato.MonedaEntera(importe) + ".", nil
}

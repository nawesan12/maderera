package clientes

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/cuit"
)

// El alta rápida de lib/clientes/alta.ts: la usan la facturación manual
// («en facturación poder crear clientes también») y, cuando se mude, el
// mostrador.

// Consultor es lo que tienen el pool y una transacción.
type Consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PorDocumento es clientePorDocumento: la ficha activa con ese CUIT (escrito
// con o sin guiones) o DNI. ok en false si no hay.
func PorDocumento(ctx context.Context, c Consultor, d Documento) (id, nombre string, ok bool, err error) {
	if d.Tipo == "ninguno" || d.Tipo == "" {
		return "", "", false, nil
	}
	formas := []string{d.Digitos}
	if d.Tipo == "cuit" {
		formas = append(formas, cuit.FormatearLargo(d.Digitos))
	}
	err = c.QueryRow(ctx, `SELECT id, nombre FROM customers WHERE active AND cuit = ANY($1) LIMIT 1`, formas).Scan(&id, &nombre)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", false, nil
	}
	return id, nombre, err == nil, err
}

// ClienteNuevo es el ClienteNuevo del alta rápida.
type ClienteNuevo struct {
	Nombre       string
	Documento    Documento
	CondicionIva string
	Telefono     *string
	Rubro        *string
	Direccion    *string
	Notas        *string
}

func recortado(p *string) *string {
	if p == nil {
		return nil
	}
	t := strings.TrimSpace(*p)
	if t == "" {
		return nil
	}
	return &t
}

// CrearRapido es crearClienteRapido: a un responsable inscripto se lo
// factura por su razón social, así que el nombre es también la razón social.
func CrearRapido(ctx context.Context, c Consultor, d ClienteNuevo) (string, error) {
	nombre := strings.TrimSpace(d.Nombre)
	var razon, doc, rubro *string
	if d.CondicionIva == "responsable_inscripto" {
		razon = &nombre
	}
	if d.Documento.Tipo != "ninguno" && d.Documento.Tipo != "" {
		doc = &d.Documento.Digitos
	}
	tipo := "particular"
	if d.Rubro != nil && *d.Rubro != "" {
		rubro = d.Rubro
		if *d.Rubro != "particular" {
			tipo = "profesional"
		}
	}
	var id string
	err := c.QueryRow(ctx, `INSERT INTO customers (nombre, razon_social, cuit, condicion_iva, telefono, rubro, tipo, direccion, notas)
		VALUES ($1, $2, $3, $4::condicion_iva, $5, $6, $7::tipo_cliente, $8, $9) RETURNING id`,
		nombre, razon, doc, d.CondicionIva, recortado(d.Telefono), rubro, tipo, recortado(d.Direccion), d.Notas).Scan(&id)
	return id, err
}

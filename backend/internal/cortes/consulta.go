package cortes

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/jsmath"
)

// ConsultaDeCorte es el corte que alguien armó en el sitio y mandó por
// WhatsApp (migración 00094). Se lee por el token del enlace: lo abre quien
// atiende, y desde el panel se convierte en una orden de corte.
type ConsultaDeCorte struct {
	Token            string         `json:"token"`
	VariantID        *string        `json:"variantId"`
	Material         string         `json:"material"`
	PlacaLargoMm     float64        `json:"placaLargoMm"`
	PlacaAnchoMm     float64        `json:"placaAnchoMm"`
	Mitad            *string        `json:"mitad"`
	CantoDescripcion *string        `json:"cantoDescripcion"`
	Piezas           []PiezaAcortar `json:"piezas"`
	AnchoSierraMm    float64        `json:"anchoSierraMm"`
	Sucursal         *string        `json:"sucursal"`
	MetrosCanto      float64        `json:"metrosCanto"`
	Plano            Plano          `json:"plano"`
	CorteID          *string        `json:"corteId"`
	CreatedAt        time.Time      `json:"createdAt"`
}

// ErrConsultaNoExiste es un token que no está.
var ErrConsultaNoExiste = errors.New("la consulta no existe")

// tokenDeConsulta son 10 bytes al azar en base32: 16 letras, cómodas en un
// mensaje de WhatsApp e imposibles de adivinar recorriendo números.
func tokenDeConsulta() string {
	var b [10]byte
	_, _ = rand.Read(b[:])
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}

// GuardarConsulta valida el corte con las mismas reglas que el carrito y lo
// guarda. La sucursal es el slug de la que eligió quien lo manda; vacía, nula.
func (s *Servicio) GuardarConsulta(ctx context.Context, m map[string]any, ip string) (string, error) {
	variantID, mitad, canto, piezas, msg := validarPedido(m)
	if msg != "" {
		return "", error422(msg)
	}
	general, err := s.cat.General(ctx)
	if err != nil {
		return "", err
	}
	placa, err := s.placa(ctx, general, variantID)
	if err != nil {
		return "", err
	}
	if placa == nil {
		return "", error422("Esa placa ya no está disponible para cortar. Elegí otra.")
	}
	if mitad != nil && !placa.AdmiteMedia {
		return "", error422("Esa placa se vende solo entera: armá el corte sobre la placa completa.")
	}
	params, err := s.Parametros(ctx)
	if err != nil {
		return "", err
	}
	medida := ResolverMedida(nil, nil, &placa.LargoMm, &placa.AnchoMm, mitad)
	sierra := params.AnchoSierraMm
	plano := CalcularPlano(DatosDelPlano{Piezas: piezas, PlacaLargo: medida.Largo, PlacaAncho: medida.Ancho, AnchoSierra: &sierra})
	if n := len(plano.NoEntran); n == 1 {
		return "", error422("Hay una pieza que no entra en la placa. Revisá esa medida.")
	} else if n > 1 {
		return "", error422(fmt.Sprintf("Hay %d piezas que no entran en la placa. Revisá esas medidas.", n))
	}
	if canto != nil && *canto == "" {
		canto = nil
	}
	var sucursal *string
	if slug, _ := m["sucursal"].(string); slug != "" {
		var id string
		err := s.pool.QueryRow(ctx, `SELECT id::text FROM branches WHERE slug = $1 AND active`, slug).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return "", error422("Esa sucursal no existe.")
		} else if err != nil {
			return "", err
		}
		sucursal = &id
	}
	crudas, err := json.Marshal(piezas)
	if err != nil {
		return "", err
	}
	token := tokenDeConsulta()
	_, err = s.pool.Exec(ctx, `
		INSERT INTO consultas_corte (token, variant_id, material, placa_largo_mm, placa_ancho_mm, mitad,
			canto_descripcion, piezas, ancho_sierra_mm, branch_id, ip)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		token, variantID, placa.Descripcion, jsmath.Num(medida.Largo), jsmath.Num(medida.Ancho), mitad,
		canto, crudas, jsmath.Num(sierra), sucursal, ip)
	return token, err
}

// Consulta lee una consulta y rehace su plano con la medida y la sierra que
// se guardaron: el enlace muestra lo mismo que vio quien la mandó.
func (s *Servicio) Consulta(ctx context.Context, token string) (*ConsultaDeCorte, error) {
	c := ConsultaDeCorte{Token: token}
	var crudas []byte
	var largo, ancho, sierra jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT c.variant_id::text, c.material, c.placa_largo_mm, c.placa_ancho_mm, c.mitad, c.canto_descripcion,
			c.piezas, c.ancho_sierra_mm, b.slug, c.cutting_order_id::text, c.created_at
		FROM consultas_corte c LEFT JOIN branches b ON b.id = c.branch_id
		WHERE c.token = $1`, token).Scan(&c.VariantID, &c.Material, &largo, &ancho, &c.Mitad, &c.CantoDescripcion,
		&crudas, &sierra, &c.Sucursal, &c.CorteID, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConsultaNoExiste
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(crudas, &c.Piezas); err != nil {
		return nil, err
	}
	c.PlacaLargoMm, c.PlacaAnchoMm, c.AnchoSierraMm = largo.F(), ancho.F(), sierra.F()
	s2 := c.AnchoSierraMm
	c.Plano = CalcularPlano(DatosDelPlano{Piezas: c.Piezas, PlacaLargo: c.PlacaLargoMm, PlacaAncho: c.PlacaAnchoMm, AnchoSierra: &s2})
	conCanto := make([]PiezaConCanto, len(c.Piezas))
	for i, p := range c.Piezas {
		conCanto[i] = PiezaConCanto{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	c.MetrosCanto = MetrosDeTapacanto(conCanto)
	return &c, nil
}

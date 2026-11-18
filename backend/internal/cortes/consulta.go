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
//
// Desde la 00118 un pedido trae varias placas (`Grupos`). Los campos de
// arriba siguen siendo los del primer grupo, para que lo que ya leía una
// consulta de una sola placa no cambie.
type ConsultaDeCorte struct {
	Token            string            `json:"token"`
	VariantID        *string           `json:"variantId"`
	Material         string            `json:"material"`
	PlacaLargoMm     float64           `json:"placaLargoMm"`
	PlacaAnchoMm     float64           `json:"placaAnchoMm"`
	Mitad            *string           `json:"mitad"`
	CantoDescripcion *string           `json:"cantoDescripcion"`
	Piezas           []PiezaAcortar    `json:"piezas"`
	AnchoSierraMm    float64           `json:"anchoSierraMm"`
	Sucursal         *string           `json:"sucursal"`
	MetrosCanto      float64           `json:"metrosCanto"`
	Plano            Plano             `json:"plano"`
	CorteID          *string           `json:"corteId"`
	CreatedAt        time.Time         `json:"createdAt"`
	Grupos           []GrupoDeConsulta `json:"grupos"`
}

// GrupoDeConsulta es una placa del pedido con sus piezas. El orden 0 es el
// que vive en `consultas_corte`; los demás, en `consultas_corte_grupos`.
type GrupoDeConsulta struct {
	Orden            int            `json:"orden"`
	VariantID        *string        `json:"variantId"`
	Material         string         `json:"material"`
	PlacaLargoMm     float64        `json:"placaLargoMm"`
	PlacaAnchoMm     float64        `json:"placaAnchoMm"`
	Mitad            *string        `json:"mitad"`
	CantoDescripcion *string        `json:"cantoDescripcion"`
	Piezas           []PiezaAcortar `json:"piezas"`
	MetrosCanto      float64        `json:"metrosCanto"`
	Plano            Plano          `json:"plano"`
	CorteID          *string        `json:"corteId"`
}

// MaximoDeGrupos es cuántas placas distintas lleva un pedido del sitio. Un
// mueble usa dos o tres; más que eso es un despiece de obra, que se arma
// mejor hablando.
const MaximoDeGrupos = 8

// ErrConsultaNoExiste es un token que no está.
var ErrConsultaNoExiste = errors.New("la consulta no existe")

// tokenDeConsulta son 10 bytes al azar en base32: 16 letras, cómodas en un
// mensaje de WhatsApp e imposibles de adivinar recorriendo números.
func tokenDeConsulta() string {
	var b [10]byte
	_, _ = rand.Read(b[:])
	return strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b[:]))
}

// gruposDelPedido separa el pedido en grupos: `grupos: [...]` desde la 00118,
// o el pedido de siempre, con la placa arriba, que es un grupo solo.
func gruposDelPedido(m map[string]any) ([]map[string]any, string) {
	crudo, hay := m["grupos"]
	if !hay {
		return []map[string]any{m}, ""
	}
	lista, ok := crudo.([]any)
	if !ok {
		return nil, "Invalid input: expected array, received " + tipoJS(crudo, true)
	}
	if len(lista) < 1 {
		return nil, "Too small: expected array to have >=1 items"
	}
	if len(lista) > MaximoDeGrupos {
		return nil, fmt.Sprintf("Son demasiadas placas para un pedido (el máximo es %d). Mandalo en dos.", MaximoDeGrupos)
	}
	out := make([]map[string]any, len(lista))
	for i, x := range lista {
		g, ok := x.(map[string]any)
		if !ok {
			return nil, "Invalid input: expected object, received " + tipoJS(x, true)
		}
		out[i] = g
	}
	return out, ""
}

// grupoValidado es un grupo listo para guardar.
type grupoValidado struct {
	variantID string
	material  string
	medida    MedidaDePlaca
	mitad     *string
	canto     *string
	piezas    []byte
}

// GuardarConsulta valida el corte con las mismas reglas que el carrito y lo
// guarda. La sucursal es el slug de la que eligió quien lo manda; vacía, nula.
func (s *Servicio) GuardarConsulta(ctx context.Context, m map[string]any, ip string) (string, error) {
	pedidos, msg := gruposDelPedido(m)
	if msg != "" {
		return "", error422(msg)
	}
	general, err := s.cat.General(ctx)
	if err != nil {
		return "", err
	}
	params, err := s.Parametros(ctx)
	if err != nil {
		return "", err
	}
	sierra := params.AnchoSierraMm
	// Con varias placas, el aviso dice de cuál habla.
	cual := func(i int, msg string) error {
		if len(pedidos) == 1 {
			return error422(msg)
		}
		return error422(fmt.Sprintf("Placa %d: %s", i+1, msg))
	}
	grupos := make([]grupoValidado, len(pedidos))
	unidades := 0.0
	for i, g := range pedidos {
		variantID, mitad, canto, piezas, msg := validarPedido(g)
		if msg != "" {
			return "", cual(i, msg)
		}
		placa, err := s.placa(ctx, general, variantID)
		if err != nil {
			return "", err
		}
		if placa == nil {
			return "", cual(i, "Esa placa ya no está disponible para cortar. Elegí otra.")
		}
		if mitad != nil && !placa.AdmiteMedia {
			return "", cual(i, "Esa placa se vende solo entera: armá el corte sobre la placa completa.")
		}
		medida := ResolverMedida(nil, nil, &placa.LargoMm, &placa.AnchoMm, mitad)
		plano := CalcularPlano(DatosDelPlano{Piezas: piezas, PlacaLargo: medida.Largo, PlacaAncho: medida.Ancho, AnchoSierra: &sierra})
		if n := len(plano.NoEntran); n == 1 {
			return "", cual(i, "Hay una pieza que no entra en la placa. Revisá esa medida.")
		} else if n > 1 {
			return "", cual(i, fmt.Sprintf("Hay %d piezas que no entran en la placa. Revisá esas medidas.", n))
		}
		if canto != nil && *canto == "" {
			canto = nil
		}
		for _, p := range piezas {
			unidades += p.Cantidad
		}
		crudas, err := json.Marshal(piezas)
		if err != nil {
			return "", err
		}
		grupos[i] = grupoValidado{variantID, placa.Descripcion, medida, mitad, canto, crudas}
	}
	// El tope del motor vale para el pedido entero, no por placa: si no, ocho
	// grupos de mil piezas pasaban.
	if unidades > MaximoDePiezas {
		return "", error422(fmt.Sprintf("Son demasiadas piezas para calcular acá (el máximo es %d). Pedinos el despiece por WhatsApp y lo armamos nosotros.", MaximoDePiezas))
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
	token := tokenDeConsulta()
	err = pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		g := grupos[0]
		var id string
		if err := tx.QueryRow(ctx, `
			INSERT INTO consultas_corte (token, variant_id, material, placa_largo_mm, placa_ancho_mm, mitad,
				canto_descripcion, piezas, ancho_sierra_mm, branch_id, ip)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			RETURNING id::text`,
			token, g.variantID, g.material, jsmath.Num(g.medida.Largo), jsmath.Num(g.medida.Ancho), g.mitad,
			g.canto, g.piezas, jsmath.Num(sierra), sucursal, ip).Scan(&id); err != nil {
			return err
		}
		for orden := 1; orden < len(grupos); orden++ {
			g := grupos[orden]
			if _, err := tx.Exec(ctx, `
				INSERT INTO consultas_corte_grupos (consulta_id, orden, variant_id, material, placa_largo_mm,
					placa_ancho_mm, mitad, canto_descripcion, piezas)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				id, orden, g.variantID, g.material, jsmath.Num(g.medida.Largo), jsmath.Num(g.medida.Ancho), g.mitad,
				g.canto, g.piezas); err != nil {
				return err
			}
		}
		return nil
	})
	return token, err
}

// Consulta lee una consulta y rehace el plano de cada grupo con la medida y
// la sierra que se guardaron: el enlace muestra lo mismo que vio quien la
// mandó.
func (s *Servicio) Consulta(ctx context.Context, token string) (*ConsultaDeCorte, error) {
	c := ConsultaDeCorte{Token: token}
	var crudas []byte
	var id string
	var largo, ancho, sierra jsmath.Num
	err := s.pool.QueryRow(ctx, `
		SELECT c.id::text, c.variant_id::text, c.material, c.placa_largo_mm, c.placa_ancho_mm, c.mitad, c.canto_descripcion,
			c.piezas, c.ancho_sierra_mm, b.slug, c.cutting_order_id::text, c.created_at
		FROM consultas_corte c LEFT JOIN branches b ON b.id = c.branch_id
		WHERE c.token = $1`, token).Scan(&id, &c.VariantID, &c.Material, &largo, &ancho, &c.Mitad, &c.CantoDescripcion,
		&crudas, &sierra, &c.Sucursal, &c.CorteID, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrConsultaNoExiste
	}
	if err != nil {
		return nil, err
	}
	c.AnchoSierraMm = sierra.F()
	primero := GrupoDeConsulta{VariantID: c.VariantID, Material: c.Material, PlacaLargoMm: largo.F(), PlacaAnchoMm: ancho.F(),
		Mitad: c.Mitad, CantoDescripcion: c.CantoDescripcion, CorteID: c.CorteID}
	if err := json.Unmarshal(crudas, &primero.Piezas); err != nil {
		return nil, err
	}
	c.Grupos = []GrupoDeConsulta{primero}

	filas, err := s.pool.Query(ctx, `
		SELECT orden, variant_id::text, material, placa_largo_mm, placa_ancho_mm, mitad, canto_descripcion, piezas,
			cutting_order_id::text
		FROM consultas_corte_grupos WHERE consulta_id = $1 ORDER BY orden`, id)
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	for filas.Next() {
		var g GrupoDeConsulta
		var crudas []byte
		var largo, ancho jsmath.Num
		if err := filas.Scan(&g.Orden, &g.VariantID, &g.Material, &largo, &ancho, &g.Mitad, &g.CantoDescripcion, &crudas, &g.CorteID); err != nil {
			return nil, err
		}
		g.PlacaLargoMm, g.PlacaAnchoMm = largo.F(), ancho.F()
		if err := json.Unmarshal(crudas, &g.Piezas); err != nil {
			return nil, err
		}
		c.Grupos = append(c.Grupos, g)
	}
	if err := filas.Err(); err != nil {
		return nil, err
	}

	for i := range c.Grupos {
		g := &c.Grupos[i]
		s2 := c.AnchoSierraMm
		g.Plano = CalcularPlano(DatosDelPlano{Piezas: g.Piezas, PlacaLargo: g.PlacaLargoMm, PlacaAncho: g.PlacaAnchoMm, AnchoSierra: &s2})
		conCanto := make([]PiezaConCanto, len(g.Piezas))
		for j, p := range g.Piezas {
			conCanto[j] = PiezaConCanto{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
		}
		g.MetrosCanto = MetrosDeTapacanto(conCanto)
	}
	p := c.Grupos[0]
	c.PlacaLargoMm, c.PlacaAnchoMm, c.Piezas, c.Plano, c.MetrosCanto = p.PlacaLargoMm, p.PlacaAnchoMm, p.Piezas, p.Plano, p.MetrosCanto
	return &c, nil
}

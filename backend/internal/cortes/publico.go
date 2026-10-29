package cortes

// Lo del sitio: las placas que se pueden mandar a cortar
// (lib/dal/cortes-publico.ts), las sugerencias de la calculadora
// (lib/dal/sugerencias.ts), el corte que se agrega al carrito
// (app/(public)/corte/actions.ts) y el que se cobra al confirmar la compra
// (lib/cortes/desde-carrito.ts).

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/catalogo"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
)

// PlacaCortable es una placa con medida, precio y tarifa ya resueltos.
type PlacaCortable struct {
	VariantID           string  `json:"variantId"`
	Descripcion         string  `json:"descripcion"`
	LargoMm             float64 `json:"largoMm"`
	AnchoMm             float64 `json:"anchoMm"`
	Color               *string `json:"color"`
	Precio              float64 `json:"precio"`
	AdmiteMedia         bool    `json:"admiteMedia"`
	PrecioMediaPct      float64 `json:"precioMediaPct"`
	PrecioPorPasada     float64 `json:"precioPorPasada"`
	PrecioPorMetroCanto float64 `json:"precioPorMetroCanto"`
}

// Placas son las placas cortables con los precios de una lista. Solo las que
// tienen precio y tarifa de pasada: ofrecer un corte que no se puede cobrar
// es prometer un precio que el mostrador no sostiene.
func (s *Servicio) Placas(ctx context.Context, l catalogo.Lista) ([]PlacaCortable, error) {
	tarifas, err := s.TarifasActivas(ctx)
	if err != nil {
		return nil, err
	}
	filas, err := s.pool.Query(ctx, `
		SELECT pv.id::text, p.name, pv.label, pv.largo_mm, pv.ancho_mm, pv.color, c.name, p.forma_de_venta::text,
		       p.precio_media_pct, coalesce(pp.price, round((pg.price * $3::numeric)::numeric, 2))
		FROM product_variants pv
		JOIN products p ON p.id = pv.product_id
		JOIN categories c ON c.id = p.category_id
		LEFT JOIN price_list_items pp ON $1::uuid IS NOT NULL AND pp.variant_id = pv.id AND pp.price_list_id = $1
		LEFT JOIN price_list_items pg ON $2::uuid IS NOT NULL AND pg.variant_id = pv.id AND pg.price_list_id = $2
		WHERE p.active AND pv.active AND pv.largo_mm IS NOT NULL AND pv.ancho_mm IS NOT NULL
		ORDER BY p.name ASC, pv.sort_order ASC`, l.ID, l.GeneralID, jsmath.Num(l.FactorDerivado))
	if err != nil {
		return nil, err
	}
	defer filas.Close()
	out := []PlacaCortable{}
	for filas.Next() {
		var p PlacaCortable
		var producto, medida, categoria, forma string
		var largo, ancho, pct int32
		var precio *jsmath.Num
		if err := filas.Scan(&p.VariantID, &producto, &medida, &largo, &ancho, &p.Color, &categoria, &forma, &pct, &precio); err != nil {
			return nil, err
		}
		if precio == nil || precio.F() <= 0 {
			continue
		}
		t := BuscarTarifa(tarifas, []string{categoria, producto}, l.ID)
		if t == nil || t.PrecioPorPasada <= 0 {
			continue
		}
		p.Descripcion = producto + " — " + medida
		p.LargoMm, p.AnchoMm, p.Precio, p.PrecioMediaPct = float64(largo), float64(ancho), precio.F(), float64(pct)
		p.AdmiteMedia = forma == "entera_o_media"
		p.PrecioPorPasada, p.PrecioPorMetroCanto = t.PrecioPorPasada, t.PrecioPorMetroCanto
		out = append(out, p)
	}
	return out, filas.Err()
}

func (s *Servicio) placa(ctx context.Context, l catalogo.Lista, variantID string) (*PlacaCortable, error) {
	placas, err := s.Placas(ctx, l)
	if err != nil {
		return nil, err
	}
	for i := range placas {
		if placas[i].VariantID == variantID {
			return &placas[i], nil
		}
	}
	return nil, nil
}

// Sugerencia es el producto del catálogo para un renglón de la calculadora.
type Sugerencia struct {
	Busqueda    string  `json:"busqueda"`
	VariantID   string  `json:"variantId"`
	Descripcion string  `json:"descripcion"`
	Unidad      string  `json:"unidad"`
	Precio      *string `json:"precio"`
	HayStock    bool    `json:"hayStock"`
}

// Sugerir es sugerirDelCatalogo: por término, la más barata con stock.
func (s *Servicio) Sugerir(ctx context.Context, l catalogo.Lista, terminos []string) ([]Sugerencia, error) {
	vistos := map[string]bool{}
	out := []Sugerencia{}
	for _, t := range terminos {
		t = trimJS(t)
		if t == "" || vistos[t] {
			continue
		}
		vistos[t] = true
		args := []any{l.ID, l.GeneralID}
		cond := condicionBusqueda(t, []string{"p.name", "pv.label", "p.brand", "c.name"}, &args)
		if cond == "" {
			continue
		}
		var sg Sugerencia
		var producto string
		var medida string
		var stock jsmath.Num
		err := s.pool.QueryRow(ctx, `
			SELECT pv.id::text, p.name, pv.label, p.unit::text, coalesce(pp.price, pg.price)::text,
			       coalesce(sum(i.qty), 0)
			FROM product_variants pv
			JOIN products p ON p.id = pv.product_id
			JOIN categories c ON c.id = p.category_id
			LEFT JOIN price_list_items pp ON pp.variant_id = pv.id AND $1::uuid IS NOT NULL AND pp.price_list_id = $1
			LEFT JOIN price_list_items pg ON pg.variant_id = pv.id AND $2::uuid IS NOT NULL AND pg.price_list_id = $2
			LEFT JOIN inventory i ON i.variant_id = pv.id
			WHERE pv.active AND p.active AND `+cond+`
			GROUP BY pv.id, p.name, pv.label, p.unit, pp.price, pg.price
			ORDER BY CASE WHEN coalesce(sum(i.qty), 0) > 0 THEN 0 ELSE 1 END,
			         CASE WHEN coalesce(pp.price, pg.price) IS NULL THEN 1 ELSE 0 END,
			         coalesce(pp.price, pg.price) ASC
			LIMIT 1`, args...).Scan(&sg.VariantID, &producto, &medida, &sg.Unidad, &sg.Precio, &stock)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return nil, err
		}
		sg.Busqueda = t
		sg.Descripcion = producto
		if medida != "" {
			sg.Descripcion = producto + " — " + medida
		}
		sg.HayStock = stock.F() > 0
		out = append(out, sg)
	}
	return out, nil
}

// --- el corte del sitio ---

// MaximoDePiezas es el tope de piezas totales de un corte armado en el sitio.
const MaximoDePiezas = 1_000

// CorteCotizado es lo que se guarda en el carrito.
type CorteCotizado struct {
	VariantID           string         `json:"variantId"`
	MaterialDescripcion string         `json:"materialDescripcion"`
	PlacaLargoMm        float64        `json:"placaLargoMm"`
	PlacaAnchoMm        float64        `json:"placaAnchoMm"`
	Mitad               *string        `json:"mitad"`
	CantoDescripcion    *string        `json:"cantoDescripcion"`
	Piezas              []PiezaAcortar `json:"piezas"`
	Placas              int            `json:"placas"`
	Pasadas             int            `json:"pasadas"`
	Total               string         `json:"total"`
}

// validarPedido es el esquema de agregarCorteAlCarrito: devuelve las piezas
// ya convertidas o el primer mensaje.
func validarPedido(m map[string]any) (variantID string, mitad, canto *string, piezas []PiezaAcortar, msg string) {
	var msgs []string
	add := func(s string) {
		if s != "" {
			msgs = append(msgs, s)
		}
	}
	switch v := m["variantId"].(type) {
	case string:
		if !plataforma.UUIDValido(v) {
			add("Invalid UUID")
		}
		variantID = v
	default:
		add("Invalid input: expected string, received " + tipoJS(v, hay(m, "variantId")))
	}
	switch v := m["mitad"].(type) {
	case nil:
	case string:
		if v != "largo" && v != "ancho" {
			add(`Invalid option: expected one of "largo"|"ancho"`)
		} else {
			mitad = &v
		}
	default:
		add(`Invalid option: expected one of "largo"|"ancho"`)
	}
	switch v := m["cantoDescripcion"].(type) {
	case nil:
	case string:
		t, e := validarTexto(v, 0, "", 120)
		add(e)
		canto = &t
	default:
		add("Invalid input: expected string, received " + tipoJS(v, true))
	}
	lista, esLista := m["piezas"].([]any)
	if !esLista {
		add("Invalid input: expected array, received " + tipoJS(m["piezas"], hay(m, "piezas")))
	} else if len(lista) < 1 {
		add("Too small: expected array to have >=1 items")
	} else if len(lista) > 100 {
		add("Too big: expected array to have <=100 items")
	}
	if esLista {
		for _, x := range lista {
			p, e := validarPiezaDelSitio(x)
			add(e)
			piezas = append(piezas, p)
		}
	}
	if len(msgs) > 0 {
		return "", nil, nil, nil, msgs[0]
	}
	total := 0.0
	for _, p := range piezas {
		total += p.Cantidad
	}
	if total > MaximoDePiezas {
		return "", nil, nil, nil, fmt.Sprintf("Son demasiadas piezas para calcular acá (el máximo es %d). Pedinos el despiece por WhatsApp y lo armamos nosotros.", MaximoDePiezas)
	}
	return variantID, mitad, canto, piezas, ""
}

func hay(m map[string]any, k string) bool { _, ok := m[k]; return ok }

func tipoJS(v any, presente bool) string {
	if !presente {
		return "undefined"
	}
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "boolean"
	case []any:
		return "array"
	}
	return "object"
}

// validarPiezaDelSitio es piezaSchema del armador público.
func validarPiezaDelSitio(x any) (PiezaAcortar, string) {
	m, ok := x.(map[string]any)
	if !ok {
		return PiezaAcortar{}, "Invalid input: expected object, received " + tipoJS(x, true)
	}
	reglas := []struct {
		clave string
		r     reglaNumero
	}{
		{"largoMm", reglaNumero{entero: true, positivo: true, max: pf(10_000)}},
		{"anchoMm", reglaNumero{entero: true, positivo: true, max: pf(10_000)}},
		{"cantidad", reglaNumero{entero: true, positivo: true, max: pf(200)}},
		{"respetaVeta", reglaNumero{entero: true, min: pf(0), max: pf(1)}},
		{"cantoLargo", reglaNumero{entero: true, min: pf(0), max: pf(2)}},
		{"cantoAncho", reglaNumero{entero: true, min: pf(0), max: pf(2)}},
	}
	var n [6]float64
	for i, r := range reglas {
		v, presente := m[r.clave]
		n[i] = numeroJS(v, presente)
		if msg := validarNumero(n[i], r.r); msg != "" {
			return PiezaAcortar{}, msg
		}
	}
	p := PiezaAcortar{LargoMm: n[0], AnchoMm: n[1], Cantidad: n[2], RespetaVeta: n[3], CantoLargo: n[4], CantoAncho: n[5]}
	switch v := m["etiqueta"].(type) {
	case nil:
	case string:
		t, e := validarTexto(v, 0, "", 120)
		if e != "" {
			return p, e
		}
		p.Etiqueta = &t
	default:
		return p, "Invalid input: expected string, received " + tipoJS(v, true)
	}
	return p, ""
}

func (s *Servicio) cotizar(ctx context.Context, l catalogo.Lista, placa *PlacaCortable, mitad *string, piezas []PiezaAcortar) (MedidaDePlaca, Plano, PresupuestoDeCorte, error) {
	params, err := s.Parametros(ctx)
	if err != nil {
		return MedidaDePlaca{}, Plano{}, PresupuestoDeCorte{}, err
	}
	medida := ResolverMedida(nil, nil, &placa.LargoMm, &placa.AnchoMm, mitad)
	sierra := params.AnchoSierraMm
	plano := CalcularPlano(DatosDelPlano{Piezas: piezas, PlacaLargo: medida.Largo, PlacaAncho: medida.Ancho, AnchoSierra: &sierra})
	pres := make([]PiezaPresupuestada, len(piezas))
	for i, p := range piezas {
		pres[i] = PiezaPresupuestada{p.LargoMm, p.AnchoMm, p.Cantidad, p.CantoLargo, p.CantoAncho}
	}
	tarifa := &TarifaDeCorte{Material: placa.Descripcion, PrecioPorPasada: placa.PrecioPorPasada, PrecioPorMetroCanto: placa.PrecioPorMetroCanto}
	precio := placa.Precio
	cuenta := Presupuestar(plano, tarifa, &precio, pres, FraccionDePlaca(mitad, placa.PrecioMediaPct))
	return medida, plano, cuenta, nil
}

// CotizarParaElCarrito es agregarCorteAlCarrito sin la escritura en el
// carrito (que es de la tanda 6): todo se vuelve a calcular acá con la lista
// de quien compra; el precio nunca viaja en el formulario.
func (s *Servicio) CotizarParaElCarrito(ctx context.Context, l catalogo.Lista, m map[string]any) (*CorteCotizado, error) {
	variantID, mitad, canto, piezas, msg := validarPedido(m)
	if msg != "" {
		return nil, error422(msg)
	}
	placa, err := s.placa(ctx, l, variantID)
	if err != nil {
		return nil, err
	}
	if placa == nil {
		return nil, error422("Esa placa ya no está disponible para cortar. Elegí otra.")
	}
	if mitad != nil && !placa.AdmiteMedia {
		return nil, error422("Esa placa se vende solo entera: armá el corte sobre la placa completa.")
	}
	medida, plano, cuenta, err := s.cotizar(ctx, l, placa, mitad, piezas)
	if err != nil {
		return nil, err
	}
	if n := len(plano.NoEntran); n == 1 {
		return nil, error422("Hay una pieza que no entra en la placa. Revisá esa medida.")
	} else if n > 1 {
		return nil, error422(fmt.Sprintf("Hay %d piezas que no entran en la placa. Revisá esas medidas.", n))
	}
	if canto != nil && *canto == "" {
		canto = nil
	}
	return &CorteCotizado{
		VariantID: variantID, MaterialDescripcion: placa.Descripcion, PlacaLargoMm: medida.Largo, PlacaAnchoMm: medida.Ancho,
		Mitad: mitad, CantoDescripcion: canto, Piezas: piezas, Placas: len(plano.Placas), Pasadas: plano.PasadasCobrables,
		Total: jsmath.Fijo2(cuenta.Total),
	}, nil
}

// LineaDelCorte es una línea que se cobra al confirmar la compra.
type LineaDelCorte struct {
	// EsMaterial: es la placa; el TS le agrega la presentación de la mitad.
	EsMaterial     bool    `json:"esMaterial"`
	VariantID      *string `json:"variantId"`
	Descripcion    string  `json:"descripcion"`
	Unidad         string  `json:"unidad"`
	Cantidad       float64 `json:"cantidad"`
	PrecioUnitario float64 `json:"precioUnitario"`
}

// CorteResuelto es un corte del carrito listo para el pedido.
type CorteResuelto struct {
	ID               string             `json:"id"`
	Placa            PlacaCortable      `json:"placa"`
	Piezas           []PiezaAcortar     `json:"piezas"`
	Mitad            *string            `json:"mitad"`
	CantoDescripcion *string            `json:"cantoDescripcion"`
	PlacaLargoMm     float64            `json:"placaLargoMm"`
	PlacaAnchoMm     float64            `json:"placaAnchoMm"`
	Placas           int                `json:"placas"`
	Pasadas          int                `json:"pasadas"`
	AnchoSierraMm    float64            `json:"anchoSierraMm"`
	Cuenta           PresupuestoDeCorte `json:"cuenta"`
	Lineas           []LineaDelCorte    `json:"lineas"`
}

// leerPiezasDelCarrito es leerPiezas: tolera basura devolviendo vacío.
func leerPiezasDelCarrito(crudo string) []PiezaAcortar {
	var leidas []any
	if json.Unmarshal([]byte(crudo), &leidas) != nil {
		return []PiezaAcortar{}
	}
	out := []PiezaAcortar{}
	for _, x := range leidas {
		m, _ := x.(map[string]any)
		num := func(k string) float64 {
			v, ok := m[k]
			n := numeroJS(v, ok)
			if math.IsNaN(n) || n == 0 {
				return 0
			}
			return jsmath.Round(n)
		}
		acotar := func(k string) float64 { return math.Min(2, math.Max(0, num(k))) }
		veta := 0.0
		if v, ok := m["respetaVeta"]; ok && numeroJS(v, true) == 1 {
			veta = 1
		}
		p := PiezaAcortar{LargoMm: num("largoMm"), AnchoMm: num("anchoMm"), Cantidad: num("cantidad"), RespetaVeta: veta,
			CantoLargo: acotar("cantoLargo"), CantoAncho: acotar("cantoAncho")}
		if e, ok := m["etiqueta"].(string); ok {
			p.Etiqueta = &e
		}
		if p.LargoMm > 0 && p.AnchoMm > 0 && p.Cantidad > 0 {
			out = append(out, p)
		}
	}
	return out
}

// ResolverCarrito es resolverCortesDelCarrito: se recalcula todo con la lista
// de quien compra. El error es para mostrar.
func (s *Servicio) ResolverCarrito(ctx context.Context, l catalogo.Lista, cartID string) ([]CorteResuelto, string, error) {
	resueltos := []CorteResuelto{}
	if !plataforma.UUIDValido(cartID) {
		return resueltos, "", nil
	}
	filas, err := s.pool.Query(ctx, `
		SELECT id::text, variant_id::text, material_descripcion, mitad, canto_descripcion, piezas
		FROM cart_cortes WHERE cart_id = $1 ORDER BY created_at ASC`, cartID)
	if err != nil {
		return nil, "", err
	}
	type fila struct {
		id           string
		variant      *string
		material     string
		mitad, canto *string
		piezas       string
	}
	cortes, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (fila, error) {
		var f fila
		err := r.Scan(&f.id, &f.variant, &f.material, &f.mitad, &f.canto, &f.piezas)
		return f, err
	})
	if err != nil || len(cortes) == 0 {
		return resueltos, "", err
	}
	params, err := s.Parametros(ctx)
	if err != nil {
		return nil, "", err
	}
	for _, c := range cortes {
		if c.variant == nil {
			return []CorteResuelto{}, "El corte de " + c.material + " quedó sin placa. Sacalo del carrito y armalo de nuevo.", nil
		}
		placa, err := s.placa(ctx, l, *c.variant)
		if err != nil {
			return nil, "", err
		}
		if placa == nil {
			return []CorteResuelto{}, "La placa del corte de " + c.material + " ya no está disponible. Sacalo del carrito y elegí otra.", nil
		}
		piezas := leerPiezasDelCarrito(c.piezas)
		if len(piezas) == 0 {
			return []CorteResuelto{}, "El corte de " + c.material + " no tiene medidas. Sacalo del carrito y armalo de nuevo.", nil
		}
		mitad := c.mitad
		if mitad != nil && *mitad == "" {
			mitad = nil
		}
		if mitad != nil && !placa.AdmiteMedia {
			return []CorteResuelto{}, c.material + " se vende solo entera. Sacá el corte del carrito y armalo sobre la placa completa.", nil
		}
		medida, plano, cuenta, err := s.cotizar(ctx, l, placa, mitad, piezas)
		if err != nil {
			return nil, "", err
		}
		if len(plano.NoEntran) > 0 {
			return []CorteResuelto{}, "En el corte de " + c.material + " hay medidas que no entran en la placa. Revisalo antes de comprar.", nil
		}
		fraccion := FraccionDePlaca(mitad, placa.PrecioMediaPct)
		lineas := []LineaDelCorte{}
		if cuenta.PlacasEnteras > 0 {
			desc := placa.Descripcion
			if mitad != nil {
				desc += " — " + strings.ToLower(NombreDeLaMitad(mitad))
			}
			v := placa.VariantID
			lineas = append(lineas, LineaDelCorte{EsMaterial: true, VariantID: &v, Descripcion: desc, Unidad: "unidad",
				Cantidad: float64(cuenta.PlacasEnteras), PrecioUnitario: placa.Precio * fraccion})
		}
		if cuenta.SubtotalCorte > 0 {
			pas := "pasadas"
			if cuenta.PasadasCobrables == 1 {
				pas = "pasada"
			}
			lineas = append(lineas, LineaDelCorte{Descripcion: fmt.Sprintf("Corte a medida — %d %s", cuenta.PasadasCobrables, pas),
				Unidad: "pasada", Cantidad: float64(cuenta.PasadasCobrables), PrecioUnitario: cuenta.PrecioPorPasada})
		}
		if cuenta.SubtotalCanto > 0 {
			desc := "Tapacanto pegado"
			if c.canto != nil && *c.canto != "" {
				desc += " — " + *c.canto
			}
			lineas = append(lineas, LineaDelCorte{Descripcion: desc, Unidad: "m", Cantidad: cuenta.MetrosCanto, PrecioUnitario: placa.PrecioPorMetroCanto})
		}
		resueltos = append(resueltos, CorteResuelto{
			ID: c.id, Placa: *placa, Piezas: piezas, Mitad: mitad, CantoDescripcion: c.canto, PlacaLargoMm: medida.Largo,
			PlacaAnchoMm: medida.Ancho, Placas: len(plano.Placas), Pasadas: plano.PasadasCobrables,
			AnchoSierraMm: params.AnchoSierraMm, Cuenta: cuenta, Lineas: lineas,
		})
	}
	return resueltos, "", nil
}

package correo

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"

	"mjbj/internal/catalogo"
	"mjbj/internal/plataforma"
)

// Pedido de presupuesto en un clic: «necesito 14 placas de melamina blanca
// y 6 estantes de 560 × 350» se lee como renglones —cantidad y qué— y cada
// uno se busca en el catálogo con la misma búsqueda y los mismos precios
// que la tienda (internal/catalogo), con la lista del cliente si la tiene.
//
// El correo no crea el presupuesto: los presupuestos son del ERP, que se
// está mudando a Go en otra tanda. Propone los renglones, los deja copiar,
// y abre el presupuesto nuevo del panel con el cliente ya elegido.

// Renglon es un pedido encontrado en el texto, con lo que el catálogo
// propone para él.
type Renglon struct {
	Texto       string              `json:"texto"`
	Cantidad    float64             `json:"cantidad"`
	Buscado     string              `json:"buscado"`
	Producto    *ProductoPropuesto  `json:"producto,omitempty"`
	Alternativa []ProductoPropuesto `json:"alternativas"`
}

// ProductoPropuesto es un producto del catálogo para un renglón.
type ProductoPropuesto struct {
	ID     string `json:"id"`
	Slug   string `json:"slug"`
	Nombre string `json:"nombre"`
	Unidad string `json:"unidad"`
	Precio string `json:"precio,omitempty"` // «desde», con la lista del cliente
	Enlace string `json:"enlace"`
}

// Presupuesto es la propuesta entera.
type Presupuesto struct {
	Renglones []Renglon `json:"renglones"`
	Lista     string    `json:"lista,omitempty"`
	Abrir     string    `json:"abrir"`
}

var (
	// Una cantidad y lo que sigue: «14 placas de melamina blanca»,
	// «6 estantes de 560 × 350», «120 placas de MDF 18 mm».
	reRenglon = regexp.MustCompile(`(?i)\b(\d{1,4}(?:[.,]\d{1,2})?)\s+((?:placas?|tablas?|tirantes?|tablones?|listones?|hojas?|unidades?|u\.?|uds?\.?|piezas?|metros?|mts?\.?|m2|m²|ml|kg|kilos?|bolsas?|cajas?|rollos?|paquetes?|pares?|juegos?|litros?|lts?\.?|varillas?|postes?|estantes?|puertas?|bisagras?|tornillos?|clavos?)\b[\p{L}\p{N} ×x./"'°-]{2,80})`)
	// Lo que no ayuda a encontrar el producto.
	palabrasRelleno = map[string]bool{
		"de": true, "del": true, "la": true, "el": true, "los": true, "las": true, "con": true, "para": true,
		"y": true, "en": true, "a": true, "x": true, "×": true, "por": true, "sin": true, "que": true, "un": true, "una": true,
		"corte": true, "cortadas": true, "cortados": true, "medida": true, "mm": true, "cm": true, "mts": true, "metros": true,
		"unidades": true, "unidad": true, "u": true, "uds": true, "piezas": true, "pieza": true,
	}
	reMedida = regexp.MustCompile(`^\d+([.,]\d+)?$`)
)

// detectarRenglones lee el texto y devuelve hasta 12 renglones.
func detectarRenglones(texto string) []Renglon {
	var out []Renglon
	vistos := map[string]bool{}
	for _, linea := range strings.Split(texto, "\n") {
		linea = strings.TrimSpace(linea)
		if linea == "" || strings.HasPrefix(linea, ">") {
			continue
		}
		for _, m := range reRenglon.FindAllStringSubmatch(linea, -1) {
			cantidad, err := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", "."), 64)
			if err != nil || cantidad <= 0 {
				continue
			}
			resto := cortarEn(m[2])
			buscado := terminosParaCatalogo(resto)
			if buscado == "" || vistos[buscado] {
				continue
			}
			vistos[buscado] = true
			out = append(out, Renglon{Texto: strings.TrimSpace(m[1] + " " + resto), Cantidad: cantidad, Buscado: buscado, Alternativa: []ProductoPropuesto{}})
			if len(out) == 12 {
				return out
			}
		}
	}
	return out
}

// cortarEn corta el renglón donde empieza otra cosa: « y 6 estantes»,
// «. Confirmame…».
func cortarEn(s string) string {
	for _, sep := range []string{". ", ", ", " y ", "; ", "?", "!"} {
		if i := strings.Index(s, sep); i > 0 {
			s = s[:i]
		}
	}
	return strings.TrimRight(strings.TrimSpace(s), ".,")
}

// terminosParaCatalogo deja las palabras que sirven para buscar: la unidad
// en singular primero («placa»), después lo que la describe, sin números
// sueltos ni relleno. Hasta cuatro.
func terminosParaCatalogo(s string) string {
	var out []string
	for i, p := range strings.Fields(strings.ToLower(s)) {
		p = strings.TrimFunc(p, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
		if p == "" || palabrasRelleno[p] || reMedida.MatchString(p) {
			continue
		}
		if i == 0 {
			// La unidad («placas», «tirantes») como la escribe el catálogo.
			p = singular(p)
			if p == "estante" || p == "puerta" {
				continue // es una pieza cortada, no un producto: lo que importa es el material
			}
			if p == "placa" || p == "hoja" || p == "unidade" || p == "u" || p == "pieza" || p == "bolsa" || p == "caja" || p == "paquete" {
				continue
			}
		}
		out = append(out, p)
		if len(out) == 4 {
			break
		}
	}
	return strings.Join(out, " ")
}

func singular(p string) string {
	switch {
	case strings.HasSuffix(p, "es") && len(p) > 4 && strings.ContainsRune("lrnd", rune(p[len(p)-3])):
		return p[:len(p)-2]
	case strings.HasSuffix(p, "s") && len(p) > 3:
		return p[:len(p)-1]
	}
	return p
}

// proponer busca cada renglón en el catálogo. Si la búsqueda entera no da
// nada, se prueba con menos palabras (de atrás para adelante): «melamina
// blanca brillante» encuentra «melamina blanca».
func (e *ERP) proponer(ctx context.Context, renglones []Renglon, lista catalogo.Lista) error {
	cat := catalogo.Nuevo(e.pool)
	for i := range renglones {
		palabras := strings.Fields(renglones[i].Buscado)
		for n := len(palabras); n > 0; n-- {
			productos, err := cat.Productos(ctx, catalogo.Filtros{Busqueda: strings.Join(palabras[:n], " ")}, lista)
			if err != nil {
				return err
			}
			if len(productos) == 0 {
				continue
			}
			for j, p := range productos {
				pp := ProductoPropuesto{ID: p.ID, Slug: p.Slug, Nombre: p.Name, Unidad: p.Unit, Enlace: e.enlace("/admin/precios", url.Values{"buscar": {p.Name}})}
				if p.PrecioDesde != nil {
					pp.Precio = *p.PrecioDesde
				}
				if j == 0 {
					renglones[i].Producto = &pp
				} else if j <= 3 {
					renglones[i].Alternativa = append(renglones[i].Alternativa, pp)
				}
			}
			break
		}
	}
	return nil
}

type pedidoPresupuesto struct {
	Texto  string `json:"texto"`
	Correo string `json:"correo"`
}

func (a *App) presupuesto(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conFichas(w, r, cred) {
		return
	}
	var p pedidoPresupuesto
	if prob := plataforma.LeerJSON(w, r, &p, 256<<10); prob != nil {
		plataforma.EscribirProblema(w, prob)
		return
	}
	out := Presupuesto{Renglones: detectarRenglones(p.Texto), Abrir: a.erp.enlace("/admin/presupuestos/nuevo", nil)}
	if len(out.Renglones) == 0 {
		plataforma.EscribirJSON(w, http.StatusOK, out)
		return
	}
	ctx, cancelar := context.WithTimeout(r.Context(), 2*topeERP)
	defer cancelar()
	cat := catalogo.Nuevo(a.erp.pool)
	lista, err := cat.General(ctx)
	if err != nil {
		a.fallarERP(w, r, err)
		return
	}
	// Con la lista del cliente, si tiene una propia.
	if c, err := a.erp.q.FichaPorCorreo(ctx, strings.ToLower(strings.TrimSpace(p.Correo))); err == nil {
		out.Abrir = a.erp.enlace("/admin/presupuestos/nuevo", url.Values{"cliente": {c.ID}})
		if c.PriceListID != nil {
			if l, err := cat.Dada(ctx, *c.PriceListID); err == nil {
				lista = l
			}
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		a.fallarERP(w, r, err)
		return
	}
	if lista.Nombre != nil {
		out.Lista = *lista.Nombre
	}
	if err := a.erp.proponer(ctx, out.Renglones, lista); err != nil {
		a.fallarERP(w, r, err)
		return
	}
	plataforma.EscribirJSON(w, http.StatusOK, out)
}

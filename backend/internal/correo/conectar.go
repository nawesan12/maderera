package correo

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"mjbj/internal/plataforma"
)

// Los adjuntos que se conectan con el ERP (2i y lo pedido después): un
// despiece va a cortes, la factura de un proveedor a compras, una lista de
// precios a la importación de precios, un comprobante de transferencia al
// cobro del cliente.
//
// El correo **no escribe en el ERP** (compras, cortes, precios y cobros se
// están mudando a Go en otras tandas): lee el adjunto, muestra lo que
// encontró, deja copiarlo y abre la pantalla del panel donde se carga. Las
// pantallas que hoy no aceptan datos precargados están anotadas en
// docs/go/progreso.md («Correo: el diseño v2»).

// Conexion es lo que el correo encontró en un adjunto.
type Conexion struct {
	// Tipo: despiece, factura, lista, comprobante. Vacío: nada que conectar.
	Tipo    string `json:"tipo"`
	Titulo  string `json:"titulo"`
	Detalle string `json:"detalle"`
	// Datos son pares «qué: valor» para mostrar (CUIT, número, total…).
	Datos [][2]string `json:"datos"`
	// Piezas de un despiece (pieza, cantidad, largo, ancho, material).
	Piezas []Pieza `json:"piezas,omitempty"`
	// Copiar es el texto listo para pegar en la pantalla del panel.
	Copiar   string    `json:"copiar,omitempty"`
	Acciones []Accion2 `json:"acciones"`
}

// Pieza es un renglón de un despiece.
type Pieza struct {
	Nombre   string `json:"nombre"`
	Cantidad int    `json:"cantidad"`
	Largo    int    `json:"largo"`
	Ancho    int    `json:"ancho"`
	Material string `json:"material,omitempty"`
}

// Accion2 es un botón: abre una pantalla del panel.
type Accion2 struct {
	Texto  string `json:"texto"`
	Enlace string `json:"enlace"`
	Icono  string `json:"icono"`
}

var (
	reCUIT        = regexp.MustCompile(`\b(20|23|24|27|30|33|34)-?(\d{8})-?(\d)\b`)
	reComprobante = regexp.MustCompile(`\b(\d{4,5})\s*-\s*(\d{8})\b`)
	reImporte     = `\$?\s*((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})`
	reTotal       = regexp.MustCompile(`(?i)\b(?:importe\s+)?total(?:\s+a\s+pagar)?\s*[:$]?\s*` + reImporte)
	reMonto       = regexp.MustCompile(`(?i)(?:importe|monto|transferiste|enviaste|total)\s*[:$]?\s*` + reImporte)
	reCBU         = regexp.MustCompile(`\b(\d{22})\b`)
	reFecha       = regexp.MustCompile(`\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b`)
	reOperacion   = regexp.MustCompile(`(?i)(?:n(?:ú|u)mero de )?(?:operaci(?:ó|o)n|comprobante|transacci(?:ó|o)n)\s*(?:n[°º.]?|#)?\s*[:]?\s*([A-Z0-9-]{6,})`)
	// «Lateral bajo mesada  4  700  560  Melamina blanca 18».
	rePieza = regexp.MustCompile(`^(.{2,60}?)\s+(\d{1,3})\s+(\d{2,4})\s*(?:x|×)?\s*(\d{2,4})(?:\s+(.{2,60}))?$`)
)

// importe pasa «1.250.000,50» a 1250000.5.
func importe(s string) float64 {
	f, _ := strconv.ParseFloat(strings.ReplaceAll(strings.ReplaceAll(s, ".", ""), ",", "."), 64)
	return f
}

func pesosAR(f float64) string {
	entero := strconv.FormatInt(int64(f), 10)
	var b strings.Builder
	for i, r := range entero {
		if i > 0 && (len(entero)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	if c := int64(f*100+0.5) % 100; c != 0 {
		return fmt.Sprintf("$ %s,%02d", b.String(), c)
	}
	return "$ " + b.String()
}

// analizarAdjunto decide qué es y arma la conexión. `ficha` puede ser nil.
func (e *ERP) analizarAdjunto(nombre, tipo string, datos []byte, ficha *Ficha) Conexion {
	sin := Conexion{Datos: [][2]string{}, Acciones: []Accion2{}}
	nombreN := normal(nombre)
	var lineas []string
	var filas [][]string
	esPlanilla := strings.Contains(tipo, "sheet") || strings.Contains(tipo, "excel") || strings.HasSuffix(strings.ToLower(nombre), ".xlsx") || strings.HasSuffix(strings.ToLower(nombre), ".csv")
	switch {
	case tipo == "application/pdf" || strings.HasSuffix(strings.ToLower(nombre), ".pdf"):
		for _, l := range strings.Split(textoDePDF(datos), "\n") {
			if l = strings.Join(strings.Fields(l), " "); l != "" {
				lineas = append(lineas, l)
			}
		}
	case esPlanilla:
		filas = filasDePlanilla(nombre, datos)
		for _, f := range filas {
			lineas = append(lineas, strings.Join(f, " "))
		}
	default:
		return sin
	}
	texto := strings.Join(lineas, "\n")
	textoN := normal(texto)

	// Despiece: piezas con cantidad, largo y ancho.
	if strings.Contains(nombreN, "despiece") || strings.Contains(textoN, "despiece") || strings.Contains(textoN, "largo") && strings.Contains(textoN, "ancho") {
		piezas := piezasDePlanilla(filas)
		if len(piezas) == 0 {
			piezas = piezasDeTexto(lineas)
		}
		if len(piezas) > 0 {
			total := 0
			var copiar strings.Builder
			for _, p := range piezas {
				total += p.Cantidad
				fmt.Fprintf(&copiar, "%d\t%d\t%d\t%s\t%s\n", p.Cantidad, p.Largo, p.Ancho, p.Nombre, p.Material)
			}
			c := Conexion{
				Tipo: "despiece", Titulo: "Es un despiece",
				Detalle: fmt.Sprintf("Encontramos %d piezas en %d renglones. Podés mandarlas a cortes o pasarlas a un presupuesto.", total, len(piezas)),
				Datos:   [][2]string{}, Piezas: piezas, Copiar: copiar.String(),
				Acciones: []Accion2{{Texto: "Mandar a cortes", Enlace: e.enlace("/admin/cortes/nuevo", nil), Icono: "cortes"}},
			}
			presu := e.enlace("/admin/presupuestos/nuevo", nil)
			if ficha != nil {
				presu = ficha.Enlaces["presupuesto"]
			}
			c.Acciones = append([]Accion2{{Texto: "Pasar a un presupuesto", Enlace: presu, Icono: "presupuesto"}}, c.Acciones...)
			return c
		}
	}

	// Factura de proveedor: CUIT, número de comprobante y total.
	if strings.Contains(textoN, "factura") || strings.Contains(nombreN, "factura") {
		cuit := reCUIT.FindStringSubmatch(texto)
		numero := reComprobante.FindStringSubmatch(texto)
		total := reTotal.FindAllStringSubmatch(texto, -1)
		if cuit != nil && (numero != nil || total != nil) {
			c := Conexion{Tipo: "factura", Titulo: "Es una factura de proveedor", Detalle: "Se carga en compras. Estos son los datos que leímos:", Datos: [][2]string{}}
			c.Datos = append(c.Datos, [2]string{"CUIT", cuit[1] + "-" + cuit[2] + "-" + cuit[3]})
			if numero != nil {
				c.Datos = append(c.Datos, [2]string{"Número", fmt.Sprintf("%s-%s", numero[1], numero[2])})
			}
			if total != nil {
				// El último «total» es el de la factura, después de los subtotales.
				c.Datos = append(c.Datos, [2]string{"Total", pesosAR(importe(total[len(total)-1][1]))})
			}
			if strings.Contains(textoN, "factura a") || strings.Contains(textoN, "factura a ") {
				c.Datos = append(c.Datos, [2]string{"Tipo", "A"})
			}
			for _, d := range c.Datos {
				c.Copiar += d[0] + ": " + d[1] + "\n"
			}
			c.Acciones = []Accion2{{Texto: "Cargar en compras", Enlace: e.enlace("/admin/compras/facturas", nil), Icono: "presupuesto"}}
			return c
		}
	}

	// Comprobante de transferencia: monto, fecha, operación.
	if strings.Contains(textoN, "transferencia") || strings.Contains(textoN, "comprobante") && (strings.Contains(textoN, "cbu") || strings.Contains(textoN, "cvu")) {
		if m := reMonto.FindStringSubmatch(texto); m != nil {
			c := Conexion{Tipo: "comprobante", Titulo: "Es un comprobante de transferencia", Datos: [][2]string{{"Monto", pesosAR(importe(m[1]))}}}
			if f := reFecha.FindStringSubmatch(texto); f != nil {
				c.Datos = append(c.Datos, [2]string{"Fecha", f[0]})
			}
			if op := reOperacion.FindStringSubmatch(texto); op != nil {
				c.Datos = append(c.Datos, [2]string{"Operación", op[1]})
			}
			if cbu := reCBU.FindStringSubmatch(texto); cbu != nil {
				c.Datos = append(c.Datos, [2]string{"CBU/CVU", cbu[1]})
			}
			for _, d := range c.Datos {
				c.Copiar += d[0] + ": " + d[1] + "\n"
			}
			if ficha != nil {
				c.Detalle = fmt.Sprintf("Es de %s. El cobro se registra en su cuenta corriente (debe %s).", ficha.Nombre, pesosAR(max(ficha.Saldo, 0)))
				c.Acciones = []Accion2{{Texto: "Registrar el cobro", Enlace: ficha.Enlaces["ficha"], Icono: "persona"}}
			} else {
				c.Detalle = "El remitente no es cliente: buscá a quién corresponde en el panel."
				c.Acciones = []Accion2{{Texto: "Buscar el cliente", Enlace: e.enlace("/admin/clientes", nil), Icono: "persona"}}
			}
			return c
		}
	}

	// Lista de precios de proveedor: una planilla con una columna de precio.
	if len(filas) > 3 && (strings.Contains(nombreN, "lista") || strings.Contains(nombreN, "precio") || strings.Contains(textoN, "precio")) {
		if conPrecio := filasConPrecio(filas); conPrecio > 0 {
			return Conexion{
				Tipo: "lista", Titulo: "Es una lista de precios",
				Detalle: fmt.Sprintf("Tiene %d productos con precio. Se importa en Precios: bajá la planilla y subila en «Importar».", conPrecio),
				Datos:   [][2]string{}, Acciones: []Accion2{{Texto: "Ir a importar precios", Enlace: e.enlace("/admin/precios", nil), Icono: "planilla"}},
			}
		}
	}
	return sin
}

func piezasDePlanilla(filas [][]string) []Pieza {
	cab := -1
	var iNombre, iCant, iLargo, iAncho, iMaterial = -1, -1, -1, -1, -1
	for i, f := range filas {
		for j, c := range f {
			switch n := normal(c); {
			case n == "largo" || strings.HasPrefix(n, "largo "):
				iLargo = j
			case n == "ancho" || strings.HasPrefix(n, "ancho "):
				iAncho = j
			case strings.HasPrefix(n, "cant"):
				iCant = j
			case n == "pieza" || n == "nombre" || n == "descripcion":
				iNombre = j
			case n == "material" || n == "placa":
				iMaterial = j
			}
		}
		if iLargo >= 0 && iAncho >= 0 {
			cab = i
			break
		}
	}
	if cab < 0 {
		return nil
	}
	celda := func(f []string, i int) string {
		if i >= 0 && i < len(f) {
			return f[i]
		}
		return ""
	}
	var out []Pieza
	for _, f := range filas[cab+1:] {
		l, _ := strconv.ParseFloat(strings.ReplaceAll(celda(f, iLargo), ",", "."), 64)
		a, _ := strconv.ParseFloat(strings.ReplaceAll(celda(f, iAncho), ",", "."), 64)
		if l <= 0 || a <= 0 {
			continue
		}
		cant := 1
		if n, err := strconv.ParseFloat(strings.ReplaceAll(celda(f, iCant), ",", "."), 64); err == nil && n > 0 {
			cant = int(n)
		}
		nombre := celda(f, iNombre)
		if nombre == "" && iNombre < 0 {
			var partes []string
			for j, c := range f {
				if j != iLargo && j != iAncho && j != iCant && j != iMaterial && c != "" {
					if _, err := strconv.ParseFloat(c, 64); err != nil {
						partes = append(partes, c)
					}
				}
			}
			nombre = strings.Join(partes, " · ")
		}
		out = append(out, Pieza{Nombre: nombre, Cantidad: cant, Largo: int(l), Ancho: int(a), Material: celda(f, iMaterial)})
		if len(out) == 500 {
			break
		}
	}
	return out
}

func piezasDeTexto(lineas []string) []Pieza {
	var out []Pieza
	for _, l := range lineas {
		m := rePieza.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		cant, _ := strconv.Atoi(m[2])
		largo, _ := strconv.Atoi(m[3])
		ancho, _ := strconv.Atoi(m[4])
		if cant <= 0 || largo < 10 || ancho < 10 {
			continue
		}
		out = append(out, Pieza{Nombre: strings.TrimSpace(m[1]), Cantidad: cant, Largo: largo, Ancho: ancho, Material: strings.TrimSpace(m[5])})
		if len(out) == 500 {
			break
		}
	}
	return out
}

func filasConPrecio(filas [][]string) int {
	col := -1
	for i, f := range filas {
		for j, c := range f {
			if n := normal(c); strings.Contains(n, "precio") || n == "pu" || strings.Contains(n, "importe") {
				col = j
			}
		}
		if col >= 0 {
			filas = filas[i+1:]
			break
		}
	}
	if col < 0 {
		return 0
	}
	n := 0
	for _, f := range filas {
		if col < len(f) {
			v := strings.TrimSpace(strings.TrimPrefix(f[col], "$"))
			if _, err := strconv.ParseFloat(strings.ReplaceAll(strings.ReplaceAll(v, ".", ""), ",", "."), 64); err == nil && v != "" {
				n++
			}
		}
	}
	return n
}

// conectarAdjunto es GET …/adjuntos/{indice}/conectar.
func (a *App) conectarAdjunto(w http.ResponseWriter, r *http.Request, cred Credenciales) {
	if !a.conFichas(w, r, cred) {
		return
	}
	uid, ok := uidDe(r)
	indice, err := strconv.Atoi(r.PathValue("indice"))
	if !ok || err != nil || indice < 0 {
		a.fallar(w, r, ErrNoExiste)
		return
	}
	parte, err := a.srv.Adjunto(r.Context(), cred, r.PathValue("carpeta"), uid, indice, "")
	if err != nil {
		a.fallar(w, r, err)
		return
	}
	var ficha *Ficha
	if de := r.URL.Query().Get("de"); de != "" {
		ctx, cancelar := context.WithTimeout(r.Context(), topeERP)
		ficha, _ = a.erp.FichaDe(ctx, de)
		cancelar()
	}
	c := a.erp.analizarAdjunto(parte.Nombre, strings.ToLower(parte.Tipo), parte.Datos, ficha)
	w.Header().Set("Cache-Control", "private, max-age=300")
	plataforma.EscribirJSON(w, http.StatusOK, c)
}

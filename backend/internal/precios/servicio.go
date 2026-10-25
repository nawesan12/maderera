package precios

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// Servicio es la gestión de precios.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

// texto2 es un numeric(…, 2) como lo devolvía drizzle («84500.00»).
func texto2(n *jsmath.Num) *string {
	if n == nil {
		return nil
	}
	t := strconv.FormatFloat(float64(*n), 'f', 2, 64)
	return &t
}

// listas: la general y la profesional (por slug), las que edita el panel.
type listas struct{ general, profesional *sqlc.PriceList }

func (s *Servicio) listas(ctx context.Context, q *sqlc.Queries) (listas, []sqlc.PriceList, error) {
	todas, err := q.ListasDelPanel(ctx)
	if err != nil {
		return listas{}, nil, err
	}
	var l listas
	for i := range todas {
		if todas[i].IsDefault && l.general == nil {
			l.general = &todas[i]
		}
		if todas[i].Slug == "profesional" && l.profesional == nil {
			l.profesional = &todas[i]
		}
	}
	return l, todas, nil
}

// --- la grilla de precios ---

// DiasParaRevisar: un precio que no se tocó en este tiempo se marca.
const DiasParaRevisar = 60

// FilaPrecio es una medida en la grilla de precios.
type FilaPrecio struct {
	VariantID         string     `json:"variantId"`
	ProductID         string     `json:"productId"`
	SKU               string     `json:"sku"`
	Producto          string     `json:"producto"`
	Medida            string     `json:"medida"`
	Categoria         string     `json:"categoria"`
	CategoriaSlug     string     `json:"categoriaSlug"`
	Unidad            string     `json:"unidad"`
	Imagen            *string    `json:"imagen"`
	PrecioGeneral     string     `json:"precioGeneral"`
	PrecioProfesional string     `json:"precioProfesional"`
	Brecha            *float64   `json:"brecha"`
	Actualizado       *time.Time `json:"actualizado"`
	Desactualizado    bool       `json:"desactualizado"`
}

// Listar es listarPrecios: las medidas activas, con los precios de las dos
// listas, la brecha entre ellas y si hace mucho que nadie las toca.
func (s *Servicio) Listar(ctx context.Context, busqueda, categoria string, ahora time.Time) ([]FilaPrecio, error) {
	ls, _, err := s.listas(ctx, s.q)
	if err != nil {
		return nil, err
	}
	cond := []string{"p.active", "v.active"}
	var args []any
	arg := func(v any) string { args = append(args, v); return fmt.Sprintf("$%d", len(args)) }
	if categoria != "" && categoria != "todos" {
		cond = append(cond, "c.slug = "+arg(categoria))
	}
	t := strings.Fields(busqueda)
	if len(t) > 6 {
		t = t[:6]
	}
	for _, termino := range t {
		patron := arg("%" + termino + "%")
		var col []string
		for _, c := range []string{"p.name", "v.sku", "v.label", "p.brand", "c.name"} {
			col = append(col, "f_unaccent("+c+") ILIKE f_unaccent("+patron+")")
		}
		cond = append(cond, "("+strings.Join(col, " OR ")+")")
	}
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, v.sku, p.name, v.label, c.name, c.slug, p.unit::text
		FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id
		WHERE `+strings.Join(cond, " AND ")+`
		ORDER BY c.sort_order, p.name, v.sort_order`, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaPrecio, error) {
		var f FilaPrecio
		err := r.Scan(&f.VariantID, &f.ProductID, &f.SKU, &f.Producto, &f.Medida, &f.Categoria, &f.CategoriaSlug, &f.Unidad)
		return f, err
	})
	if err != nil || len(out) == 0 {
		return []FilaPrecio{}, err
	}
	var variantes, productos []string
	visto := map[string]bool{}
	for _, f := range out {
		variantes = append(variantes, f.VariantID)
		if !visto[f.ProductID] {
			visto[f.ProductID] = true
			productos = append(productos, f.ProductID)
		}
	}
	portadas, err := s.q.PortadasDe(ctx, productos)
	if err != nil {
		return nil, err
	}
	portada := map[string]string{}
	for _, p := range portadas {
		portada[p.ProductID] = p.Url
	}
	precios, err := s.q.PreciosDeLasVariantes(ctx, variantes)
	if err != nil {
		return nil, err
	}
	type precioDe struct{ variante, lista string }
	precio := map[precioDe]string{}
	ultima := map[string]time.Time{}
	for _, p := range precios {
		precio[precioDe{p.VariantID, p.PriceListID}] = p.Price
		if p.UpdatedAt.After(ultima[p.VariantID]) {
			ultima[p.VariantID] = p.UpdatedAt
		}
	}
	buscar := func(v string, l *sqlc.PriceList) string {
		if l != nil {
			if x, ok := precio[precioDe{v, l.ID}]; ok {
				return x
			}
		}
		return "0"
	}
	limite := ahora.Add(-DiasParaRevisar * 24 * time.Hour)
	for i := range out {
		f := &out[i]
		if u, ok := portada[f.ProductID]; ok {
			f.Imagen = &u
		}
		f.PrecioGeneral, f.PrecioProfesional = buscar(f.VariantID, ls.general), buscar(f.VariantID, ls.profesional)
		g, p := jsmath.Numero(f.PrecioGeneral), jsmath.Numero(f.PrecioProfesional)
		f.Brecha = Brecha(g, p)
		if u, ok := ultima[f.VariantID]; ok {
			f.Actualizado = &u
		}
		f.Desactualizado = g > 0 && (f.Actualizado == nil || f.Actualizado.Before(limite))
	}
	return out, nil
}

// CambioDePrecio es una línea del historial.
type CambioDePrecio struct {
	ID             string    `json:"id"`
	SKU            string    `json:"sku"`
	Producto       string    `json:"producto"`
	Medida         string    `json:"medida"`
	Lista          string    `json:"lista"`
	PrecioAnterior *string   `json:"precioAnterior"`
	PrecioNuevo    string    `json:"precioNuevo"`
	Origen         string    `json:"origen"`
	Motivo         *string   `json:"motivo"`
	CreatedAt      time.Time `json:"createdAt"`
}

// Historial son los últimos cambios de precio.
func (s *Servicio) Historial(ctx context.Context, limite int) ([]CambioDePrecio, error) {
	filas, err := s.q.HistorialDePrecios(ctx, int32(limite))
	if err != nil {
		return nil, err
	}
	out := make([]CambioDePrecio, len(filas))
	for i, f := range filas {
		nuevo := f.PrecioNuevo
		out[i] = CambioDePrecio{f.ID, f.Sku, f.Producto, f.Medida, f.Lista, texto2(f.PrecioAnterior), *texto2(&nuevo),
			string(f.Origen), f.Motivo, f.CreatedAt}
	}
	return out, nil
}

// ListaDelPanel es una lista de precios con las formas de drizzle.
type ListaDelPanel struct {
	ID                     string    `json:"id"`
	Slug                   string    `json:"slug"`
	Name                   string    `json:"name"`
	IsDefault              bool      `json:"isDefault"`
	Active                 bool      `json:"active"`
	CreatedAt              time.Time `json:"createdAt"`
	PorcentajeSobreGeneral *string   `json:"porcentajeSobreGeneral"`
	// Cuántos precios propios tiene cargados (el resto sale de la general).
	ItemsPropios int32 `json:"itemsPropios"`
}

// Listas son todas, la general primero.
func (s *Servicio) Listas(ctx context.Context) ([]ListaDelPanel, error) {
	_, todas, err := s.listas(ctx, s.q)
	if err != nil {
		return nil, err
	}
	conteos, err := s.q.ItemsPorLista(ctx)
	if err != nil {
		return nil, err
	}
	items := map[string]int32{}
	for _, c := range conteos {
		items[c.PriceListID] = c.Cuantos
	}
	out := make([]ListaDelPanel, len(todas))
	for i, l := range todas {
		out[i] = ListaDelPanel{l.ID, l.Slug, l.Name, l.IsDefault, l.Active, l.CreatedAt, texto2(l.PorcentajeSobreGeneral), items[l.ID]}
	}
	return out, nil
}

// --- escribir precios ---

// cambio aplica un precio si cambió y lo anota en el historial. Devuelve si
// hubo cambio.
func cambiar(ctx context.Context, q *sqlc.Queries, ses *auth.Sesion, variante, lista, nuevo string,
	origen sqlc.PriceChangeSource, motivo *string, lote *string) (bool, error) {
	var anterior *string
	a, err := q.PrecioActual(ctx, sqlc.PrecioActualParams{VariantID: variante, PriceListID: lista})
	if err == nil {
		anterior = &a
		if jsmath.Numero(a) == jsmath.Numero(nuevo) {
			return false, nil
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err := q.FijarPrecio(ctx, sqlc.FijarPrecioParams{VariantID: variante, PriceListID: lista, Price: nuevo}); err != nil {
		return false, err
	}
	return true, q.AnotarPrecio(ctx, sqlc.AnotarPrecioParams{
		VariantID: variante, PriceListID: lista, Anterior: anterior, Nuevo: nuevo, Origen: origen,
		Motivo: motivo, LoteID: lote, CreatedByUserID: &ses.UserID,
	})
}

func uuid() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// Editar es editarPrecio: un precio a mano.
func (s *Servicio) Editar(ctx context.Context, ses *auth.Sesion, variante, lista, precio string) error {
	n := jsmath.Numero(precio)
	if !plataforma.UUIDValido(variante) || !plataforma.UUIDValido(lista) {
		return plataforma.Invalido(map[string]string{"precio": "Invalid UUID"})
	}
	if !(n >= 0) || n != n || n > 1e300 {
		return plataforma.Invalido(map[string]string{"precio": "El precio tiene que ser un número positivo."})
	}
	valor := jsmath.Fijo2(n)
	return pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := cambiar(ctx, s.q.WithTx(tx), ses, variante, lista, valor, sqlc.PriceChangeSourceManual, nil, nil)
		return err
	})
}

// PedidoDeAjuste es el formulario del ajuste masivo, como texto.
type PedidoDeAjuste struct {
	Porcentaje, Categoria, Rubro, ListaSlug, Base, Redondeo, Motivo string
}

// ResultadoDeAjuste es cuántos precios cambiaron y cuántos no tenían costo.
type ResultadoDeAjuste struct{ Tocados, SinCosto int }

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// Ajustar es ajustarPrecios: un porcentaje sobre el precio (o sobre el
// costo, con o sin elaboración) de las medidas activas de una categoría o
// rubro, en una o las dos listas, con redondeo opcional, en un lote del
// historial.
func (s *Servicio) Ajustar(ctx context.Context, ses *auth.Sesion, p PedidoDeAjuste) (string, error) {
	porcentaje, e := PorcentajeDeAjuste(p.Porcentaje)
	if e != "" {
		return "", plataforma.Invalido(map[string]string{"porcentaje": e})
	}
	if p.ListaSlug == "" {
		p.ListaSlug = "ambas"
	}
	if p.Base == "" {
		p.Base = "precio"
	}
	if p.Redondeo == "" {
		p.Redondeo = "ninguno"
	}
	switch {
	case p.ListaSlug != "ambas" && p.ListaSlug != "general" && p.ListaSlug != "profesional":
		return "", plataforma.Invalido(map[string]string{"listaSlug": `Invalid option: expected one of "ambas"|"general"|"profesional"`})
	case p.Base != "precio" && p.Base != "costo" && p.Base != "costo_elaborado":
		return "", plataforma.Invalido(map[string]string{"base": `Invalid option: expected one of "precio"|"costo"|"costo_elaborado"`})
	case p.Redondeo != "ninguno" && p.Redondeo != "decena" && p.Redondeo != "centena" && p.Redondeo != "mil":
		return "", plataforma.Invalido(map[string]string{"redondeo": `Invalid option: expected one of "ninguno"|"decena"|"centena"|"mil"`})
	}
	motivo := strings.TrimSpace(p.Motivo)
	if plataforma.LargoJS(motivo) > 200 {
		return "", plataforma.Invalido(map[string]string{"motivo": "Too big: expected string to have <=200 characters"})
	}
	factor := Factor(porcentaje)
	lote := uuid()
	var r ResultadoDeAjuste
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		_, todas, err := s.listas(ctx, q)
		if err != nil {
			return err
		}
		var objetivo []sqlc.PriceList
		for _, l := range todas {
			if p.ListaSlug == "ambas" || (p.ListaSlug == "general" && l.IsDefault) || (p.ListaSlug == "profesional" && l.Slug == "profesional") {
				objetivo = append(objetivo, l)
			}
		}
		filtro := func(v string) *string {
			if v == "" || v == "todos" {
				return nil
			}
			return &v
		}
		variantes, err := q.VariantesParaAjuste(ctx, sqlc.VariantesParaAjusteParams{Categoria: filtro(p.Categoria), Rubro: filtro(p.Rubro)})
		if err != nil || len(variantes) == 0 {
			return err
		}
		ids := make([]string, len(variantes))
		desdeCosto := map[string]float64{}
		for i, v := range variantes {
			ids[i] = v.ID
			if p.Base == "precio" || v.Costo == nil || !(float64(*v.Costo) > 0) {
				continue
			}
			var recargo *float64
			if p.Base == "costo_elaborado" && v.Recargo != nil {
				x := float64(*v.Recargo)
				recargo = &x
			}
			desdeCosto[v.ID] = CostoElaborado(float64(*v.Costo), recargo)
		}
		var texto string
		if motivo != "" {
			texto = motivo
		} else if p.Base == "precio" {
			sentido := "Baja"
			if porcentaje > 0 {
				sentido = "Aumento"
			}
			texto = sentido + " del " + jsmath.Texto(abs(porcentaje)) + "%"
		} else {
			con := ""
			if p.Base == "costo_elaborado" {
				con = " con elaboración"
			}
			texto = "Recalculado desde el costo" + con + " + " + jsmath.Texto(porcentaje) + "% de margen"
		}
		for _, l := range objetivo {
			actuales, err := q.PreciosDeLista(ctx, sqlc.PreciosDeListaParams{PriceListID: l.ID, Ids: ids})
			if err != nil {
				return err
			}
			for _, a := range actuales {
				var base float64
				if p.Base == "precio" {
					base = jsmath.Numero(a.Price)
					if !(base > 0) {
						continue
					}
				} else if c, ok := desdeCosto[a.VariantID]; ok && c != 0 {
					base = c
				} else {
					r.SinCosto++
					continue
				}
				nuevo := jsmath.Fijo2(Ajustar(base, factor, p.Redondeo))
				hubo, err := cambiar(ctx, q, ses, a.VariantID, l.ID, nuevo, sqlc.PriceChangeSourceAjusteMasivo, &texto, &lote)
				if err != nil {
					return err
				}
				if hubo {
					r.Tocados++
				}
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	signo, desdeCostoTexto := "", ""
	if porcentaje > 0 {
		signo = "+"
	}
	if p.Base != "precio" {
		desdeCostoTexto = " (desde costo)"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "precio", "",
		"Ajuste masivo del "+signo+jsmath.Texto(porcentaje)+"% sobre "+strconv.Itoa(r.Tocados)+" precio"+plural(r.Tocados)+desdeCostoTexto,
		sinVacios(map[string]any{"porcentaje": porcentaje, "categoria": p.Categoria, "rubro": p.Rubro, "listaSlug": p.ListaSlug,
			"base": p.Base, "redondeo": p.Redondeo, "motivo": motivo, "loteId": lote, "tocados": r.Tocados, "sinCosto": r.SinCosto}))
	if r.Tocados == 0 {
		if p.Base == "precio" {
			return "", plataforma.Invalido(map[string]string{"porcentaje": "No se encontraron precios para ajustar con ese filtro."})
		}
		return "", plataforma.Invalido(map[string]string{"base": "Ninguno de esos productos tiene costo cargado, así que no hay de dónde calcular."})
	}
	ok := "Se actualizaron " + strconv.Itoa(r.Tocados) + " precio" + plural(r.Tocados) + "."
	if r.SinCosto > 0 {
		ok += " " + strconv.Itoa(r.SinCosto) + " quedaron igual porque no tienen costo cargado."
	}
	return ok, nil
}

func abs(x float64) float64 {
	if x < 0 {
		return -x
	}
	return x
}

// sinVacios saca los textos vacíos del detalle: en el TS eran undefined y
// JSON.stringify no los escribía.
func sinVacios(m map[string]any) map[string]any {
	for k, v := range m {
		if v == "" {
			delete(m, k)
		}
	}
	return m
}

// PorcentajeDeLista fija (o saca, con "") el «general −N %» de una lista.
func (s *Servicio) FijarPorcentaje(ctx context.Context, ses *auth.Sesion, id, crudo string) (string, error) {
	crudo = strings.TrimSpace(crudo)
	var valor *string
	var n float64
	if crudo != "" {
		var e string
		if n, e = PorcentajeDeLista(strings.Replace(crudo, ",", ".", 1)); e != "" {
			return "", plataforma.Invalido(map[string]string{"porcentaje": e})
		}
		t := jsmath.Fijo2(n)
		valor = &t
	}
	l, err := s.q.ListaPorIDDelPanel(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Esa lista no existe.")
	}
	if err != nil {
		return "", err
	}
	if l.IsDefault {
		return "", plataforma.Invalido(map[string]string{"porcentaje": "La lista general no se deriva de sí misma."})
	}
	if err := s.q.FijarPorcentajeDeLista(ctx, sqlc.FijarPorcentajeDeListaParams{ID: id, Porcentaje: valor}); err != nil {
		return "", err
	}
	desc := l.Name + ": dejó de derivarse de la general"
	if valor != nil {
		signo := ""
		if n > 0 {
			signo = "+"
		}
		desc = l.Name + ": " + signo + jsmath.Texto(n) + "% sobre la lista general"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "lista_precios", id, desc, nil)
	return "Porcentaje guardado. Impacta en todo el catálogo de esa lista.", nil
}

// Medios de pago que admiten descuento.
var Medios = []string{"mercado_pago", "transferencia", "efectivo", "debito", "credito", "cuenta_corriente"}

// FormDescuento es un escalón de descuento por medio de pago, como texto.
type FormDescuento struct {
	ID, Medio, DesdeMonto, Porcentaje, Etiqueta string
	Activo                                      bool
}

// GuardarDescuento es guardarDescuentoDePago.
func (s *Servicio) GuardarDescuento(ctx context.Context, ses *auth.Sesion, f FormDescuento) error {
	if f.ID != "" && !plataforma.UUIDValido(f.ID) {
		return plataforma.Invalido(map[string]string{"id": "Invalid UUID"})
	}
	medioValido := false
	for _, m := range Medios {
		medioValido = medioValido || m == f.Medio
	}
	if !medioValido {
		return plataforma.Invalido(map[string]string{"medio": `Invalid option: expected one of "mercado_pago"|"transferencia"|"efectivo"|"debito"|"credito"|"cuenta_corriente"`})
	}
	if f.DesdeMonto == "" {
		f.DesdeMonto = "0"
	}
	if f.Porcentaje == "" {
		return plataforma.Invalido(map[string]string{"porcentaje": "Poné el porcentaje."})
	}
	etiqueta := strings.TrimSpace(f.Etiqueta)
	if plataforma.LargoJS(etiqueta) > 80 {
		return plataforma.Invalido(map[string]string{"etiqueta": "Too big: expected string to have <=80 characters"})
	}
	desde, pct := ParsearImporte(f.DesdeMonto), ParsearImporte(f.Porcentaje)
	if desde != desde || desde < 0 || desde > 1e300 {
		return plataforma.Invalido(map[string]string{"desdeMonto": "El monto desde el que aplica no puede ser negativo."})
	}
	if pct != pct || pct <= 0 || pct > 90 {
		return plataforma.Invalido(map[string]string{"porcentaje": "El porcentaje tiene que estar entre 1 y 90."})
	}
	d, p := jsmath.Fijo2(desde), jsmath.Fijo2(pct)
	medio := sqlc.MedioPago(f.Medio)
	var err error
	if f.ID != "" {
		err = s.q.EditarDescuentoDePago(ctx, sqlc.EditarDescuentoDePagoParams{ID: f.ID, Medio: medio, Desde: d, Porcentaje: p, Etiqueta: etiqueta, Activo: f.Activo})
	} else {
		err = s.q.CrearDescuentoDePago(ctx, sqlc.CrearDescuentoDePagoParams{Medio: medio, Desde: d, Porcentaje: p, Etiqueta: etiqueta, Activo: f.Activo})
	}
	if err != nil {
		if strings.Contains(err.Error(), "payment_discounts_medio_desde_idx") {
			return plataforma.Invalido(map[string]string{"desdeMonto": "Ya hay un escalón de ese medio de pago con el mismo monto desde."})
		}
		return err
	}
	accion := sqlc.AccionAuditoriaCrear
	if f.ID != "" {
		accion = sqlc.AccionAuditoriaEditar
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "descuento_pago", f.ID,
		f.Medio+": "+jsmath.Texto(pct)+"% desde $"+d,
		map[string]any{"medio": f.Medio, "desdeMonto": d, "porcentaje": p, "etiqueta": etiqueta, "activo": f.Activo})
	return nil
}

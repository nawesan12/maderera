package precios

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/jsmath"
	"mjbj/internal/listado"
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
	// Piso es el precio final que apenas cubre el costo (PisoDeCosto); nil
	// sin costo cargado. La grilla marca la lista que queda por debajo.
	Piso *float64 `json:"piso"`
}

// ConteosDePrecios son los totales de cada estado con los mismos filtros.
type ConteosDePrecios struct {
	Todas       int `json:"todas"`
	SinPrecio   int `json:"sinPrecio"`
	ParaRevisar int `json:"paraRevisar"`
	AlDia       int `json:"alDia"`
}

// GrillaDePrecios es una página de la grilla, con el total del filtro.
type GrillaDePrecios struct {
	Filas   []FilaPrecio     `json:"filas"`
	Total   int              `json:"total"`
	Conteos ConteosDePrecios `json:"conteos"`
}

// PorPaginaPrecios: la grilla es una tabla, entran más que en tarjetas.
const PorPaginaPrecios = 50

// Listar es listarPrecios, de a páginas: las medidas activas, con los
// precios de las dos listas, la brecha entre ellas y si hace mucho que nadie
// las toca. El estado («sin-precio», «para-revisar», «al-dia») se decide en
// la consulta, con el mismo criterio que antes se aplicaba en Next.
func (s *Servicio) Listar(ctx context.Context, f listado.Filtros, ahora time.Time) (GrillaDePrecios, error) {
	return s.grilla(ctx, f, ahora, true)
}

// grilla es Listar; sin paginar trae todas las filas del filtro en una sola
// consulta (lo que usa la exportación).
func (s *Servicio) grilla(ctx context.Context, f listado.Filtros, ahora time.Time, paginar bool) (GrillaDePrecios, error) {
	out := GrillaDePrecios{Filas: []FilaPrecio{}}
	ls, _, err := s.listas(ctx, s.q)
	if err != nil {
		return out, err
	}
	var c listado.Consulta
	c.Y("p.active")
	c.Y("v.active")
	c.Comunes(f, "v.id")
	c.Busqueda(f.Busqueda, []string{"p.name", "v.sku", "v.label", "p.brand", "c.name"})
	var general *string
	if ls.general != nil {
		general = &ls.general.ID
	}
	precio := `coalesce((SELECT pli.price FROM price_list_items pli WHERE pli.variant_id = v.id AND pli.price_list_id = ` + c.Arg(general) + `::uuid), 0)`
	tocado := `(SELECT max(pli.updated_at) FROM price_list_items pli WHERE pli.variant_id = v.id)`
	viejo := precio + ` > 0 AND (` + tocado + ` IS NULL OR ` + tocado + ` < ` + c.Arg(ahora.Add(-DiasParaRevisar*24*time.Hour)) + `::timestamptz)`
	estados := map[string]string{
		"sin-precio":   precio + ` <= 0`,
		"para-revisar": viejo,
		"al-dia":       precio + ` > 0 AND NOT (` + viejo + `)`,
	}
	desde := ` FROM product_variants v
		JOIN products p ON p.id = v.product_id
		JOIN categories c ON c.id = p.category_id `
	k := &out.Conteos
	if err := s.pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE `+estados["sin-precio"]+`),
		count(*) FILTER (WHERE `+estados["para-revisar"]+`), count(*) FILTER (WHERE `+estados["al-dia"]+`)`+desde+c.Donde(),
		c.Args()...).Scan(&k.Todas, &k.SinPrecio, &k.ParaRevisar, &k.AlDia); err != nil {
		return out, err
	}
	out.Total = map[string]int{"sin-precio": k.SinPrecio, "para-revisar": k.ParaRevisar, "al-dia": k.AlDia}[f.Estado]
	if cond, ok := estados[f.Estado]; ok {
		c.Y(cond)
	} else {
		out.Total = k.Todas
	}
	pagina := ""
	if paginar {
		limite, salto := f.Pagina(PorPaginaPrecios)
		pagina = ` LIMIT ` + c.Arg(limite) + ` OFFSET ` + c.Arg(salto)
	}
	// «viejo» va también en la lista de columnas: así la consulta usa todos
	// los argumentos aunque no haya estado elegido.
	filas, err := s.pool.Query(ctx, `
		SELECT v.id, p.id, v.sku, p.name, v.label, c.name, c.slug, p.unit::text, coalesce(`+viejo+`, false)
		`+desde+c.Donde()+`
		ORDER BY c.sort_order, p.name, v.sort_order, v.id`+pagina, c.Args()...)
	if err != nil {
		return out, err
	}
	leidas, err := pgx.CollectRows(filas, func(r pgx.CollectableRow) (FilaPrecio, error) {
		var f FilaPrecio
		err := r.Scan(&f.VariantID, &f.ProductID, &f.SKU, &f.Producto, &f.Medida, &f.Categoria, &f.CategoriaSlug, &f.Unidad, &f.Desactualizado)
		return f, err
	})
	if err != nil || len(leidas) == 0 {
		return out, err
	}
	out.Filas, err = s.completar(ctx, ls, leidas)
	return out, err
}

// ListarTodo es la grilla entera, sin páginas, para exportarla: la planilla y
// el PDF de la lista llevan todo lo que coincide con los filtros de la
// pantalla. Va en una sola consulta: de a páginas con OFFSET, una medida
// cargada en medio de la exportación corría las filas y una salía dos veces o
// faltaba.
func (s *Servicio) ListarTodo(ctx context.Context, f listado.Filtros, ahora time.Time) ([]FilaPrecio, error) {
	g, err := s.grilla(ctx, f, ahora, false)
	if err != nil {
		return nil, err
	}
	return g.Filas, nil
}

// completar suma a las filas de la página la foto, los precios de las dos
// listas, la brecha y cuándo se tocó por última vez.
func (s *Servicio) completar(ctx context.Context, ls listas, out []FilaPrecio) ([]FilaPrecio, error) {
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
	pisos, err := PisosDeCosto(ctx, s.pool, variantes)
	if err != nil {
		return nil, err
	}
	buscar := func(v string, l *sqlc.PriceList) string {
		if l != nil {
			if x, ok := precio[precioDe{v, l.ID}]; ok {
				return x
			}
		}
		return "0"
	}
	for i := range out {
		f := &out[i]
		if u, ok := portada[f.ProductID]; ok {
			f.Imagen = &u
		}
		f.PrecioGeneral, f.PrecioProfesional = buscar(f.VariantID, ls.general), buscar(f.VariantID, ls.profesional)
		g, p := jsmath.Numero(f.PrecioGeneral), jsmath.Numero(f.PrecioProfesional)
		f.Brecha = Brecha(g, p)
		if piso, ok := pisos[f.VariantID]; ok {
			f.Piso = &piso
		}
		if u, ok := ultima[f.VariantID]; ok {
			f.Actualizado = &u
		}
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
	// Mayor que cero, como la importación (comité final, M11 y decisión 4):
	// no hay productos a $0, y con la lista en 0 vender a $0 no se medía
	// como bajo la lista ni pedía el PIN.
	if !(n > 0) || n != n || n > 1e300 {
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
	// Proveedor (su id) y Marca acotan a lo que trae un proveedor o a una
	// marca: el aumento llega así, no por rubro.
	Proveedor, Marca string
}

// ResultadoDeAjuste es cuántos precios cambiaron y cuántos no tenían costo.
type ResultadoDeAjuste struct{ Tocados, SinCosto int }

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// planDeAjuste es lo que el ajuste cambiaría, lista por lista.
type planDeAjuste struct {
	porcentaje float64
	motivo     string
	texto      string
	listas     []sqlc.PriceList
	cambios    []cambiosEnLote
	r          ResultadoDeAjuste
}

// planear valida el pedido y calcula los precios nuevos sin escribir nada.
// Lo usan el ajuste y su vista previa: la vista previa no puede mentir.
func (s *Servicio) planear(ctx context.Context, q *sqlc.Queries, p PedidoDeAjuste) (*planDeAjuste, error) {
	porcentaje, e := PorcentajeDeAjuste(p.Porcentaje)
	if e != "" {
		return nil, plataforma.Invalido(map[string]string{"porcentaje": e})
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
		return nil, plataforma.Invalido(map[string]string{"listaSlug": `Invalid option: expected one of "ambas"|"general"|"profesional"`})
	case p.Base != "precio" && p.Base != "costo" && p.Base != "costo_elaborado":
		return nil, plataforma.Invalido(map[string]string{"base": `Invalid option: expected one of "precio"|"costo"|"costo_elaborado"`})
	case p.Redondeo != "ninguno" && p.Redondeo != "decena" && p.Redondeo != "centena" && p.Redondeo != "mil":
		return nil, plataforma.Invalido(map[string]string{"redondeo": `Invalid option: expected one of "ninguno"|"decena"|"centena"|"mil"`})
	case p.Proveedor != "" && p.Proveedor != "todos" && !plataforma.UUIDValido(p.Proveedor):
		return nil, plataforma.Invalido(map[string]string{"proveedor": "Elegí un proveedor de la lista."})
	}
	motivo := strings.TrimSpace(p.Motivo)
	if plataforma.LargoJS(motivo) > 200 {
		return nil, plataforma.Invalido(map[string]string{"motivo": "Too big: expected string to have <=200 characters"})
	}
	factor := Factor(porcentaje)
	plan := &planDeAjuste{porcentaje: porcentaje, motivo: motivo}

	_, todas, err := s.listas(ctx, q)
	if err != nil {
		return nil, err
	}
	for _, l := range todas {
		if p.ListaSlug == "ambas" || (p.ListaSlug == "general" && l.IsDefault) || (p.ListaSlug == "profesional" && l.Slug == "profesional") {
			plan.listas = append(plan.listas, l)
		}
	}
	filtro := func(v string) *string {
		v = strings.TrimSpace(v)
		if v == "" || v == "todos" {
			return nil
		}
		return &v
	}
	variantes, err := q.VariantesParaAjuste(ctx, sqlc.VariantesParaAjusteParams{Categoria: filtro(p.Categoria), Rubro: filtro(p.Rubro),
		Proveedor: filtro(p.Proveedor), Marca: filtro(p.Marca)})
	if err != nil {
		return nil, err
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
	if motivo != "" {
		plan.texto = motivo
	} else if p.Base == "precio" {
		sentido := "Baja"
		if porcentaje > 0 {
			sentido = "Aumento"
		}
		plan.texto = sentido + " del " + jsmath.Texto(abs(porcentaje)) + "%"
	} else {
		con := ""
		if p.Base == "costo_elaborado" {
			con = " con elaboración"
		}
		plan.texto = "Recalculado desde el costo" + con + " + " + jsmath.Texto(porcentaje) + "% de margen"
	}
	for _, l := range plan.listas {
		var c cambiosEnLote
		if len(ids) > 0 {
			actuales, err := q.PreciosDeLista(ctx, sqlc.PreciosDeListaParams{PriceListID: l.ID, Ids: ids})
			if err != nil {
				return nil, err
			}
			for _, a := range actuales {
				var base float64
				if p.Base == "precio" {
					base = jsmath.Numero(a.Price)
					if !(base > 0) {
						continue
					}
				} else if b, ok := desdeCosto[a.VariantID]; ok && b != 0 {
					base = b
				} else {
					plan.r.SinCosto++
					continue
				}
				nuevo := jsmath.Fijo2(Ajustar(base, factor, p.Redondeo))
				if jsmath.Numero(a.Price) == jsmath.Numero(nuevo) {
					continue
				}
				c.variantes = append(c.variantes, a.VariantID)
				c.anteriores = append(c.anteriores, a.Price)
				c.nuevos = append(c.nuevos, nuevo)
			}
		}
		plan.cambios = append(plan.cambios, c)
		plan.r.Tocados += len(c.variantes)
	}
	return plan, nil
}

// FilaDeMuestra es un precio de la vista previa: antes y después.
type FilaDeMuestra struct {
	Producto string `json:"producto"`
	Medida   string `json:"medida"`
	Lista    string `json:"lista"`
	Antes    string `json:"antes"`
	Despues  string `json:"despues"`
}

// VistaDeAjuste es cuántos precios tocaría el ajuste y una muestra.
type VistaDeAjuste struct {
	Tocados  int             `json:"tocados"`
	SinCosto int             `json:"sinCosto"`
	Muestra  []FilaDeMuestra `json:"muestra"`
}

// Previsualizar es el ajuste sin escribir: antes, el diálogo mostraba un
// ejemplo con $100.000 y no decía a cuántos productos les iba a cambiar el
// precio.
func (s *Servicio) Previsualizar(ctx context.Context, p PedidoDeAjuste) (VistaDeAjuste, error) {
	plan, err := s.planear(ctx, s.q, p)
	if err != nil {
		return VistaDeAjuste{}, err
	}
	v := VistaDeAjuste{Tocados: plan.r.Tocados, SinCosto: plan.r.SinCosto, Muestra: []FilaDeMuestra{}}
	for k, c := range plan.cambios {
		for i := range c.variantes {
			if len(v.Muestra) >= 8 {
				break
			}
			f := FilaDeMuestra{Lista: plan.listas[k].Name, Antes: c.anteriores[i], Despues: c.nuevos[i]}
			_ = s.pool.QueryRow(ctx, `SELECT p.name, v.label FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
				c.variantes[i]).Scan(&f.Producto, &f.Medida)
			v.Muestra = append(v.Muestra, f)
		}
	}
	slices.SortFunc(v.Muestra, func(a, b FilaDeMuestra) int {
		return strings.Compare(a.Producto+" "+a.Medida+" "+a.Lista, b.Producto+" "+b.Medida+" "+b.Lista)
	})
	return v, nil
}

// Ajustar es ajustarPrecios: un porcentaje sobre el precio (o sobre el
// costo, con o sin elaboración) de las medidas activas de una categoría,
// rubro, proveedor o marca, en una o las dos listas, con redondeo opcional,
// en un lote del historial.
func (s *Servicio) Ajustar(ctx context.Context, ses *auth.Sesion, p PedidoDeAjuste) (string, error) {
	lote := uuid()
	var plan *planDeAjuste
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		var err error
		if plan, err = s.planear(ctx, q, p); err != nil {
			return err
		}
		for k, c := range plan.cambios {
			if err := c.aplicar(ctx, tx, plan.listas[k].ID, ses.UserID, plan.texto, lote); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	r, porcentaje, motivo := plan.r, plan.porcentaje, plan.motivo
	signo, desdeCostoTexto := "", ""
	if porcentaje > 0 {
		signo = "+"
	}
	if p.Base != "" && p.Base != "precio" {
		desdeCostoTexto = " (desde costo)"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "precio", "",
		"Ajuste masivo del "+signo+jsmath.Texto(porcentaje)+"% sobre "+strconv.Itoa(r.Tocados)+" precio"+plural(r.Tocados)+desdeCostoTexto,
		sinVacios(map[string]any{"porcentaje": porcentaje, "categoria": p.Categoria, "rubro": p.Rubro, "listaSlug": p.ListaSlug,
			"base": p.Base, "redondeo": p.Redondeo, "motivo": motivo, "proveedor": p.Proveedor, "marca": p.Marca, "loteId": lote,
			"tocados": r.Tocados, "sinCosto": r.SinCosto}))
	if r.Tocados == 0 {
		if p.Base == "" || p.Base == "precio" {
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

// UltimoAjuste es el lote del último ajuste masivo, con cuántos de sus
// precios siguen como los dejó (los que se pueden deshacer).
type UltimoAjuste struct {
	LoteID      string    `json:"loteId"`
	Cuando      time.Time `json:"cuando"`
	Motivo      *string   `json:"motivo"`
	Precios     int       `json:"precios"`
	Deshacibles int       `json:"deshacibles"`
}

const consultaUltimoAjuste = `
	WITH ultimo AS (
	  SELECT lote_id FROM price_history WHERE origen = 'ajuste_masivo' AND lote_id IS NOT NULL
	  ORDER BY created_at DESC LIMIT 1
	)
	SELECT h.lote_id::text, min(h.created_at), min(h.motivo), count(*)::int,
	       count(*) FILTER (WHERE i.price = h.precio_nuevo)::int
	FROM price_history h
	JOIN ultimo u ON u.lote_id = h.lote_id
	LEFT JOIN price_list_items i ON i.variant_id = h.variant_id AND i.price_list_id = h.price_list_id
	GROUP BY h.lote_id`

func (s *Servicio) Ultimo(ctx context.Context) (*UltimoAjuste, error) {
	var u UltimoAjuste
	err := s.pool.QueryRow(ctx, consultaUltimoAjuste).Scan(&u.LoteID, &u.Cuando, &u.Motivo, &u.Precios, &u.Deshacibles)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// DeshacerUltimo vuelve al precio anterior lo que cambió el último ajuste
// masivo, salvo lo que alguien tocó después: un precio corregido a mano no
// se pisa. Queda en el historial como otro ajuste.
func (s *Servicio) DeshacerUltimo(ctx context.Context, ses *auth.Sesion) (string, error) {
	nuevoLote := uuid()
	var vueltos int
	var motivo *string
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		var lote string
		err := tx.QueryRow(ctx, `SELECT lote_id::text, motivo FROM price_history WHERE origen = 'ajuste_masivo' AND lote_id IS NOT NULL
			ORDER BY created_at DESC LIMIT 1`).Scan(&lote, &motivo)
		if errors.Is(err, pgx.ErrNoRows) {
			return plataforma.Invalido(map[string]string{"lote": "No hay ningún ajuste para deshacer."})
		}
		if err != nil {
			return err
		}
		texto := "Se deshizo el ajuste"
		if motivo != nil && *motivo != "" {
			texto += " «" + *motivo + "»"
		}
		return tx.QueryRow(ctx, `
			WITH volver AS (
			  SELECT h.variant_id, h.price_list_id, h.precio_nuevo AS ahora, h.precio_anterior AS antes
			  FROM price_history h
			  JOIN price_list_items i ON i.variant_id = h.variant_id AND i.price_list_id = h.price_list_id AND i.price = h.precio_nuevo
			  WHERE h.lote_id = $1::uuid AND h.precio_anterior IS NOT NULL
			  FOR UPDATE OF i
			), cambio AS (
			  UPDATE price_list_items i SET price = v.antes, updated_at = now()
			  FROM volver v WHERE i.variant_id = v.variant_id AND i.price_list_id = v.price_list_id
			  RETURNING 1
			), anotado AS (
			  INSERT INTO price_history (variant_id, price_list_id, precio_anterior, precio_nuevo, origen, motivo, lote_id, created_by_user_id)
			  SELECT variant_id, price_list_id, ahora, antes, 'manual', $2, $3::uuid, $4 FROM volver
			  RETURNING 1
			)
			SELECT count(*)::int FROM cambio`, lote, texto, nuevoLote, ses.UserID).Scan(&vueltos)
	})
	if err != nil {
		return "", err
	}
	if vueltos == 0 {
		return "", plataforma.Invalido(map[string]string{"lote": "Ese ajuste ya se deshizo, o todos sus precios se cambiaron después."})
	}
	volvio := " volvió al anterior"
	if vueltos != 1 {
		volvio = " volvieron al anterior"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "precio", "",
		"Deshizo el último ajuste masivo: "+strconv.Itoa(vueltos)+" precio"+plural(vueltos)+volvio, nil)
	return strconv.Itoa(vueltos) + " precio" + plural(vueltos) + volvio + ".", nil
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

// cambiosEnLote son los precios de una lista que cambian en un ajuste
// masivo: se escriben con dos consultas (los precios y su historial) en vez
// de tres por precio. Con 6400 precios eran 20–45 segundos.
type cambiosEnLote struct{ variantes, anteriores, nuevos []string }

// A mano: sqlc no entiende el unnest de varios arreglos.
const (
	fijarPreciosEnLote = `
		UPDATE price_list_items p SET price = x.nuevo::numeric, updated_at = now()
		FROM unnest($2::uuid[], $3::text[]) AS x(variante, nuevo)
		WHERE p.price_list_id = $1 AND p.variant_id = x.variante`
	anotarPreciosEnLote = `
		INSERT INTO price_history (variant_id, price_list_id, precio_anterior, precio_nuevo, origen, motivo, lote_id, created_by_user_id)
		SELECT x.variante, $1, x.anterior::numeric, x.nuevo::numeric, 'ajuste_masivo', $5, $6, $7
		FROM unnest($2::uuid[], $3::text[], $4::text[]) AS x(variante, anterior, nuevo)`
)

func (c cambiosEnLote) aplicar(ctx context.Context, tx pgx.Tx, lista, usuario, motivo, lote string) error {
	if len(c.variantes) == 0 {
		return nil
	}
	if _, err := tx.Exec(ctx, fijarPreciosEnLote, lista, c.variantes, c.nuevos); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, anotarPreciosEnLote, lista, c.variantes, c.anteriores, c.nuevos, motivo, lote, usuario)
	return err
}

package catalogo

import (
	"context"
	"net/http"

	"mjbj/internal/auth"
	"mjbj/internal/plataforma"
	"mjbj/internal/reglas"
)

// Tienda son los dos interruptores del sitio (migración 00093).
//
// La primera entrega va sin tienda: la clienta tiene que cargar el
// inventario antes de vender en línea. **Apagada, el filtro lo hace la API y
// no la pantalla**: un precio escondido con CSS o con un `if` en el JSX igual
// viaja en el HTML y en el JSON, y con la caché de Next de por medio queda
// servido a cualquiera. Acá no sale.
//
// El panel y el mostrador no pasan por acá: usan los servicios, no las rutas
// públicas, y siguen viendo sus precios.
type Tienda struct {
	// Activa: precios, carrito y compra en el sitio.
	Activa bool `json:"activa"`
	// StockVisible: la disponibilidad en el sitio. El stock no es un dato
	// sensible como el precio, así que lo esconde la pantalla.
	StockVisible bool `json:"stockVisible"`
}

// Tienda lee los interruptores. Una fila que no existe cuenta como encendida:
// es lo que hacía el sitio antes de que existieran.
func (s *Servicio) Tienda(ctx context.Context) (Tienda, error) {
	t := Tienda{Activa: true, StockVisible: true}
	filas, err := s.q.AjustesDeLaTienda(ctx)
	if err != nil {
		return t, err
	}
	for _, f := range filas {
		switch f.Clave {
		case "tienda_activa":
			t.Activa = f.Valor == "si"
		case "stock_visible":
			t.StockVisible = f.Valor == "si"
		}
	}
	return t, nil
}

// ErrTiendaApagada es la respuesta de todo lo que vende con la tienda
// apagada. El sitio no muestra esos botones; esto es para quien llama a la
// API por su cuenta.
var ErrTiendaApagada = plataforma.NuevoProblema(http.StatusForbidden,
	"Por ahora no vendemos por la web: escribinos por WhatsApp y te pasamos precio y disponibilidad.")

// ExigirTienda corta con ErrTiendaApagada si la tienda está apagada.
func (s *Servicio) ExigirTienda(ctx context.Context) error {
	t, err := s.Tienda(ctx)
	if err != nil {
		return err
	}
	if !t.Activa {
		return ErrTiendaApagada
	}
	return nil
}

// PreciosDelProfesional dice si, con la tienda apagada, la lista l igual
// muestra sus precios: la regla «precios_profesional_sin_tienda» en «si»
// (H086), una lista propia (nunca la general: esa es la del público) que
// tiene al menos un profesional aprobado, y, si el pedido trae sesión, que
// quien pide sea ese profesional. El pedido interno de Next con lista=<id>
// llega sin sesión: Next la eligió de la sesión de quien mira, y la caché
// por lista solo la comparten los de esa lista.
//
// Comprar sigue sin poderse: el carrito y el checkout usan ExigirTienda.
func (s *Servicio) PreciosDelProfesional(ctx context.Context, ses *auth.Sesion, l Lista) (bool, error) {
	if !l.EsDiferenciada || l.ID == nil {
		return false, nil
	}
	v, err := reglas.Valor(ctx, s.pool, reglas.PreciosProfesionalSinTienda)
	if err != nil || v != "si" {
		return false, err
	}
	if ses != nil && !ses.EsStaff() {
		pro, err := s.q.EsProfesionalAprobado(ctx, &ses.UserID)
		if err != nil || !pro {
			return false, err
		}
	}
	var deProfesional bool
	err = s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM customers
		WHERE price_list_id = $1 AND active AND tipo = 'profesional' AND estado <> 'inactivo')`, *l.ID).Scan(&deProfesional)
	return deProfesional, err
}

// ExigirTiendaPara es ExigirTienda, salvo para el profesional con su lista
// cuando la regla lo deja (PreciosDelProfesional): la lista de precios en
// PDF.
func (s *Servicio) ExigirTiendaPara(ctx context.Context, ses *auth.Sesion, l Lista) error {
	t, err := s.Tienda(ctx)
	if err != nil || t.Activa {
		return err
	}
	pro, err := s.PreciosDelProfesional(ctx, ses, l)
	if err != nil {
		return err
	}
	if !pro {
		return ErrTiendaApagada
	}
	return nil
}

// SinPrecio deja una tarjeta sin precio, como la de un producto que se cotiza.
func SinPrecio(p *ProductoListado) {
	p.PrecioDesde, p.PrecioAnterior, p.Descuento = nil, nil, nil
}

// SinPrecios es SinPrecio sobre una lista.
func SinPrecios(ps []ProductoListado) {
	for i := range ps {
		SinPrecio(&ps[i])
	}
}

// FichaSinPrecios deja la ficha sin el precio de ninguna medida.
func FichaSinPrecios(p *ProductoDetalle) {
	for i := range p.Variantes {
		p.Variantes[i].Precio = nil
	}
}

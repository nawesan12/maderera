package catalogo

import (
	"context"
	"net/http"

	"mjbj/internal/plataforma"
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

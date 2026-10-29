package correo

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/plataforma"
	"mjbj/internal/sqlc"
)

// El correo conectado con el ERP: la ficha del remitente al costado (2a),
// quién es cliente en la lista, sugerir clientes al escribir.
//
// **La base es opcional.** El webmail no depende de ella (la sesión va en
// una cookie, el correo en el IMAP): sin DATABASE_URL, o con la base caída,
// estas funciones simplemente no aparecen. Por eso el pool se abre sin
// probarlo y cada consulta tiene un tope corto: una base que no responde no
// puede dejar colgada la bandeja.
//
// **Solo para staff.** La ficha muestra saldos: solo la ven las casillas
// que son de una persona de staff del panel con rol admin o vendedor (el
// mismo correo en "user" y su perfil). Cualquier otra casilla —un cliente
// con su correo en el mismo servidor, info@ si no es de nadie— nunca recibe
// datos.

// ConfigERP es lo que el comando `correo` lee para conectarse al ERP. Todo
// opcional.
type ConfigERP struct {
	Base string `env:"DATABASE_URL"`
	SSL  string `env:"DATABASE_SSL"`
	// La dirección del sitio (https://mjbj.com.ar): «Volver al panel» y los
	// enlaces de la ficha van ahí.
	Panel string `env:"CORREO_PANEL"`
}

// Lo que tarda como mucho una consulta antes de darse por perdida.
const topeERP = 3 * time.Second

// Cuánto se recuerda si una casilla es de staff.
const vidaRol = 5 * time.Minute

// ERP es la conexión de lectura a la base.
type ERP struct {
	pool  *pgxpool.Pool
	q     *sqlc.Queries
	panel string
	log   *slog.Logger

	mu    sync.Mutex
	roles map[string]rolCasilla
}

type rolCasilla struct {
	rol, usuario, nombre string
	hasta                time.Time
}

// AbrirERP abre el pool sin probarlo: si la base no está ahora, puede estar
// en un rato. Nil sin DATABASE_URL.
func AbrirERP(cfg ConfigERP, log *slog.Logger) (*ERP, error) {
	if cfg.Base == "" {
		return nil, nil
	}
	u, err := plataforma.ConfigBase{URL: cfg.Base, SSL: cfg.SSL}.URLConexion()
	if err != nil {
		return nil, err
	}
	pc, err := pgxpool.ParseConfig(u)
	if err != nil {
		return nil, err
	}
	pc.MaxConns = 4
	pc.MaxConnIdleTime = 30 * time.Second
	pc.ConnConfig.ConnectTimeout = topeERP
	pool, err := pgxpool.NewWithConfig(context.Background(), pc)
	if err != nil {
		return nil, err
	}
	return NuevoERP(pool, cfg.Panel, log), nil
}

// NuevoERP arma el ERP sobre un pool ya abierto (las pruebas usan el suyo).
func NuevoERP(pool *pgxpool.Pool, panel string, log *slog.Logger) *ERP {
	return &ERP{pool: pool, q: sqlc.New(pool), panel: strings.TrimRight(panel, "/"), log: log, roles: map[string]rolCasilla{}}
}

// Cerrar cierra el pool.
func (e *ERP) Cerrar() {
	if e != nil && e.pool != nil {
		e.pool.Close()
	}
}

// Staff dice si la casilla es de una persona de staff y con qué rol. Si la
// base no responde, no es (y no se recuerda: se vuelve a preguntar).
func (e *ERP) Staff(ctx context.Context, casilla string) (rol, usuario, nombre string) {
	if e == nil {
		return "", "", ""
	}
	casilla = strings.ToLower(casilla)
	e.mu.Lock()
	r, ok := e.roles[casilla]
	e.mu.Unlock()
	if ok && time.Now().Before(r.hasta) {
		return r.rol, r.usuario, r.nombre
	}
	ctx, cancelar := context.WithTimeout(ctx, topeERP)
	defer cancelar()
	fila, err := e.q.RolDeCasilla(ctx, casilla)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		e.log.Warn("correo: el ERP no responde", "error", err)
		return "", "", ""
	}
	r = rolCasilla{rol: fila.Rol, usuario: fila.Usuario, nombre: fila.Nombre, hasta: time.Now().Add(vidaRol)}
	e.mu.Lock()
	e.roles[casilla] = r
	e.mu.Unlock()
	return r.rol, r.usuario, r.nombre
}

// VeFichas dice si la casilla puede ver las fichas de clientes.
func (e *ERP) VeFichas(ctx context.Context, casilla string) bool {
	rol, _, _ := e.Staff(ctx, casilla)
	return rol == "admin" || rol == "vendedor"
}

// Panel es la dirección del panel, o vacío si no está configurada.
func (e *ERP) Panel() string {
	if e == nil {
		return ""
	}
	return e.panel
}

func (e *ERP) enlace(ruta string, q url.Values) string {
	if len(q) > 0 {
		ruta += "?" + q.Encode()
	}
	return e.panel + ruta
}

// Ficha es lo que se muestra del remitente cuando es cliente.
type Ficha struct {
	ID                string            `json:"id"`
	Nombre            string            `json:"nombre"`
	RazonSocial       string            `json:"razonSocial,omitempty"`
	CUIT              string            `json:"cuit,omitempty"`
	Profesional       bool              `json:"profesional"`
	Estado            string            `json:"estado"`
	Saldo             float64           `json:"saldo"`
	LimiteCredito     float64           `json:"limiteCredito"`
	DiasCredito       int32             `json:"diasCredito"`
	CuentaBloqueada   bool              `json:"cuentaBloqueada"`
	MotivoBloqueo     string            `json:"motivoBloqueo,omitempty"`
	Pedidos           []PedidoFicha     `json:"pedidos"`
	Cheques           []ChequeFicha     `json:"cheques"`
	UltimoPresupuesto *PresupuestoFicha `json:"ultimoPresupuesto,omitempty"`
	// Avisos son lo que conviene saber antes de contestarle: un remito sin
	// firmar, un pedido listo, un cheque que vence.
	Avisos  []AvisoFicha      `json:"avisos"`
	Enlaces map[string]string `json:"enlaces"`
}

// AvisoFicha es un aviso de contexto para la conversación.
type AvisoFicha struct {
	Texto   string `json:"texto"`
	Familia string `json:"familia"` // esp, ok, inf, pr (los colores de estado)
	Enlace  string `json:"enlace,omitempty"`
}

type PedidoFicha struct {
	ID     string    `json:"id"`
	Numero string    `json:"numero"`
	Estado string    `json:"estado"`
	Total  float64   `json:"total"`
	Fecha  time.Time `json:"fecha"`
	Enlace string    `json:"enlace"`
}

type ChequeFicha struct {
	ID        string    `json:"id"`
	Numero    string    `json:"numero"`
	Banco     string    `json:"banco,omitempty"`
	FechaPago time.Time `json:"fechaPago"`
	Importe   float64   `json:"importe"`
	Estado    string    `json:"estado"`
}

type PresupuestoFicha struct {
	ID          string     `json:"id"`
	Numero      string     `json:"numero"`
	Estado      string     `json:"estado"`
	Total       float64    `json:"total"`
	Fecha       time.Time  `json:"fecha"`
	ValidoHasta *time.Time `json:"validoHasta,omitempty"`
	Enlace      string     `json:"enlace"`
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ErrSinFicha es un remitente que no es cliente (o una casilla que no la
// puede ver: para afuera es lo mismo).
var ErrSinFicha = errors.New("sin ficha")

// FichaDe arma la ficha del cliente con ese correo.
func (e *ERP) FichaDe(ctx context.Context, correo string) (*Ficha, error) {
	ctx, cancelar := context.WithTimeout(ctx, topeERP)
	defer cancelar()
	c, err := e.q.FichaPorCorreo(ctx, strings.ToLower(strings.TrimSpace(correo)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSinFicha
	}
	if err != nil {
		return nil, err
	}
	f := &Ficha{
		ID: c.ID, Nombre: c.Nombre, RazonSocial: texto(c.RazonSocial), CUIT: texto(c.Cuit),
		Profesional: c.Tipo == "profesional", Estado: c.Estado, Saldo: c.Saldo.F(),
		LimiteCredito: c.LimiteCredito.F(), DiasCredito: c.DiasCredito,
		CuentaBloqueada: c.CuentaBloqueada, MotivoBloqueo: texto(c.MotivoBloqueo),
		Pedidos: []PedidoFicha{}, Cheques: []ChequeFicha{}, Avisos: []AvisoFicha{},
	}
	pedidos, err := e.q.PedidosAbiertosDeCliente(ctx, &c.ID)
	if err != nil {
		return nil, err
	}
	for _, p := range pedidos {
		f.Pedidos = append(f.Pedidos, PedidoFicha{ID: p.ID, Numero: p.Numero, Estado: p.Estado, Total: p.Total.F(), Fecha: p.CreatedAt, Enlace: e.enlace("/admin/pedidos/"+p.ID, nil)})
	}
	cheques, err := e.q.ChequesPorVencerDeCliente(ctx, &c.ID)
	if err != nil {
		return nil, err
	}
	for _, ch := range cheques {
		f.Cheques = append(f.Cheques, ChequeFicha{ID: ch.ID, Numero: ch.Numero, Banco: texto(ch.Banco), FechaPago: ch.FechaPago, Importe: ch.Importe.F(), Estado: ch.Estado})
	}
	q, err := e.q.UltimoPresupuestoDeCliente(ctx, &c.ID)
	if err == nil {
		f.UltimoPresupuesto = &PresupuestoFicha{ID: q.ID, Numero: q.Numero, Estado: q.Estado, Total: q.Total.F(), Fecha: q.CreatedAt, ValidoHasta: q.ValidoHasta, Enlace: e.enlace("/admin/presupuestos/"+q.ID, nil)}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	remitos, err := e.q.RemitosDeCliente(ctx, &c.ID)
	if err != nil {
		return nil, err
	}
	f.Avisos = avisosDe(f, remitos, time.Now())
	cliente := url.Values{"cliente": {c.ID}}
	f.Enlaces = map[string]string{
		"ficha":       e.enlace("/admin/clientes/"+c.ID, nil),
		"presupuesto": e.enlace("/admin/presupuestos/nuevo", cliente),
		// El panel no tiene «pedido nuevo para este cliente»: los pedidos
		// nacen en el mostrador o de un presupuesto. Va al mostrador.
		"pedido":  e.enlace("/mostrador", nil),
		"pedidos": e.enlace("/admin/clientes/"+c.ID, nil),
		"cheques": e.enlace("/admin/cheques", nil),
	}
	return f, nil
}

// Remitentes dice, de los correos dados, cuáles son clientes y cuáles
// proveedores.
type Remitentes struct {
	Clientes    []string `json:"clientes"`
	Proveedores []string `json:"proveedores"`
}

// Remitentes busca los correos entre los clientes y los proveedores activos.
func (e *ERP) Remitentes(ctx context.Context, correos []string) (Remitentes, error) {
	ctx, cancelar := context.WithTimeout(ctx, topeERP)
	defer cancelar()
	var r Remitentes
	var err error
	if r.Clientes, err = e.q.ClientesEntreCorreos(ctx, correos); err != nil {
		return r, err
	}
	r.Proveedores, err = e.q.ProveedoresEntreCorreos(ctx, correos)
	return r, err
}

// Contacto es un cliente para sugerir en «Para».
type Contacto struct {
	Nombre string `json:"nombre"`
	Correo string `json:"correo"`
}

// Contactos busca clientes con correo por nombre, razón social o correo.
func (e *ERP) Contactos(ctx context.Context, q string) ([]Contacto, error) {
	ctx, cancelar := context.WithTimeout(ctx, topeERP)
	defer cancelar()
	filas, err := e.q.BuscarClientesConCorreo(ctx, q)
	if err != nil {
		return nil, err
	}
	out := make([]Contacto, 0, len(filas))
	for _, f := range filas {
		out = append(out, Contacto{Nombre: f.Nombre, Correo: f.Correo})
	}
	return out, nil
}

// avisosDe arma los avisos de contexto de la ficha: lo que el que contesta
// tiene que saber («tiene un remito sin firmar», «su pedido está listo»).
func avisosDe(f *Ficha, remitos []sqlc.RemitosDeClienteRow, ahora time.Time) []AvisoFicha {
	out := []AvisoFicha{}
	numero := func(n string) string { return strings.TrimPrefix(n, "PED-") }
	for _, r := range remitos {
		if r.Estado == "entregada" {
			out = append(out, AvisoFicha{Texto: "Tiene el remito " + r.Numero + " (pedido " + numero(r.Pedido) + ") entregado sin firmar.", Familia: "esp"})
		} else if r.Tipo == "retiro" {
			out = append(out, AvisoFicha{Texto: "El remito " + r.Numero + " (pedido " + numero(r.Pedido) + ") está preparado: espera que lo retire.", Familia: "inf"})
		}
	}
	for _, p := range f.Pedidos {
		switch p.Estado {
		case "listo":
			out = append(out, AvisoFicha{Texto: "Su pedido " + numero(p.Numero) + " está listo para retirar.", Familia: "ok", Enlace: p.Enlace})
		case "en-camino":
			out = append(out, AvisoFicha{Texto: "Su pedido " + numero(p.Numero) + " está en camino.", Familia: "inf", Enlace: p.Enlace})
		}
	}
	hoy := time.Date(ahora.Year(), ahora.Month(), ahora.Day(), 0, 0, 0, 0, ahora.Location())
	for _, ch := range f.Cheques {
		dias := int(ch.FechaPago.In(ahora.Location()).Sub(hoy).Hours() / 24)
		switch {
		case dias < 0:
			out = append(out, AvisoFicha{Texto: "Tiene un cheque de " + pesosAR(ch.Importe) + " vencido sin depositar.", Familia: "pr"})
		case dias <= 3:
			cuando := "en " + strconv.Itoa(dias) + " días"
			if dias == 0 {
				cuando = "hoy"
			} else if dias == 1 {
				cuando = "mañana"
			}
			out = append(out, AvisoFicha{Texto: "Un cheque suyo de " + pesosAR(ch.Importe) + " vence " + cuando + ".", Familia: "esp"})
		}
	}
	if p := f.UltimoPresupuesto; p != nil && p.Estado == "enviado" && p.ValidoHasta != nil {
		if dias := int(p.ValidoHasta.Sub(hoy).Hours() / 24); dias >= 0 && dias <= 5 {
			out = append(out, AvisoFicha{Texto: "Su presupuesto " + p.Numero + " vence en " + strconv.Itoa(dias) + " días y no lo contestó.", Familia: "esp", Enlace: p.Enlace})
		}
	}
	if f.CuentaBloqueada {
		texto := "La cuenta corriente está bloqueada."
		if f.MotivoBloqueo != "" {
			texto = "La cuenta corriente está bloqueada: " + f.MotivoBloqueo + "."
		}
		out = append(out, AvisoFicha{Texto: texto, Familia: "pr"})
	} else if f.LimiteCredito > 0 && f.Saldo > f.LimiteCredito {
		out = append(out, AvisoFicha{Texto: "Debe " + pesosAR(f.Saldo) + ": pasó el límite de " + pesosAR(f.LimiteCredito) + ".", Familia: "pr"})
	}
	return out
}

var (
	reNumeroPedido      = regexp.MustCompile(`(?i)^(?:ped-?|pedido\s*)?(\d{3,7})$`)
	reNumeroPresupuesto = regexp.MustCompile(`(?i)^p-?(\d{4})-?(\d{1,4})$`)
	reSoloCUIT          = regexp.MustCompile(`^\d{2}-?\d{8}-?\d$`)
)

// CorreosDeBusqueda traduce una búsqueda a las direcciones de los clientes
// que nombra: por nombre, CUIT, número de pedido (4836, PED-4836) o de
// presupuesto (P-2026-0412). Solo para staff que ve fichas; si la base no
// responde, nada (la búsqueda por texto sigue igual).
func (e *ERP) CorreosDeBusqueda(ctx context.Context, casilla, q string) []string {
	if !e.VeFichas(ctx, casilla) {
		return nil
	}
	q = strings.TrimSpace(q)
	p := sqlc.CorreosParaBuscarParams{}
	switch {
	case reSoloCUIT.MatchString(q):
		p.Cuit = strings.ReplaceAll(q, "-", "")
	case reNumeroPedido.MatchString(q):
		p.Pedido = "PED-" + reNumeroPedido.FindStringSubmatch(q)[1]
	case reNumeroPresupuesto.MatchString(q):
		m := reNumeroPresupuesto.FindStringSubmatch(q)
		n, _ := strconv.Atoi(m[2])
		p.Presupuesto = fmt.Sprintf("P-%s-%04d", m[1], n)
	default:
		p.Nombre = q
	}
	ctx, cancelar := context.WithTimeout(ctx, topeERP)
	defer cancelar()
	correos, err := e.q.CorreosParaBuscar(ctx, p)
	if err != nil {
		e.log.Warn("correo: buscando clientes", "error", err)
		return nil
	}
	return correos
}

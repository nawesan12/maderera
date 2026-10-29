package clientes

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/bitacora"
	"mjbj/internal/cuit"
	"mjbj/internal/jsmath"
	"mjbj/internal/plataforma"
	"mjbj/internal/precios"
	"mjbj/internal/sqlc"
)

// Servicio son las acciones de clientes del panel.
type Servicio struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
	log  *slog.Logger
}

// Nuevo arma el servicio.
func Nuevo(pool *pgxpool.Pool, log *slog.Logger) *Servicio {
	return &Servicio{pool: pool, q: sqlc.New(pool), log: log}
}

var argentina = func() *time.Location {
	l, err := time.LoadLocation("America/Argentina/Buenos_Aires")
	if err != nil {
		return time.FixedZone("ART", -3*3600)
	}
	return l
}()

func mal(campo, m string) error { return plataforma.Invalido(map[string]string{campo: m}) }

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func demasiado(n int) string {
	return "Too big: expected string to have <=" + strconv.Itoa(n) + " characters"
}

// FormCliente es la ficha, como texto.
type FormCliente struct {
	ID, Nombre, RazonSocial, Cuit, CondicionIva, Tipo, Email, Telefono, Direccion, Rubro, Asesor string
	SellerID, LimiteCredito, PriceListID, Notas                                                  string
}

// Cliente es la ficha validada.
type Cliente struct {
	ID, Nombre                                                          string
	RazonSocial, Cuit, Email, Telefono, Direccion, Rubro, Asesor, Notas *string
	SellerID, PriceListID                                               *string
	CondicionIva, Tipo                                                  string
	LimiteCredito                                                       string
}

var reCuitForma = regexp.MustCompile(`^\d{2}-?\d{8}-?\d$`)

// reNoImporte es lo que no puede ir en un importe («$», espacios, letras).
var reNoImporte = regexp.MustCompile(`[^\d.,-]`)

var condiciones = []string{"responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"}

// LimiteDeCredito lee el límite como un importe (parsearImporte):
// «1.500.000», «250.000,50» o «1500000». El TS sacaba todo lo que no fuera
// dígito, punto o guion y lo pasaba por Number(): «1.500.000» daba 0 y
// «250.000,99» daba 250, y el cliente quedaba sin poder comprar a cuenta.
func LimiteDeCredito(t string) string {
	n := precios.ParsearImporte(reNoImporte.ReplaceAllString(t, ""))
	if math.IsNaN(n) || math.IsInf(n, 0) {
		n = 0
	}
	return jsmath.Fijo2(n)
}

// ValidarCliente es clienteSchema, mensaje por mensaje.
func ValidarCliente(f FormCliente) (Cliente, error) {
	var c Cliente
	recortado := func(campo, v string, max int) (*string, error) {
		v = strings.TrimSpace(v)
		if plataforma.LargoJS(v) > max {
			return nil, mal(campo, demasiado(max))
		}
		return nulo(v), nil
	}
	var err error
	if f.ID != "" && !plataforma.UUIDValido(f.ID) {
		return c, mal("id", "Invalid UUID")
	}
	c.ID = f.ID
	c.Nombre = strings.TrimSpace(f.Nombre)
	switch {
	case plataforma.LargoJS(c.Nombre) < 2:
		return c, mal("nombre", "El nombre es obligatorio.")
	case plataforma.LargoJS(c.Nombre) > 160:
		return c, mal("nombre", demasiado(160))
	}
	if c.RazonSocial, err = recortado("razonSocial", f.RazonSocial, 160); err != nil {
		return c, err
	}
	if f.Cuit != "" {
		v := strings.TrimSpace(f.Cuit)
		if plataforma.LargoJS(v) > 20 {
			return c, mal("cuit", demasiado(20))
		}
		if v != "" && !reCuitForma.MatchString(v) {
			return c, mal("cuit", "El CUIT tiene que tener 11 dígitos, con o sin guiones.")
		}
		c.Cuit = nulo(strings.ReplaceAll(v, "-", ""))
	}
	c.CondicionIva = f.CondicionIva
	if c.CondicionIva == "" {
		c.CondicionIva = "consumidor_final"
	}
	valida := false
	for _, x := range condiciones {
		valida = valida || x == c.CondicionIva
	}
	if !valida {
		return c, mal("condicionIva", `Invalid option: expected one of "responsable_inscripto"|"monotributista"|"exento"|"consumidor_final"|"no_categorizado"`)
	}
	c.Tipo = f.Tipo
	if c.Tipo == "" {
		c.Tipo = "particular"
	}
	if c.Tipo != "particular" && c.Tipo != "profesional" {
		return c, mal("tipo", `Invalid option: expected one of "particular"|"profesional"`)
	}
	// .email().optional().or(z.literal("")): el literal se compara sin recortar.
	if f.Email != "" {
		e := strings.TrimSpace(f.Email)
		if !plataforma.CorreoValido(e) {
			return c, mal("email", "Revisá el correo.")
		}
		c.Email = &e
	}
	if c.Telefono, err = recortado("telefono", f.Telefono, 40); err != nil {
		return c, err
	}
	if c.Direccion, err = recortado("direccion", f.Direccion, 200); err != nil {
		return c, err
	}
	if c.Rubro, err = recortado("rubro", f.Rubro, 80); err != nil {
		return c, err
	}
	if c.Asesor, err = recortado("asesor", f.Asesor, 60); err != nil {
		return c, err
	}
	if f.SellerID != "" {
		if !plataforma.UUIDValido(f.SellerID) {
			return c, mal("sellerId", "Invalid UUID")
		}
		c.SellerID = &f.SellerID
	}
	c.LimiteCredito = LimiteDeCredito(f.LimiteCredito)
	if f.PriceListID != "" {
		if !plataforma.UUIDValido(f.PriceListID) {
			return c, mal("priceListId", "Invalid UUID")
		}
		c.PriceListID = &f.PriceListID
	}
	if c.Notas, err = recortado("notas", f.Notas, 1000); err != nil {
		return c, err
	}
	return c, nil
}

// Guardar da de alta o edita la ficha. Un CUIT que ya es de otra ficha
// frena el alta: se abre esa en vez de duplicar.
func (s *Servicio) Guardar(ctx context.Context, ses *auth.Sesion, f FormCliente) (string, error) {
	c, err := ValidarCliente(f)
	if err != nil {
		return "", err
	}
	if c.Cuit != nil {
		if doc, e := LeerDocumento(*c.Cuit); e == "" && doc.Tipo != "ninguno" {
			formas := []string{doc.Digitos}
			if doc.Tipo == "cuit" {
				formas = append(formas, cuit.FormatearLargo(doc.Digitos))
			}
			otro, err := s.q.ClientePorCuit(ctx, formas)
			if err == nil && otro.ID != c.ID {
				return "", mal("cuit", "Ese CUIT ya es de "+otro.Nombre+". Abrí esa ficha en vez de crear otra.")
			} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return "", err
			}
		}
	}
	id := c.ID
	if id != "" {
		err = s.q.EditarCliente(ctx, sqlc.EditarClienteParams{
			ID: id, Nombre: c.Nombre, RazonSocial: c.RazonSocial, Cuit: c.Cuit, CondicionIva: sqlc.CondicionIva(c.CondicionIva),
			Tipo: sqlc.TipoCliente(c.Tipo), Email: c.Email, Telefono: c.Telefono, Direccion: c.Direccion, Rubro: c.Rubro,
			Asesor: c.Asesor, SellerID: c.SellerID, Limite: c.LimiteCredito, PriceListID: c.PriceListID, Notas: c.Notas,
		})
	} else {
		id, err = s.q.CrearCliente(ctx, sqlc.CrearClienteParams{
			Nombre: c.Nombre, RazonSocial: c.RazonSocial, Cuit: c.Cuit, CondicionIva: sqlc.CondicionIva(c.CondicionIva),
			Tipo: sqlc.TipoCliente(c.Tipo), Email: c.Email, Telefono: c.Telefono, Direccion: c.Direccion, Rubro: c.Rubro,
			Asesor: c.Asesor, SellerID: c.SellerID, Limite: c.LimiteCredito, PriceListID: c.PriceListID, Notas: c.Notas,
		})
	}
	if err != nil {
		return "", err
	}
	accion, verbo := sqlc.AccionAuditoriaCrear, "Dio de alta"
	if c.ID != "" {
		accion, verbo = sqlc.AccionAuditoriaEditar, "Editó"
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "cliente", id, verbo+" a "+c.Nombre,
		map[string]any{"limiteCredito": c.LimiteCredito, "tipo": c.Tipo})
	if c.ID != "" {
		return "Cliente actualizado.", nil
	}
	return "Cliente creado.", nil
}

// Movimiento es registrarMovimiento: una compra, nota o ajuste cargado a
// mano (solo el admin). El signo lo pone el tipo.
func (s *Servicio) Movimiento(ctx context.Context, ses *auth.Sesion, cliente, tipo, monto, detalle string) error {
	if !plataforma.UUIDValido(cliente) {
		return mal("customerId", "Invalid UUID")
	}
	switch tipo {
	case "compra", "nota_credito", "nota_debito", "ajuste":
	default:
		return mal("tipo", `Invalid option: expected one of "compra"|"nota_credito"|"nota_debito"|"ajuste"`)
	}
	d := strings.TrimSpace(detalle)
	if plataforma.LargoJS(d) > 200 {
		return mal("detalle", demasiado(200))
	}
	m := math.Abs(precios.ParsearImporte(monto))
	if math.IsNaN(m) || math.IsInf(m, 0) || m <= 0 {
		return mal("monto", "Poné un importe mayor a cero.")
	}
	if tipo != "compra" && tipo != "nota_debito" {
		m = -m
	}
	texto := jsmath.Fijo2(m)
	if err := s.q.MovimientoManual(ctx, sqlc.MovimientoManualParams{CustomerID: cliente, Tipo: sqlc.TipoMovimientoCuenta(tipo),
		Monto: texto, Detalle: nulo(d), CreatedByUserID: &ses.UserID}); err != nil {
		return err
	}
	det := map[string]any{"tipo": tipo, "monto": texto}
	if d != "" {
		det["detalleCarga"] = d
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "cliente", cliente,
		"Cargó un movimiento de cuenta corriente: "+tipo+" por "+texto, det)
	return nil
}

// VincularCuentaWeb pasa la cuenta del sitio de una ficha web a la del
// mostrador: sus pedidos, presupuestos, movimientos y direcciones se mudan, y
// la ficha web queda apagada.
func (s *Servicio) VincularCuentaWeb(ctx context.Context, ses *auth.Sesion, cliente, web string) error {
	if !plataforma.UUIDValido(cliente) || !plataforma.UUIDValido(web) {
		return mal("customerId", "No pudimos encontrar esos dos clientes. Recargá la pantalla y probá de nuevo.")
	}
	if cliente == web {
		return mal("cuentaWebId", "Son la misma ficha.")
	}
	destino, err1 := s.q.UsuarioDeLaFicha(ctx, cliente)
	origen, err2 := s.q.UsuarioDeLaFicha(ctx, web)
	if errors.Is(err1, pgx.ErrNoRows) || errors.Is(err2, pgx.ErrNoRows) || (err2 == nil && origen.UserID == nil) {
		return mal("cuentaWebId", "Esa cuenta web ya no está disponible.")
	}
	if err := errors.Join(err1, err2); err != nil {
		return err
	}
	if destino.UserID != nil {
		return mal("customerId", "Este cliente ya tiene una cuenta web vinculada.")
	}
	usuario := *origen.UserID
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		for _, paso := range []func() error{
			func() error { return q.SoltarCuentaWeb(ctx, web) },
			func() error { return q.AtarCuentaWeb(ctx, sqlc.AtarCuentaWebParams{ID: cliente, UserID: &usuario}) },
			func() error { return q.MudarPedidos(ctx, sqlc.MudarPedidosParams{Destino: &cliente, Origen: &web}) },
			func() error {
				return q.MudarPresupuestos(ctx, sqlc.MudarPresupuestosParams{Destino: &cliente, Origen: &web})
			},
			func() error {
				return q.MudarMovimientos(ctx, sqlc.MudarMovimientosParams{Destino: cliente, Origen: web})
			},
			func() error {
				return q.MudarDirecciones(ctx, sqlc.MudarDireccionesParams{Destino: cliente, Origen: web})
			},
		} {
			if err := paso(); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "cliente", cliente, "Vinculó una cuenta web con la ficha del mostrador",
		map[string]any{"customerId": cliente, "cuentaWebId": web, "userId": usuario})
	return nil
}

// Bloquear bloquea (o habilita) la cuenta corriente: el mostrador no le vende
// a cuenta. Bloquear pide el motivo.
func (s *Servicio) Bloquear(ctx context.Context, ses *auth.Sesion, cliente string, bloquear bool, motivo string) (string, error) {
	m := strings.TrimSpace(motivo)
	if !plataforma.UUIDValido(cliente) || plataforma.LargoJS(m) > 200 {
		return "", mal("motivo", "No se pudo actualizar la cuenta.")
	}
	if bloquear && plataforma.LargoJS(m) < 3 {
		return "", mal("motivo", "Escribí por qué se bloquea: se lo van a preguntar.")
	}
	var mot *string
	if bloquear {
		mot = &m
	}
	nombre, err := s.q.BloquearCuenta(ctx, sqlc.BloquearCuentaParams{ID: cliente, CuentaBloqueada: bloquear, MotivoBloqueo: mot})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Esa ficha ya no está.")
	}
	if err != nil {
		return "", err
	}
	desc := "Volvió a habilitar la cuenta corriente de " + nombre
	if bloquear {
		desc = "Bloqueó la cuenta corriente de " + nombre + ": " + m
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "cliente", cliente, desc, nil)
	if bloquear {
		return "Cuenta corriente bloqueada. El mostrador no va a poder venderle a cuenta.", nil
	}
	return "Cuenta corriente habilitada de nuevo.", nil
}

// Plazo es cambiarPlazoDePago: días de 0 a 365.
func (s *Servicio) Plazo(ctx context.Context, ses *auth.Sesion, cliente string, dias float64) (string, error) {
	if !plataforma.UUIDValido(cliente) || dias != math.Trunc(dias) || dias < 0 || dias > 365 {
		return "", mal("dias", "El plazo va en días, de 0 a 365.")
	}
	nombre, err := s.q.CambiarPlazo(ctx, sqlc.CambiarPlazoParams{ID: cliente, DiasCredito: int32(dias)})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Esa ficha ya no está.")
	}
	if err != nil {
		return "", err
	}
	d := strconv.Itoa(int(dias))
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "cliente", cliente, "Dejó el plazo de pago de "+nombre+" en "+d+" días", nil)
	return "Listo: paga a " + d + " días.", nil
}

// GuardarVendedor da de alta o edita un vendedor.
func (s *Servicio) GuardarVendedor(ctx context.Context, ses *auth.Sesion, id, nombre, tipo string) error {
	if id != "" && !plataforma.UUIDValido(id) {
		return mal("id", "Invalid UUID")
	}
	n := strings.TrimSpace(nombre)
	switch {
	case plataforma.LargoJS(n) < 2:
		return mal("nombre", "Poné el nombre.")
	case plataforma.LargoJS(n) > 80:
		return mal("nombre", demasiado(80))
	}
	if tipo == "" {
		tipo = "salon"
	}
	if tipo != "salon" && tipo != "calle" {
		return mal("tipo", `Invalid option: expected one of "salon"|"calle"`)
	}
	var err error
	if id != "" {
		err = s.q.EditarVendedor(ctx, sqlc.EditarVendedorParams{ID: id, Nombre: n, Tipo: sqlc.TipoVendedor(tipo)})
	} else {
		err = s.q.CrearVendedor(ctx, sqlc.CrearVendedorParams{Nombre: n, Tipo: sqlc.TipoVendedor(tipo)})
	}
	if err != nil {
		if strings.Contains(err.Error(), "sellers_nombre_idx") {
			return mal("nombre", "Ya hay un vendedor con ese nombre.")
		}
		return err
	}
	cual := "de salón"
	if tipo == "calle" {
		cual = "de calle"
	}
	accion := sqlc.AccionAuditoriaCrear
	if id != "" {
		accion = sqlc.AccionAuditoriaEditar
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, accion, "vendedor", id, "Vendedor: "+n+" ("+cual+")", nil)
	return nil
}

// AlternarVendedor lo desactiva o lo reactiva.
func (s *Servicio) AlternarVendedor(ctx context.Context, ses *auth.Sesion, id string) (string, error) {
	v, err := s.q.VendedorPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Ese vendedor ya no está.")
	}
	if err != nil {
		return "", err
	}
	if err := s.q.AlternarVendedor(ctx, id); err != nil {
		return "", err
	}
	estado, ok := "reactivado", "Reactivado."
	if v.Activo {
		estado, ok = "desactivado", "Desactivado."
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaEditar, "vendedor", id, "Vendedor "+estado+": "+v.Nombre, nil)
	return ok, nil
}

// mediodia es new Date(`${v}T12:00:00`): el mediodía de ese día, acá.
func mediodia(v string) (*time.Time, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil, nil
	}
	t, err := time.ParseInLocation("2006-01-02T15:04:05", v+"T12:00:00", argentina)
	if err != nil {
		return nil, mal("proximaAccion", "Revisá la fecha.")
	}
	return &t, nil
}

// CrearGestion abre un seguimiento de cobranza o de venta.
func (s *Servicio) CrearGestion(ctx context.Context, ses *auth.Sesion, cliente, asunto, notas, proxima string) error {
	a, n := strings.TrimSpace(asunto), strings.TrimSpace(notas)
	switch {
	case !plataforma.UUIDValido(cliente):
		return mal("customerId", "Elegí el cliente.")
	case plataforma.LargoJS(a) < 3:
		return mal("asunto", "Escribí de qué se trata, aunque sea en tres palabras.")
	case plataforma.LargoJS(a) > 160:
		return mal("asunto", demasiado(160))
	case plataforma.LargoJS(n) > 2000:
		return mal("notas", demasiado(2000))
	}
	cuando, err := mediodia(proxima)
	if err != nil {
		return err
	}
	if err := s.q.CrearGestion(ctx, sqlc.CrearGestionParams{CustomerID: cliente, Asunto: a, Notas: nulo(n),
		ProximaAccionAt: cuando, ResponsableUserID: &ses.UserID}); err != nil {
		return err
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCrear, "cliente", cliente, "Abrió un seguimiento: "+a, nil)
	return nil
}

var etiquetaDeEtapa = map[string]string{"pendiente": "queda para hacer", "hablando": "se está hablando", "promesa": "prometió pagar", "cerrado": "cerrado"}

// MoverGestion la cambia de etapa, con una nota fechada que se agrega a las
// anteriores. Devuelve el cliente, para revalidar su ficha.
func (s *Servicio) MoverGestion(ctx context.Context, ses *auth.Sesion, id, etapa, nota, proxima string, ahora time.Time) (string, error) {
	n := strings.TrimSpace(nota)
	if _, ok := etiquetaDeEtapa[etapa]; !ok || !plataforma.UUIDValido(id) || plataforma.LargoJS(n) > 500 {
		return "", mal("etapa", "No se pudo mover el seguimiento.")
	}
	g, err := s.q.GestionPorID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", plataforma.NuevoProblema(404, "Ese seguimiento ya no está.")
	}
	if err != nil {
		return "", err
	}
	notas := g.Notas
	if n != "" {
		l := ahora.In(argentina)
		linea := fmt.Sprintf("%d/%d/%d · %s", l.Day(), int(l.Month()), l.Year(), n)
		if notas != nil && *notas != "" {
			linea = *notas + "\n" + linea
		}
		notas = &linea
	}
	actual, err := s.q.ProximaAccionDeGestion(ctx, id)
	if err != nil {
		return "", err
	}
	if p, err := mediodia(proxima); err != nil {
		return "", err
	} else if p != nil {
		actual = p
	}
	var cerrado *time.Time
	if etapa == "cerrado" {
		cerrado, actual = &ahora, nil
	}
	if err := s.q.MoverGestion(ctx, sqlc.MoverGestionParams{ID: id, Etapa: sqlc.EtapaSeguimiento(etapa), Notas: notas,
		ProximaAccionAt: actual, CerradoAt: cerrado}); err != nil {
		return "", err
	}
	desc := g.Asunto + ": " + etiquetaDeEtapa[etapa]
	if n != "" {
		desc += " — " + n
	}
	bitacora.Anotar(ctx, s.q, s.log, ses, sqlc.AccionAuditoriaCambiarEstado, "cliente", g.CustomerID, desc, nil)
	return g.CustomerID, nil
}

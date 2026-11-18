package autorizacion

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"mjbj/internal/auth"
	"mjbj/internal/pruebas"
	"mjbj/internal/sqlc"
)

var silencio = slog.New(slog.NewTextHandler(io.Discard, nil))

type entorno struct {
	pool     *pgxpool.Pool
	ses      *auth.Servicio
	svc      *Servicio
	vendedor *auth.Sesion
	admin    *auth.Sesion
	sucursal string
	ahora    time.Time
	avisos   []string
	adminID  string
}

func armar(t *testing.T) *entorno {
	t.Helper()
	pool := pruebas.Base(t)
	ctx := context.Background()
	e := &entorno{pool: pool, ahora: time.Date(2026, 11, 18, 15, 10, 0, 0, argentina)}
	e.ses = auth.Nuevo(auth.Config{Secreto: "secreto-de-prueba-de-la-autorizacion-32", URL: "http://localhost"}, pool)
	e.svc = Nuevo(pool, silencio, "secreto").ConReloj(func() time.Time { return e.ahora }).
		ConAvisos(func(_ context.Context, _, cuerpo string) { e.avisos = append(e.avisos, cuerpo) })
	id := alta(t, e, "duena@prueba.test", "Marta", sqlc.StaffRoleAdmin)
	e.adminID = id
	rolA, rolV := sqlc.StaffRoleAdmin, sqlc.StaffRoleVendedor
	e.admin = &auth.Sesion{UserID: id, Nombre: "Marta", Correo: "duena@prueba.test", Rol: sqlc.UserRoleStaff, RolStaff: &rolA}
	vid := alta(t, e, "vendedor@prueba.test", "Juan", sqlc.StaffRoleVendedor)
	e.vendedor = &auth.Sesion{UserID: vid, Nombre: "Juan", Rol: sqlc.UserRoleStaff, RolStaff: &rolV}
	if err := pool.QueryRow(ctx, `insert into branches (slug, name) values ('central', 'Central') returning id`).Scan(&e.sucursal); err != nil {
		t.Fatal(err)
	}
	return e
}

// alta da de alta a alguien del personal y devuelve su id.
func alta(t *testing.T, e *entorno, correo, nombre string, rol sqlc.StaffRole) string {
	t.Helper()
	ctx := context.Background()
	if _, err := e.ses.AltaDeStaff(ctx, correo, "una clave larga", nombre, rol); err != nil {
		t.Fatal(err)
	}
	var id string
	if err := e.pool.QueryRow(ctx, `select id from "user" where email = $1`, correo).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func (e *entorno) pedido(pin string) Pedido {
	return Pedido{Motivo: Precio, Monto: 12300, Clave: "venta-1", Sucursal: e.sucursal, PIN: pin}
}

func falta(t *testing.T, err error) *Falta {
	t.Helper()
	var f *Falta
	if !errors.As(err, &f) {
		t.Fatalf("esperaba una falta de autorización, vino %v", err)
	}
	return f
}

func TestPIN(t *testing.T) {
	e := armar(t)
	ctx := context.Background()

	// Sin ningún admin con PIN, todo queda trabado y se dice por qué.
	_, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("123456"))
	if f := falta(t, err); !f.SinAdmins {
		t.Fatalf("sin admins: %+v", f)
	}
	if hay, _ := HayAdminConPIN(ctx, e.pool); hay {
		t.Fatal("no había PIN cargado")
	}

	// El admin lo carga con su clave; con otra clave o un PIN corto, no.
	if err := e.ses.CargarPIN(ctx, e.admin, "otra", "482915"); !errors.Is(err, auth.ErrCredenciales) {
		t.Fatalf("clave mala: %v", err)
	}
	if err := e.ses.CargarPIN(ctx, e.admin, "una clave larga", "1234"); !errors.Is(err, auth.ErrPINInvalido) {
		t.Fatalf("PIN corto: %v", err)
	}
	if err := e.ses.CargarPIN(ctx, e.admin, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}

	// Un admin no necesita PIN: su sesión ya es la firma.
	f, err := e.svc.Exigir(ctx, e.admin, e.pedido(""))
	if err != nil || f.UserID != e.adminID {
		t.Fatalf("admin: %+v %v", f, err)
	}

	// El vendedor sin PIN: falta, con el monto a autorizar.
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido(""))
	if fa := falta(t, err); fa.Monto != 12300 || fa.PinIncorrecto || fa.Mensaje() != "Hace falta el PIN de un administrador." {
		t.Fatalf("sin PIN: %+v", fa)
	}

	// Correcto: firma a nombre del admin y devuelve una ficha.
	f, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("482915"))
	if err != nil || f.UserID != e.adminID || f.Nombre != "Marta" || f.Ficha == "" {
		t.Fatalf("PIN correcto: %+v %v", f, err)
	}

	// La ficha sirve para la misma operación, por hasta ese monto, dos minutos.
	p := e.pedido("")
	p.Ficha = f.Ficha
	if g, err := e.svc.Exigir(ctx, e.vendedor, p); err != nil || g.UserID != e.adminID {
		t.Fatalf("ficha: %+v %v", g, err)
	}
	otra := p
	otra.Clave = "venta-2"
	if _, err := e.svc.Exigir(ctx, e.vendedor, otra); falta(t, err).PinIncorrecto {
		t.Fatal("la ficha de otra venta no puede pasar ni contar como error")
	}
	mas := p
	mas.Monto = 20000
	falta(t, func() error { _, err := e.svc.Exigir(ctx, e.vendedor, mas); return err }())
	otroMotivo := p
	otroMotivo.Motivo = Anular
	falta(t, func() error { _, err := e.svc.Exigir(ctx, e.vendedor, otroMotivo); return err }())
	e.ahora = e.ahora.Add(3 * time.Minute)
	falta(t, func() error { _, err := e.svc.Exigir(ctx, e.vendedor, p); return err }())

	// Seis PIN correctos seguidos no bloquean: cuentan solo los errores.
	for i := 0; i < 6; i++ {
		if _, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("482915")); err != nil {
			t.Fatalf("correcto %d: %v", i+1, err)
		}
	}

	// Incorrecto: se dice, y al tercero seguido se avisa al admin.
	for i := 1; i <= 4; i++ {
		_, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("000000"))
		if fa := falta(t, err); !fa.PinIncorrecto || fa.BloqueadoHasta != nil {
			t.Fatalf("error %d: %+v", i, fa)
		}
	}
	if len(e.avisos) != 1 || e.avisos[0] != "Juan erró el PIN 3 veces seguidas." {
		t.Fatalf("avisos: %v", e.avisos)
	}
	// El quinto bloquea hasta el fin de la ventana de 15 minutos.
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("000000"))
	fa := falta(t, err)
	if fa.BloqueadoHasta == nil || fa.Mensaje() != "Bloqueado hasta las 15:15." {
		t.Fatalf("bloqueo: %+v %q", fa, fa.Mensaje())
	}
	// Bloqueado, ni el correcto pasa (el sexto intento).
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("482915"))
	if fa := falta(t, err); fa.BloqueadoHasta == nil {
		t.Fatalf("sexto intento: %+v", fa)
	}
	// Otro vendedor en la misma sucursal tampoco: el tope es del mostrador.
	rolV := sqlc.StaffRoleVendedor
	otro := &auth.Sesion{UserID: e.vendedor.UserID + "x", Nombre: "Pedro", Rol: sqlc.UserRoleStaff, RolStaff: &rolV}
	if _, err := e.svc.Exigir(ctx, otro, e.pedido("482915")); falta(t, err).BloqueadoHasta == nil {
		t.Fatal("otro vendedor de la misma sucursal tendría que seguir bloqueado")
	}

	// Pasada la ventana, vuelve; diez errores en el día bloquean todo hasta
	// mañana y avisan.
	e.ahora = e.ahora.Add(15 * time.Minute)
	if _, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("482915")); err != nil {
		t.Fatalf("pasada la ventana: %v", err)
	}
	for i := 0; i < 5; i++ {
		_, _ = e.svc.Exigir(ctx, e.vendedor, e.pedido("111111"))
		if i == 3 {
			e.ahora = e.ahora.Add(15 * time.Minute)
		}
	}
	_, err = e.svc.Exigir(ctx, e.vendedor, e.pedido("482915"))
	if fa := falta(t, err); fa.BloqueadoHasta == nil || fa.Mensaje() != "Bloqueado hasta las 00:00." {
		t.Fatalf("tope del día: %+v %q", fa, fa.Mensaje())
	}
	if ultimo := e.avisos[len(e.avisos)-1]; ultimo != "10 errores de PIN hoy: las autorizaciones quedan bloqueadas hasta mañana. El último lo tecleó Juan." {
		t.Fatalf("aviso del día: %v", e.avisos)
	}
	// El admin igual puede: no usa PIN.
	if _, err := e.svc.Exigir(ctx, e.admin, e.pedido("")); err != nil {
		t.Fatal(err)
	}
}

// Dos admins con el mismo PIN: se acepta (rechazarlo delataba el PIN del
// otro) y la firma queda a nombre de los dos.
func TestPINRepetido(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	id2 := alta(t, e, "socio@prueba.test", "Raúl", sqlc.StaffRoleAdmin)
	rolA := sqlc.StaffRoleAdmin
	socio := &auth.Sesion{UserID: id2, Nombre: "Raúl", Correo: "socio@prueba.test", Rol: sqlc.UserRoleStaff, RolStaff: &rolA}
	if err := e.ses.CargarPIN(ctx, e.admin, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	if err := e.ses.CargarPIN(ctx, socio, "una clave larga", "482915"); err != nil {
		t.Fatalf("el mismo PIN no se rechaza: %v", err)
	}
	f, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("482915"))
	if err != nil || f.Nombre != "Marta y Raúl" {
		t.Fatalf("firma de los dos: %+v %v", f, err)
	}
	// Un vendedor o un admin dado de baja (sin perfil de admin) no autoriza.
	if _, err := e.pool.Exec(ctx, `update profiles set staff_role = 'vendedor' where user_id = $1`, id2); err != nil {
		t.Fatal(err)
	}
	if f, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("482915")); err != nil || f.Nombre != "Marta" {
		t.Fatalf("solo los admins: %+v %v", f, err)
	}
}

// Con la base caída no pasa: un limitador que deja pasar abriría la caja.
func TestPINConLaBaseCaida(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	if err := e.ses.CargarPIN(ctx, e.admin, "una clave larga", "482915"); err != nil {
		t.Fatal(err)
	}
	e.pool.Close()
	_, err := e.svc.Exigir(ctx, e.vendedor, e.pedido("482915"))
	var f *Falta
	if err == nil || errors.As(err, &f) {
		t.Fatalf("con la base caída tiene que fallar, vino %v", err)
	}
}

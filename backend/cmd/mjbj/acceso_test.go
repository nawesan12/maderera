package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"mjbj/internal/auth"
	"mjbj/internal/avisos"
	"mjbj/internal/bitacora"
	"mjbj/internal/buscador"
	"mjbj/internal/caja"
	"mjbj/internal/campanas"
	"mjbj/internal/catalogo"
	"mjbj/internal/checkout"
	"mjbj/internal/clientes"
	"mjbj/internal/cobros"
	"mjbj/internal/compras"
	"mjbj/internal/contenido"
	"mjbj/internal/cortes"
	"mjbj/internal/cuentas"
	"mjbj/internal/documentos"
	"mjbj/internal/email"
	"mjbj/internal/entregas"
	"mjbj/internal/existencia"
	"mjbj/internal/facturacion"
	"mjbj/internal/limites"
	"mjbj/internal/migracion"
	"mjbj/internal/mostrador"
	"mjbj/internal/pagos"
	"mjbj/internal/pedidos"
	"mjbj/internal/plataforma"
	"mjbj/internal/portal"
	"mjbj/internal/precios"
	"mjbj/internal/productos"
	"mjbj/internal/profesionales"
	"mjbj/internal/pruebas"
	"mjbj/internal/push"
	"mjbj/internal/reportes"
	"mjbj/internal/roles"
	"mjbj/internal/sqlc"
	"mjbj/internal/stock"
	"mjbj/internal/subidas"
	"mjbj/internal/whatsapp"
)

// quienes son las sesiones con las que se prueba cada ruta: nadie, un
// cliente de la tienda y cada rol del panel.
var quienes = func() []string {
	q := []string{"anonimo", "cliente"}
	for _, r := range sqlc.AllStaffRoleValues() {
		q = append(q, string(r))
	}
	return q
}()

func sesionDe(quien string) *auth.Sesion {
	switch quien {
	case "anonimo":
		return nil
	case "cliente":
		return &auth.Sesion{UserID: "00000000-0000-4000-8000-000000000001", Nombre: "Cliente", Rol: sqlc.UserRoleCliente}
	}
	rol := sqlc.StaffRole(quien)
	return &auth.Sesion{UserID: "00000000-0000-4000-8000-000000000002", Nombre: "Personal", Rol: sqlc.UserRoleStaff, RolStaff: &rol}
}

// apisDePrueba son las mismas implementaciones que monta correrAPI, con la
// configuración vacía (sin proveedores reales: el correo, el push, Mercado
// Pago y WhatsApp caen en los de demostración o no hacen nada).
func apisDePrueba(t *testing.T) []any {
	pool := pruebas.Base(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	q := sqlc.New(pool)
	lim := limites.Nuevo(q, log)
	disco := subidas.Nuevo(subidas.Config{Carpeta: t.TempDir(), CarpetaPrivada: t.TempDir()})
	interna := plataforma.ConfigInterna{Secreto: "secreto-interno-de-la-prueba-de-acceso"}
	correo := email.Elegir(email.Config{}, log)
	avisador := push.Nuevo(push.Config{}, q, log)
	wa := whatsapp.Nuevo(pool, whatsapp.Config{CarpetaPrivada: t.TempDir()}, avisador, log)
	return []any{
		auth.NuevaAPI(auth.Nuevo(auth.Config{Secreto: "secreto-de-la-prueba-de-acceso-de-32-caracteres", URL: "http://localhost"}, pool), lim),
		catalogo.NuevaAPI(catalogo.Nuevo(pool), lim, interna),
		contenido.NuevaAPI(contenido.Nuevo(pool, disco, log), contenido.ConfigGoogle{}, contenido.ConfigContacto{}, correo, lim),
		productos.NuevaAPI(productos.Nuevo(pool, disco, log)),
		precios.NuevaAPI(precios.Nuevo(pool, log), precios.LeerPlanilla),
		stock.NuevaAPI(stock.Nuevo(pool, log)),
		cuentas.NuevaAPI(pool, clientes.Nuevo(pool, log), cobros.Nuevo(pool, log), interna),
		documentos.NuevaAPI(pool, lim, log),
		cortes.NuevaAPI(cortes.Nuevo(pool, log), lim, interna),
		compras.NuevaAPI(compras.Nuevo(pool, log)),
		whatsapp.NuevaAPI(wa, interna),
		bitacora.NuevaAPI(pool),
		portal.NuevaAPI(portal.Nuevo(pool)),
		existencia.NuevaAPI(pool, interna),
		campanas.NuevaAPI(campanas.Nuevo(pool, campanas.Config{}, correo, avisador, log), avisos.Nuevo(pool, correo, "", log), avisador, ""),
		profesionales.NuevaAPI(profesionales.Nuevo(pool, avisos.Nuevo(pool, correo, "", log), "http://localhost", log), lim, interna),
		buscador.NuevaAPI(pool),
		facturacion.NuevaAPI(facturacion.Nuevo(pool, log), interna),
		mostrador.NuevaAPI(mostrador.Nuevo(pool, log)),
		pedidos.NuevaAPI(pedidos.Nuevo(pool, log), interna),
		entregas.NuevaAPI(entregas.Nuevo(pool, log), interna),
		caja.NuevaPanelAPI(caja.NuevoPanel(pool, log)),
		reportes.NuevaAPI(reportes.Nuevo(pool, log), interna),
		checkout.NuevaAPI(checkout.Nuevo(pool, log), interna, false),
		pagos.NuevaAPI(pagos.Nuevo(pool, pagos.Config{}, log), pagos.Extras{Lim: lim, Disco: disco, Push: avisador}, interna),
		migracion.NuevaAPI(migracion.Nuevo(pool, log)),
	}
}

type manejador func(ctx context.Context, w http.ResponseWriter, r *http.Request, req any) (any, error)

// entra llama a la operación con un pedido vacío y dice si la sesión pasó
// el control de acceso: no pasó si contestó 401 o 403 (o el 404 de «no
// existe o no te corresponde» de las rutas con token). Lo que pase después
// —un error porque el pedido está vacío, un pánico por un cuerpo nil— ya es
// del otro lado de la puerta.
func entra(metodo reflect.Value, ses *auth.Sesion) (resultado int) {
	tipo := metodo.Type()
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	if ses != nil {
		ctx = auth.ConSesion(ctx, ses)
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.7:1234"
	r = r.WithContext(ctx)
	defer func() {
		if recover() != nil {
			resultado = 200
		}
	}()
	h := plataforma.ConPedido[manejador](func(ctx context.Context, _ http.ResponseWriter, _ *http.Request, _ any) (any, error) {
		sal := metodo.Call([]reflect.Value{reflect.ValueOf(ctx), reflect.Zero(tipo.In(1))})
		err, _ := sal[1].Interface().(error)
		return nil, err
	}, "")
	_, err := h(ctx, httptest.NewRecorder(), r, nil)
	var p *plataforma.Problema
	if errors.As(err, &p) && (p.Estado == 401 || p.Estado == 403) {
		return p.Estado
	}
	return 200
}

// operaciones son las operationId de todos los contratos (api/*.yaml).
func operaciones(t *testing.T) map[string]string {
	t.Helper()
	archivos, err := filepath.Glob("../../api/*.yaml")
	if err != nil || len(archivos) == 0 {
		t.Fatalf("no encontré los contratos: %v", err)
	}
	reOp := regexp.MustCompile(`^\s+operationId:\s*(\w+)`)
	reRuta := regexp.MustCompile(`^  (/\S+):\s*$`)
	reMetodo := regexp.MustCompile(`^    (get|post|put|patch|delete):`)
	ops := map[string]string{}
	for _, a := range archivos {
		if strings.HasSuffix(a, ".gen.yaml") {
			continue
		}
		b, err := os.ReadFile(a)
		if err != nil {
			t.Fatal(err)
		}
		ruta, metodo := "", ""
		for _, l := range strings.Split(string(b), "\n") {
			if m := reRuta.FindStringSubmatch(l); m != nil {
				ruta = m[1]
			} else if m := reMetodo.FindStringSubmatch(l); m != nil {
				metodo = strings.ToUpper(m[1])
			} else if m := reOp.FindStringSubmatch(l); m != nil {
				ops[m[1]] = metodo + " " + ruta
			}
		}
	}
	return ops
}

// observar recorre todas las operaciones con cada sesión.
func observar(t *testing.T) (map[string]map[string]int, map[string]string) {
	ops := operaciones(t)
	vistas := map[string]map[string]int{}
	for _, api := range apisDePrueba(t) {
		v := reflect.ValueOf(api)
		for i := 0; i < v.NumMethod(); i++ {
			nombre := v.Type().Method(i).Name
			m := v.Method(i)
			tt := m.Type()
			if _, es := ops[nombre]; !es || tt.NumIn() != 2 || tt.NumOut() != 2 || !strings.HasSuffix(tt.In(1).Name(), "RequestObject") {
				continue
			}
			vistas[nombre] = map[string]int{}
			for _, quien := range quienes {
				vistas[nombre][quien] = entra(m, sesionDe(quien))
			}
		}
	}
	return vistas, ops
}

// TestAccesoPorPantalla recorre todas las rutas de los contratos con cada
// sesión (nadie, un cliente, cada rol del panel) y compara con
// pantallaDeCadaRuta. Es la matriz de la auditoría del 30/10/2026 hecha
// prueba: ahí apareció que el mostrador, los clientes, la facturación, la
// bitácora y otras veinte rutas pedían «cualquiera del personal» mientras su
// pantalla era más estricta, y el depósito o el aserradero las usaban
// llamando a la API.
func TestAccesoPorPantalla(t *testing.T) {
	vistas, ops := observar(t)
	nombres := make([]string, 0, len(ops))
	for n := range ops {
		nombres = append(nombres, n)
	}
	sort.Strings(nombres)
	for n := range pantallaDeCadaRuta {
		if _, es := ops[n]; !es {
			t.Errorf("%s está en pantallaDeCadaRuta pero en ningún contrato", n)
		}
	}
	for _, n := range nombres {
		vio, probada := vistas[n]
		if !probada {
			t.Errorf("%s (%s): no encontré su handler; sumá su API a apisDePrueba", n, ops[n])
			continue
		}
		pantalla, declarada := pantallaDeCadaRuta[n]
		if !declarada {
			t.Errorf("%s (%s): falta en pantallaDeCadaRuta (¿qué pantalla la usa?)", n, ops[n])
			continue
		}
		quiero := map[string]bool{}
		switch pantalla {
		case "publico":
			quiero["anonimo"] = true
		case "interno":
		case "sesion":
			for _, q := range quienes[1:] {
				quiero[q] = true
			}
		case "personal":
			for _, r := range sqlc.AllStaffRoleValues() {
				quiero[string(r)] = true
			}
		case "admin":
			quiero[string(sqlc.StaffRoleAdmin)] = true
		default:
			rs := roles.QuienEntra(pantalla)
			if len(rs) == 0 {
				t.Errorf("%s: «%s» no es una pantalla de roles.Acceso", n, pantalla)
				continue
			}
			for _, r := range rs {
				quiero[string(r)] = true
			}
		}
		for _, q := range quienes {
			entro := vio[q] == 200
			switch {
			case pantalla == "publico":
				// Que entre el anónimo alcanza: lo demás depende de los datos.
			case entro && !quiero[q]:
				t.Errorf("%s (%s): entra %s y la pantalla %s no lo deja", n, ops[n], q, pantalla)
			case !entro && quiero[q]:
				t.Errorf("%s (%s): %s recibe %d y la pantalla %s lo deja entrar", n, ops[n], q, vio[q], pantalla)
			}
		}
		if pantalla == "publico" && vio["anonimo"] != 200 {
			t.Errorf("%s (%s): declarada pública y el anónimo recibe %d", n, ops[n], vio["anonimo"])
		}
	}
}

// TestVerAcceso imprime la matriz observada (para declarar una ruta nueva):
//
//	MJBJ_VER_ACCESO=1 go test ./cmd/mjbj -run TestVerAcceso -v
func TestVerAcceso(t *testing.T) {
	if os.Getenv("MJBJ_VER_ACCESO") == "" {
		t.Skip("solo con MJBJ_VER_ACCESO=1")
	}
	vistas, ops := observar(t)
	nombres := make([]string, 0, len(ops))
	for n := range ops {
		nombres = append(nombres, n)
	}
	sort.Slice(nombres, func(i, j int) bool { return ops[nombres[i]] < ops[nombres[j]] })
	fmt.Printf("%-40s %-70s %s\n", "", "", strings.Join(quienes, " "))
	for _, n := range nombres {
		fila := []string{}
		for _, q := range quienes {
			fila = append(fila, fmt.Sprint(vistas[n][q]))
		}
		fmt.Printf("%-40s %-70s %s\n", n, ops[n], strings.Join(fila, " "))
	}
}

package migracion

import (
	"context"
	"strings"
	"testing"

	"mjbj/internal/sqlc"
)

// Lo que encontró el mes simulado en la migración de clientes: la vista
// previa no decía qué fichas pisaba (M2S1-030), el rubro y el vendedor se
// perdían (M2S1-046, M2S3-018), el domicilio de dos renglones quedaba con el
// salto, y el control comparaba contra todo el sistema (M3S2-034).
func TestClientesDelMesSimulado(t *testing.T) {
	e := armar(t)
	ctx := context.Background()
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	u := e.srv.URL + "/api/v1/admin/migracion/"

	// Una ficha cargada a mano, con CUIT con guiones, y un vendedor.
	if _, err := e.pool.Exec(ctx, `INSERT INTO customers (nombre, cuit, direccion) VALUES ('Sim Techos Costa Atlántica', '30-71555022-5', 'Sim Ruta 11 km 5')`); err != nil {
		t.Fatal(err)
	}
	var vendedor string
	if err := e.pool.QueryRow(ctx, `INSERT INTO sellers (nombre) VALUES ('Sim Gustavo Viajante') RETURNING id::text`).Scan(&vendedor); err != nil {
		t.Fatal(err)
	}
	// Una corrida anterior con otros códigos, para que «el sistema» tenga más.
	migrar(t, e, adm, "clientes", "viejos.csv", []byte("Código;Nombre\r\nV1;Viejo uno\r\nV2;Viejo dos\r\nV3;Viejo tres\r\n"))

	archivo := []byte("Código;Nombre;CUIT;Domicilio;Tipo Cliente;Vendedor\r\n" +
		"SIM001;Sim Carpintería Norte;;Sim Alem 3400;Carpintero;Sim Gustavo Viajante\r\n" +
		"SIM002;Sim Particular;;\"Sim Alem 3400\nPiso 2\";Particular;Nadie Conocido\r\n" +
		"SIM003;Sim Techos;30715550225;Sim Ruta 11;Constructora;\r\n")

	var a ArchivoAnalizado
	if s := subir(t, adm, u+"analizar", "clientes", "sim.csv", archivo, &a); s != 200 || a.Error != "" {
		t.Fatalf("analizar: %d %q", s, a.Error)
	}
	var previa VistaPrevia
	if s := pedir(t, adm, "POST", u+"previa", map[string]any{"entidad": "clientes", "mapeo": a.Mapeo, "filas": a.Filas}, &previa); s != 200 {
		t.Fatalf("previa: %d", s)
	}
	if previa.Actualizan == nil || *previa.Actualizan != 1 {
		t.Fatalf("tenía que decir que una fila actualiza: %+v", previa)
	}
	var sim3, sim2 *FilaPrevia
	for i, f := range *previa.Muestra {
		switch f.Identificador {
		case "SIM003":
			sim3 = &(*previa.Muestra)[i]
		case "SIM002":
			sim2 = &(*previa.Muestra)[i]
		}
	}
	if sim3 == nil || !sim3.Actualiza || !strings.Contains(strings.Join(sim3.Cambios, "|"), "Domicilio: Sim Ruta 11 km 5 → Sim Ruta 11") ||
		!strings.Contains(strings.Join(sim3.Cambios, "|"), "Nombre: Sim Techos Costa Atlántica → Sim Techos") {
		t.Errorf("SIM003 tenía que decir qué cambia: %+v", sim3)
	}
	if sim2 == nil || !strings.Contains(strings.Join(sim2.Avisos, "|"), "Nadie Conocido") {
		t.Errorf("el vendedor que no existe va con reparos: %+v", sim2)
	}

	_, _, controles := migrar(t, e, adm, "clientes", "sim.csv", archivo)
	if len(controles) < 1 || controles[0].SegunElArchivo != "3" || controles[0].EnElSistema != "3" || !controles[0].Ok {
		t.Errorf("el control compara contra lo del archivo: %+v", controles)
	}

	var rubro, direccion string
	var seller *string
	_ = e.pool.QueryRow(ctx, `SELECT coalesce(rubro, ''), seller_id::text, direccion FROM customers WHERE codigo_legacy = 'SIM001'`).Scan(&rubro, &seller, &direccion)
	if rubro != "carpintero" || seller == nil || *seller != vendedor {
		t.Errorf("SIM001: rubro %q vendedor %v", rubro, seller)
	}
	_ = e.pool.QueryRow(ctx, `SELECT direccion FROM customers WHERE codigo_legacy = 'SIM002'`).Scan(&direccion)
	if direccion != "Sim Alem 3400, Piso 2" {
		t.Errorf("domicilio de dos renglones: %q", direccion)
	}
	// SIM003 cayó sobre la ficha de antes (CUIT con guiones) y no duplicó.
	if n := contarFilas(t, e.pool, `SELECT count(*)::int FROM customers WHERE cuit = '30-71555022-5'`); n != 1 {
		t.Errorf("fichas con ese CUIT: %d", n)
	}
	var cuitSim3 string
	_ = e.pool.QueryRow(ctx, `SELECT cuit FROM customers WHERE codigo_legacy = 'SIM003'`).Scan(&cuitSim3)
	if cuitSim3 != "30-71555022-5" {
		t.Errorf("CUIT de SIM003: %q", cuitSim3)
	}
}

// Proveedores sin ningún saldo en el archivo: la suma no aplica, y el
// control de códigos compara solo los del archivo (M3S3-040).
func TestProveedoresSinSaldoNoAvisan(t *testing.T) {
	e := armar(t)
	adm := e.staff(t, "admin@prueba.test", sqlc.StaffRoleAdmin)
	migrar(t, e, adm, "proveedores", "viejos.csv", []byte("Código;Nombre;Saldo\r\nP1;Con saldo;1234,50\r\nP2;Otro;\r\n"))
	_, _, controles := migrar(t, e, adm, "proveedores", "sim.csv", []byte("Código;Nombre;Saldo\r\nSIMP1;Sim uno;\r\nSIMP2;Sim dos;\r\n"))
	if len(controles) != 1 || controles[0].SegunElArchivo != "2" || controles[0].EnElSistema != "2" || !controles[0].Ok {
		t.Errorf("controles: %+v", controles)
	}
}
